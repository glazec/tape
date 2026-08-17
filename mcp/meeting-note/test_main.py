import asyncio
import json
import unittest
from types import SimpleNamespace
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


class MeetingBackendRequestTests(unittest.TestCase):
    class Response:
        def __init__(self, payload):
            self.payload = payload

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return json.dumps(self.payload).encode()

    def test_signs_canonical_user_and_request_body(self):
        user = main.TapeUser(
            id="11111111-1111-4111-8111-111111111111",
            auth_user_id="auth-user-123",
            email="member@example.com",
            name="Member",
        )

        with (
            patch.object(main, "APP_BASE_URL", "https://app.example.com"),
            patch.object(main, "MCP_BACKEND_SHARED_SECRET", "s" * 32),
            patch.object(main.time, "time", return_value=1_776_590_400),
            patch.object(
                main,
                "uuid4",
                return_value="request-123",
            ),
            patch.object(
                main.urllib.request,
                "urlopen",
                return_value=self.Response({"uploadId": "upload-123"}),
            ) as urlopen,
        ):
            result = main._post_tape_backend_sync(
                "/api/mcp/uploads/prepare",
                user,
                {"fileName": "meeting.mp3"},
            )
            request = urlopen.call_args.args[0]
            body = request.data.decode()
            expected_signature = main._backend_signature(
                f"request-123.1776590400.{body}",
            )

        self.assertEqual(result, {"uploadId": "upload-123"})
        self.assertEqual(
            json.loads(body),
            {
                "input": {"fileName": "meeting.mp3"},
                "user": {
                    "email": "member@example.com",
                    "id": "auth-user-123",
                    "name": "Member",
                },
            },
        )
        self.assertEqual(
            request.get_header("X-tape-mcp-signature"),
            f"v1,{expected_signature}",
        )
        self.assertEqual(
            request.full_url,
            "https://app.example.com/api/mcp/uploads/prepare",
        )

    def test_requires_https_for_non_local_backends(self):
        with patch.object(main, "APP_BASE_URL", "http://app.example.com"):
            with self.assertRaises(RuntimeError):
                main._backend_endpoint("/api/mcp/uploads/prepare")


class MeetingUploadToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_prepares_direct_upload_without_exposing_local_path(self):
        backend_result = {
            "completionToken": "completion-token",
            "contentType": "audio/mpeg",
            "expiresAt": "2026-08-17T15:15:00.000Z",
            "uploadHeaders": {"Content-Type": "audio/mpeg"},
            "uploadId": "upload-123",
            "uploadMethod": "PUT",
            "uploadUrl": "https://uploads.example.com/signed",
        }

        with (
            patch.object(main, "_current_user_id", return_value="user-123"),
            patch.object(
                main,
                "_post_tape_backend",
                AsyncMock(return_value=backend_result),
            ) as post_backend,
        ):
            result = await main.prepare_meeting_upload(
                file_name="/private/recordings/meeting.mp3",
                file_size_bytes=123,
                meeting_time="2026-08-17T11:00:00-04:00",
                duration_ms=60_000,
                title="MCP test meeting",
            )

        post_backend.assert_awaited_once_with(
            "/api/mcp/uploads/prepare",
            {
                "contentType": "audio/mpeg",
                "durationMs": 60_000,
                "fileName": "meeting.mp3",
                "fileSizeBytes": 123,
                "meetingTime": "2026-08-17T15:00:00Z",
                "title": "MCP test meeting",
            },
        )
        self.assertEqual(result["upload_url"], backend_result["uploadUrl"])
        self.assertEqual(result["next_tool"], "complete_meeting_upload")
        self.assertNotIn("/private/recordings", json.dumps(result))

    async def test_rejects_meeting_time_without_timezone(self):
        with patch.object(
            main,
            "_post_tape_backend",
            AsyncMock(),
        ) as post_backend:
            with self.assertRaisesRegex(ValueError, "timezone"):
                await main.prepare_meeting_upload(
                    file_name="meeting.mp3",
                    file_size_bytes=123,
                    meeting_time="2026-08-17T11:00:00",
                )

        post_backend.assert_not_awaited()

    async def test_completes_upload_and_returns_meeting_link(self):
        with (
            patch.object(main, "APP_BASE_URL", "https://tape.example.com"),
            patch.object(main, "_current_user_id", return_value="user-123"),
            patch.object(
                main,
                "_post_tape_backend",
                AsyncMock(
                    return_value={
                        "delayedCount": 0,
                        "existing": False,
                        "meetingId": "11111111-1111-4111-8111-111111111111",
                        "queued": True,
                        "status": "processing",
                    },
                ),
            ) as post_backend,
        ):
            result = await main.complete_meeting_upload("completion-token")

        post_backend.assert_awaited_once_with(
            "/api/mcp/uploads/complete",
            {"completionToken": "completion-token"},
        )
        self.assertEqual(
            result["meeting_url"],
            "https://tape.example.com/meetings/11111111-1111-4111-8111-111111111111",
        )
        self.assertTrue(result["queued"])


class RlsQueryContextTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        main._recorded_mcp_onboarding_emails.clear()

    async def test_sets_verified_caller_claims_before_the_query(self):
        class Cursor:
            def __init__(self):
                self.execute = AsyncMock()

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return False

            async def fetchall(self):
                return [{"id": "meeting-1"}]

        class Connection:
            def __init__(self, cursor):
                self._cursor = cursor

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return False

            def cursor(self):
                return self._cursor

        cursor = Cursor()
        connection = Connection(cursor)
        claims = {
            "sub": "auth-user-1",
            "email": "member@example.com",
        }

        with (
            patch.object(main, "DATABASE_URL", "postgresql://example"),
            patch.object(
                main.psycopg.AsyncConnection,
                "connect",
                AsyncMock(return_value=connection),
            ),
            patch.object(main, "_current_user_claims", return_value=claims),
        ):
            rows = await main._fetch_all("select id from readable_meetings")

        self.assertEqual(rows, [{"id": "meeting-1"}])
        self.assertEqual(
            cursor.execute.await_args_list[2].args[0],
            "select set_config('request.jwt.claims', %s, true)",
        )
        self.assertIn(
            '"sub": "auth-user-1"',
            cursor.execute.await_args_list[2].args[1][0],
        )
        self.assertEqual(
            cursor.execute.await_args_list[3].args[0],
            "select id from readable_meetings",
        )

    async def test_records_mcp_onboarding_use_with_verified_claims(self):
        class Cursor:
            def __init__(self):
                self.execute = AsyncMock()

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return False

        class Connection:
            def __init__(self, cursor):
                self._cursor = cursor

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return False

            def cursor(self):
                return self._cursor

        cursor = Cursor()
        connection = Connection(cursor)
        claims = {
            "sub": "auth-user-1",
            "email": "member@example.com",
        }
        workspace = main.Workspace(
            email="member@example.com",
            user_id="11111111-1111-4111-8111-111111111111",
            team_id="22222222-2222-4222-8222-222222222222",
            can_create_meetings=True,
            can_manage_team_meetings=False,
        )

        with (
            patch.object(main, "DATABASE_URL", "postgresql://example"),
            patch.object(
                main.psycopg.AsyncConnection,
                "connect",
                AsyncMock(return_value=connection),
            ),
            patch.object(main, "_current_user_claims", return_value=claims),
        ):
            recorded = await main._record_mcp_onboarding_use(workspace)

        self.assertTrue(recorded)
        self.assertIn(
            '"sub": "auth-user-1"',
            cursor.execute.await_args_list[0].args[1][0],
        )
        self.assertEqual(
            cursor.execute.await_args_list[1].args,
            (
                "select app_private.record_mcp_onboarding_use(%s::uuid)",
                (workspace.team_id,),
            ),
        )


class McpOnboardingUsageMiddlewareTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        main._recorded_mcp_onboarding_emails.clear()

    def test_is_registered_for_all_tools(self):
        self.assertTrue(
            any(
                isinstance(middleware, main.McpOnboardingUsageMiddleware)
                for middleware in main.mcp.middleware
            ),
        )

    async def test_records_every_successful_tool_call(self):
        context = SimpleNamespace()
        result = SimpleNamespace(is_error=False)
        call_next = AsyncMock(return_value=result)

        with patch.object(
            main,
            "_record_current_mcp_onboarding_use",
            AsyncMock(),
        ) as record_usage:
            returned = await main.McpOnboardingUsageMiddleware().on_call_tool(
                context,
                call_next,
            )

        self.assertIs(returned, result)
        call_next.assert_awaited_once_with(context)
        record_usage.assert_awaited_once_with()

    async def test_does_not_record_failed_tool_calls(self):
        result = SimpleNamespace(is_error=True)

        with patch.object(
            main,
            "_record_current_mcp_onboarding_use",
            AsyncMock(),
        ) as record_usage:
            returned = await main.McpOnboardingUsageMiddleware().on_call_tool(
                SimpleNamespace(),
                AsyncMock(return_value=result),
            )

        self.assertIs(returned, result)
        record_usage.assert_not_awaited()

    async def test_returns_tool_result_when_usage_recording_times_out(self):
        result = SimpleNamespace(is_error=False)

        async def slow_recording():
            await asyncio.sleep(1)

        with (
            patch.object(
                main,
                "MCP_ONBOARDING_USAGE_TIMEOUT_SECONDS",
                0.001,
            ),
            patch.object(
                main,
                "_record_current_mcp_onboarding_use",
                AsyncMock(side_effect=slow_recording),
            ),
        ):
            returned = await main.McpOnboardingUsageMiddleware().on_call_tool(
                SimpleNamespace(),
                AsyncMock(return_value=result),
            )

        self.assertIs(returned, result)

    async def test_caches_successful_usage_by_verified_email(self):
        workspace = main.Workspace(
            email="member@example.com",
            user_id="11111111-1111-4111-8111-111111111111",
            team_id="22222222-2222-4222-8222-222222222222",
            can_create_meetings=True,
            can_manage_team_meetings=False,
        )
        claims = {
            "sub": "auth-user-1",
            "email": "Member@Example.com",
        }

        with (
            patch.object(main, "_current_user_claims", return_value=claims),
            patch.object(
                main,
                "_workspace_for_auth_user",
                AsyncMock(return_value=workspace),
            ) as get_workspace,
            patch.object(
                main,
                "_record_mcp_onboarding_use",
                AsyncMock(return_value=True),
            ) as record_usage,
        ):
            await main._record_current_mcp_onboarding_use()
            await main._record_current_mcp_onboarding_use()

        get_workspace.assert_awaited_once_with(
            "auth-user-1",
            "Member@Example.com",
        )
        record_usage.assert_awaited_once_with(workspace)


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
