import unittest
from unittest.mock import AsyncMock, patch

import main


class ApiKeyAuthenticationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        main._apikey_pool = None
        self.provider = main.GoogleOrApiKeyProvider(
            client_id="test-client",
            client_secret="test-secret",
            base_url="https://mcp.example.com",
            required_scopes=["openid"],
            jwt_signing_key="x" * 32,
        )

    async def test_shared_api_key_resolves_before_google_oauth(self):
        identity = {
            "sub": "apikey:agent@example.com",
            "email": "agent@example.com",
            "name": "Agent",
        }

        with patch.object(
            main,
            "_resolve_api_key",
            AsyncMock(return_value=identity),
        ):
            token = await self.provider.verify_token("sk_mcp_test")

        self.assertIsNotNone(token)
        self.assertEqual(token.client_id, "api-key")
        self.assertEqual(token.scopes, ["openid"])
        self.assertEqual(token.claims["email"], identity["email"])

    async def test_non_api_key_falls_back_to_google_oauth(self):
        oauth_token = main.AccessToken(
            token="oauth-token",
            client_id="google-client",
            scopes=["openid"],
        )

        with patch.object(
            main.GoogleProvider,
            "verify_token",
            AsyncMock(return_value=oauth_token),
        ) as verify_google:
            token = await self.provider.verify_token("oauth-token")

        self.assertIs(token, oauth_token)
        verify_google.assert_awaited_once_with("oauth-token")

    async def test_invalid_shared_api_key_fails_closed(self):
        with (
            patch.object(
                main,
                "_resolve_api_key",
                AsyncMock(return_value=None),
            ),
            patch.object(
                main.GoogleProvider,
                "verify_token",
                AsyncMock(),
            ) as verify_google,
        ):
            token = await self.provider.verify_token("sk_mcp_invalid")

        self.assertIsNone(token)
        verify_google.assert_not_awaited()

    async def test_database_error_fails_api_key_closed(self):
        class FailingConnection:
            async def __aenter__(self):
                raise RuntimeError("database unavailable")

            async def __aexit__(self, exc_type, exc, traceback):
                return False

        class FailingPool:
            def acquire(self):
                return FailingConnection()

        main._apikey_pool = FailingPool()
        with patch.object(
            main,
            "APIKEY_DATABASE_URL",
            "postgresql://example",
        ):
            token = await main._resolve_api_key("sk_mcp_example")

        self.assertIsNone(token)


class OAuthConfigurationTests(unittest.TestCase):
    def test_allows_mintmcp_callback(self):
        self.assertIn(
            "https://app.mintmcp.com/oauth/callback",
            main.ALLOWED_CLIENT_REDIRECT_URIS,
        )


class SqlSafetyTests(unittest.TestCase):
    def test_accepts_read_only_queries_against_public_ctes(self):
        sql = "select id, title from readable_meetings order by created_at desc"

        self.assertEqual(main._validate_agent_sql(sql), sql)

    def test_rejects_physical_tables_and_mutations(self):
        unsafe_queries = [
            "select * from meetings",
            "update readable_meetings set title = 'changed'",
            "select * from pg_catalog.pg_tables",
        ]

        for sql in unsafe_queries:
            with self.subTest(sql=sql):
                with self.assertRaises(ValueError):
                    main._validate_agent_sql(sql)

    def test_rejects_reserved_or_invalid_parameter_names(self):
        for params in ({"sql_user": "123"}, {"invalid-name": "123"}):
            with self.subTest(params=params):
                with self.assertRaises(ValueError):
                    main._normalize_sql_params(params)


class MeetingImagesPayloadTests(unittest.TestCase):
    def setUp(self):
        self.original_app_base_url = main.APP_BASE_URL

    def tearDown(self):
        main.APP_BASE_URL = self.original_app_base_url

    def test_builds_authenticated_app_route_urls(self):
        main.APP_BASE_URL = "https://app.example.com"
        payload = main._meeting_images_payload(
            "meeting-1",
            [
                {
                    "id": "asset-1",
                    "mime_type": "image/png",
                    "timestamp_ms": 65000,
                    "captured_at": None,
                },
                {
                    "id": "asset-2",
                    "mime_type": "image/jpeg",
                    "timestamp_ms": None,
                    "captured_at": None,
                },
            ],
        )

        self.assertTrue(payload["available"])
        self.assertEqual(payload["image_count"], 2)
        self.assertEqual(payload["requires_app_session"], True)
        self.assertEqual(
            payload["images"][0]["url"],
            "https://app.example.com/api/meetings/meeting-1/images/asset-1",
        )
        self.assertEqual(payload["images"][0]["timestamp_ms"], 65000)
        self.assertIsNone(payload["images"][1]["timestamp_ms"])

    def test_reports_missing_app_base_url(self):
        main.APP_BASE_URL = ""
        payload = main._meeting_images_payload("meeting-1", [])

        self.assertFalse(payload["available"])
        self.assertIn("APP_BASE_URL", payload["reason"])

    def test_marks_empty_image_lists_unavailable(self):
        main.APP_BASE_URL = "https://app.example.com"
        payload = main._meeting_images_payload("meeting-1", [])

        self.assertFalse(payload["available"])
        self.assertEqual(payload["image_count"], 0)
        self.assertEqual(payload["images"], [])


class MeetingAccessConditionTests(unittest.TestCase):
    def test_member_reads_only_owned_or_actively_shared_meetings(self):
        workspace = main.Workspace(
            email="member@example.com",
            user_id="11111111-1111-4111-8111-111111111111",
            team_id="22222222-2222-4222-8222-222222222222",
            can_create_meetings=True,
            can_manage_team_meetings=False,
        )
        params = {}

        condition = main._access_condition(workspace, params)

        self.assertIn("m.owner_user_id", condition)
        self.assertIn("access_ma.revoked_at is null", condition)
        self.assertNotIn("m.team_id", condition)
        self.assertNotIn("access_team_id", params)

    def test_manager_can_read_team_meetings(self):
        workspace = main.Workspace(
            email="admin@example.com",
            user_id="11111111-1111-4111-8111-111111111111",
            team_id="22222222-2222-4222-8222-222222222222",
            can_create_meetings=True,
            can_manage_team_meetings=True,
        )
        params = {}

        condition = main._access_condition(workspace, params)

        self.assertIn("m.team_id", condition)
        self.assertEqual(params["access_team_id"], workspace.team_id)


if __name__ == "__main__":
    unittest.main()
