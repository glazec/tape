import asyncio
import json
import os
import subprocess
import sys
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import main


class SpeakerDisplayProjectionTests(unittest.TestCase):
    def test_readable_transcript_resolves_only_authorized_display_names(self):
        query = main._build_sql_tool_query(
            "select speaker from readable_transcript_segments", "authorized_meeting", "'shared'"
        )
        self.assertIn("and authorized_meeting", query)
        self.assertIn("current_completed_transcript_jobs as (", query)
        self.assertIn("transcript_speaker_names as materialized", query)
        self.assertIn("when ms.person_id is not null then app_private.speaker_name(ms.id)", query)
        self.assertIn("else coalesce(ms.display_name, ms.source_label)", query)
        self.assertIn("on ms.meeting_id = cj.meeting_id and ms.job_id = cj.job_id", query)
        self.assertIn("and sn.meeting_id = ts.meeting_id and sn.job_id = ts.job_id", query)
        self.assertIn("coalesce(sn.speaker, ts.speaker) as speaker", query)
        self.assertNotIn("speaker_name(ts.meeting_speaker_id)", query)
        with self.assertRaises(ValueError):
            main._validate_agent_sql("select * from transcript_speaker_names")
        with self.assertRaises(ValueError):
            main._validate_agent_sql("select * from current_completed_transcript_jobs")
        self.assertNotIn("participantEmail", query)
        self.assertNotIn("person_emails", query)
        self.assertNotIn("workspace_people", query)

    def test_transcripts_include_completed_jobs_from_the_active_generation(self):
        query = main._current_transcript_jobs_query("select id from readable_meetings")
        self.assertIn("replacement.mode = 'replace'", query)
        self.assertIn("order by replacement.created_at desc, replacement.id desc", query)
        self.assertIn("tj.status = 'completed'", query)
        self.assertIn("tj.mode = 'append'", query)
        self.assertIn("tj.generation_id = lr.generation_id", query)
        self.assertIn("(tj.created_at, tj.id) > (lr.created_at, lr.id)", query)


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

    def test_allows_ipv6_loopback_callback(self):
        from fastmcp.server.auth.redirect_validation import validate_redirect_uri

        self.assertTrue(validate_redirect_uri("http://[::1]:43127/callback", main.ALLOWED_CLIENT_REDIRECT_URIS))
        self.assertFalse(validate_redirect_uri("http://[::2]:43127/callback", main.ALLOWED_CLIENT_REDIRECT_URIS))


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

    def test_accepts_safe_string_position_and_json_helpers(self):
        sql = """
select
  strpos(title, 'Marvin') as strpos_match,
  position('Marvin' in title) as position_match,
  json_build_object('id', id, 'title', title) as meeting,
  replace(split_part(title, ' ', 1), '-', '') as first_word,
  date_part('year', started_at) as year,
  rtrim(ltrim(title)) as trimmed_title,
  jsonb_array_length(jsonb_agg(jsonb_build_object('id', id)) over ()) as meeting_count,
  array_length(array[id], 1) as array_length,
  cardinality(array[id]) as cardinality
from readable_meetings
where started_at >= now()
""".strip()

        self.assertEqual(main._validate_agent_sql(sql), sql)

    def test_meeting_search_template_avoids_cartesian_left_joins(self):
        template = next(q for q in main.COMMON_SQL_QUERIES if q["id"] == "meeting_search")
        self.assertEqual(main._validate_agent_sql(template["sql"]), template["sql"])
        self.assertIn("exists (", template["sql"].lower())
        self.assertNotIn("left join", template["sql"].lower())

    def test_json_safe_handles_dates_and_timedeltas(self):
        from datetime import date, timedelta
        self.assertEqual(main._json_safe(date(2026, 11, 23)), "2026-11-23")
        self.assertEqual(main._json_safe(timedelta(seconds=90)), 90.0)

    def test_escapes_literal_percents_but_preserves_named_params(self):
        query = (
            "select * from readable_meetings "
            "where title ilike '%Marvin%' "
            "or title ilike %(query)s "
            "or title like '%%'"
        )

        self.assertEqual(
            main._escape_psycopg_literal_percents(query),
            (
                "select * from readable_meetings "
                "where title ilike '%%Marvin%%' "
                "or title ilike %(query)s "
                "or title like '%%%%'"
            ),
        )


class IdentityResolutionTests(unittest.IsolatedAsyncioTestCase):
    async def test_google_oauth_subject_falls_back_to_verified_email(self):
        user = {
            "id": "11111111-1111-4111-8111-111111111111",
            "auth_user_id": "neon-auth-user",
            "email": "momir@iosg.vc",
            "name": "Momir",
        }

        with patch.object(
            main,
            "_fetch_one",
            AsyncMock(side_effect=[None, user]),
        ) as fetch_one:
            resolved = await main._resolve_tape_user(
                "google-oauth-subject",
                "Momir@iosg.vc",
            )

        self.assertEqual(resolved.id, user["id"])
        self.assertEqual(resolved.auth_user_id, "neon-auth-user")
        self.assertEqual(resolved.email, "momir@iosg.vc")
        self.assertEqual(fetch_one.await_count, 2)

    async def test_api_key_identity_uses_the_same_verified_email_fallback(self):
        user = {
            "id": "11111111-1111-4111-8111-111111111111",
            "auth_user_id": "neon-auth-user",
            "email": "momir@iosg.vc",
            "name": "Momir",
        }

        with patch.object(
            main,
            "_fetch_one",
            AsyncMock(side_effect=[None, user]),
        ):
            resolved = await main._resolve_tape_user(
                "apikey:momir@iosg.vc",
                "momir@iosg.vc",
            )

        self.assertEqual(resolved.id, user["id"])
        self.assertEqual(resolved.email, "momir@iosg.vc")

    async def test_neon_auth_subject_resolves_directly(self):
        user = {
            "id": "11111111-1111-4111-8111-111111111111",
            "auth_user_id": "neon-auth-user",
            "email": "momir@iosg.vc",
            "name": "Momir",
        }

        with patch.object(
            main,
            "_fetch_one",
            AsyncMock(return_value=user),
        ) as fetch_one:
            resolved = await main._resolve_tape_user(
                "neon-auth-user",
                "momir@iosg.vc",
            )

        self.assertEqual(resolved.id, user["id"])
        fetch_one.assert_awaited_once()


class TimeoutConfigurationTests(unittest.TestCase):
    def test_sql_and_backend_timeout_defaults_are_sixty_seconds(self):
        env = os.environ.copy()
        env.pop("SQL_TOOL_STATEMENT_TIMEOUT_MS", None)
        env.pop("MCP_BACKEND_TIMEOUT_SECONDS", None)
        result = subprocess.run(
            [sys.executable, "-c", "import main; print(main.SQL_TOOL_STATEMENT_TIMEOUT_MS, main.MCP_BACKEND_TIMEOUT_SECONDS)"],
            env=env, check=True, capture_output=True, text=True,
        )
        self.assertEqual(result.stdout.strip(), "60000 60.0")


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

    def test_reports_wrapped_connect_timeouts_with_actionable_guidance(self):
        user = main.TapeUser(
            id="11111111-1111-4111-8111-111111111111",
            auth_user_id="auth-user-123",
            email="member@example.com",
            name=None,
        )
        with (
            patch.object(main, "APP_BASE_URL", "https://app.example.com"),
            patch.object(main, "MCP_BACKEND_SHARED_SECRET", "s" * 32),
            patch.object(
                main.urllib.request,
                "urlopen",
                side_effect=main.urllib.error.URLError(TimeoutError()),
            ),
            self.assertRaisesRegex(main.MeetingBackendError, "retry with a smaller page limit"),
        ):
            main._post_tape_backend_sync("api/mcp/read", user, {})

    def test_requires_https_for_non_local_backends(self):
        with patch.object(main, "APP_BASE_URL", "http://app.example.com"):
            with self.assertRaises(RuntimeError):
                main._backend_endpoint("/api/mcp/uploads/prepare")


class MeetingUploadToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_organization_choices_before_upload(self):
        choices = [{"teamId": "77777777-7777-4777-8777-777777777777", "teamName": "Second"}]
        with patch.object(main, "_post_tape_backend", AsyncMock(return_value={"code": "organization_required", "organizations": choices})):
            result = await main.prepare_meeting_upload(file_name="meeting.mp3", file_size_bytes=123, meeting_time="2026-08-17T15:00:00Z")
        self.assertEqual(result["code"], "organization_required")
        self.assertEqual(result["organizations"], choices)
        self.assertNotIn("upload_url", result)

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
            rows = await main._fetch_all(
                "select id from readable_meetings where title ilike '%Marvin%'",
            )

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
            "select id from readable_meetings where title ilike '%%Marvin%%'",
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

    async def test_caches_shared_only_user_without_repeated_workspace_lookups(self):
        workspace = main.Workspace(
            email="guest@example.com",
            user_id="11111111-1111-4111-8111-111111111111",
            team_id=None,
            can_create_meetings=False,
            can_manage_team_meetings=False,
        )
        claims = {"sub": "auth-guest", "email": "guest@example.com"}

        with (
            patch.object(main, "_current_user_claims", return_value=claims),
            patch.object(main, "_workspace_for_auth_user", AsyncMock(return_value=workspace)) as get_workspace,
            patch.object(main, "_record_mcp_onboarding_use", AsyncMock()) as record_usage,
        ):
            await main._record_current_mcp_onboarding_use()
            await main._record_current_mcp_onboarding_use()

        get_workspace.assert_awaited_once()
        record_usage.assert_not_awaited()

    async def test_shared_only_cache_rechecks_for_workspace_membership(self):
        guest = main.Workspace("promoted@example.com", "guest-id", None, False, False)
        member = main.Workspace("promoted@example.com", "guest-id", "team-id", True, False)
        claims = {"sub": "auth-promoted", "email": guest.email}
        with (
            patch.object(main, "_current_user_claims", return_value=claims),
            patch.object(main, "_recorded_mcp_onboarding_emails", set()),
            patch.object(main, "MCP_SHARED_ONLY_CACHE_SECONDS", 0),
            patch.object(main, "_workspace_for_auth_user", AsyncMock(side_effect=[guest, member])),
            patch.object(main, "_record_mcp_onboarding_use", AsyncMock(return_value=True)) as record_usage,
        ):
            await main._record_current_mcp_onboarding_use()
            await main._record_current_mcp_onboarding_use()

        record_usage.assert_awaited_once_with(member)


class ExecuteMeetingSqlTimeoutTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_actionable_guidance_on_statement_timeout(self):
        workspace = main.Workspace(
            email="member@example.com",
            user_id="11111111-1111-4111-8111-111111111111",
            team_id="22222222-2222-4222-8222-222222222222",
            can_create_meetings=True,
            can_manage_team_meetings=False,
        )
        with (
            patch.object(main, "_workspace_for_current_user", AsyncMock(return_value=workspace)),
            patch.object(
                main,
                "_fetch_all",
                AsyncMock(side_effect=main.psycopg.errors.QueryCanceled("canceling statement due to statement timeout")),
            ),
        ):
            with self.assertRaisesRegex(TimeoutError, "Do not retry the identical query"):
                await main.execute_meeting_sql("select id from readable_meetings")


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
        self.assertIn("access_membership.team_id = m.team_id", condition)
        self.assertIn("access_membership.role in ('admin', 'owner')", condition)
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
        self.assertIn("access_membership.user_id = %(access_user_id)s::uuid", condition)
        self.assertNotIn("access_team_id", params)


class MeetingTodosTests(unittest.IsolatedAsyncioTestCase):
    async def test_forwards_date_assignee_status_and_page(self):
        with patch.object(main, "_post_tape_backend", AsyncMock(return_value={"todos": [], "next_offset": 10})) as fetch:
            result = await main.list_meeting_todos(
                main.date(2026, 10, 22), main.date(2026, 10, 29), status="todo", assignee=" Alex ",
            )
        fetch.assert_awaited_once_with("api/mcp/read", {
            "operation": "todos", "start": "2026-10-22", "end": "2026-10-29",
            "status": "todo", "assignee": "Alex", "meetingId": None, "limit": 10, "offset": 0,
        })
        self.assertEqual(result["next_offset"], 10)


class AccessibleMeetingInventoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_filters_inventory_by_literal_title_and_timezone_aware_window(self):
        workspace = main.Workspace("member@example.com", "user-id", "team-id", True, False)
        after = datetime(2026, 11, 13, tzinfo=timezone.utc)
        before = datetime(2026, 11, 14, tzinfo=timezone.utc)
        with (
            patch.object(main, "_workspace_for_current_user", AsyncMock(return_value=workspace)),
            patch.object(main, "_fetch_all", AsyncMock(return_value=[])) as fetch,
        ):
            result = await main.list_accessible_meetings(
                title=" IC% ", started_after=after, started_before=before,
            )
            with self.assertRaisesRegex(ValueError, "timezone offset"):
                await main.list_accessible_meetings(started_after=datetime(2026, 11, 13))

        sql, params = fetch.await_args.args
        self.assertIn("order by upcoming_at asc nulls first, coalesce(started_at, created_at) desc, id", sql)
        self.assertIn("order by page.upcoming_at asc nulls first", sql)
        self.assertIn("strpos(lower(m.title)", sql)
        self.assertEqual(params["inventory_title"], "IC%")
        self.assertEqual(params["inventory_started_after"], after)
        self.assertEqual(params["inventory_started_before"], before)
        self.assertIn("reflect the supplied inventory filters", result["scope_note"])

    async def test_lists_the_complete_authorized_inventory_without_topic_filters(self):
        workspace = main.Workspace(
            email="momir@iosg.vc",
            user_id="11111111-1111-4111-8111-111111111111",
            team_id="22222222-2222-4222-8222-222222222222",
            can_create_meetings=True,
            can_manage_team_meetings=False,
        )
        rows = [
            {
                "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                "team_id": workspace.team_id,
                "owner_user_id": "33333333-3333-4333-8333-333333333333",
                "title": "Yiping",
                "platform": "zoom",
                "status": "ready",
                "started_at": None,
                "ended_at": None,
                "created_at": None,
                "total_count": 92,
            },
            {
                "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                "team_id": workspace.team_id,
                "owner_user_id": "44444444-4444-4444-8444-444444444444",
                "title": "IOSG Weekly Team Meeting",
                "platform": "zoom",
                "status": "ready",
                "started_at": None,
                "ended_at": None,
                "created_at": None,
                "total_count": 92,
            },
        ]

        with (
            patch.object(
                main,
                "_workspace_for_current_user",
                AsyncMock(return_value=workspace),
            ),
            patch.object(
                main,
                "_fetch_all",
                AsyncMock(return_value=rows),
            ) as fetch_all,
        ):
            result = await main.list_accessible_meetings(limit=50, offset=0)

        query, params = fetch_all.await_args.args
        self.assertIn("m.status::text <> 'cancelled'", query)
        self.assertIn("access_ma.revoked_at is null", query)
        self.assertNotIn("marvin", query.lower())
        self.assertEqual(params["inventory_access_user_id"], workspace.user_id)
        self.assertNotIn("inventory_access_team_id", params)
        self.assertEqual(result["returned_count"], 2)
        self.assertEqual(result["total_count"], 92)
        self.assertTrue(result["has_more"])
        self.assertEqual(result["meetings"][0]["access_scope"], "shared")

    async def test_normalizes_inventory_pagination(self):
        workspace = main.Workspace(
            email="member@example.com",
            user_id="11111111-1111-4111-8111-111111111111",
            team_id="22222222-2222-4222-8222-222222222222",
            can_create_meetings=True,
            can_manage_team_meetings=False,
        )

        with (
            patch.object(
                main,
                "_workspace_for_current_user",
                AsyncMock(return_value=workspace),
            ),
            patch.object(
                main,
                "_fetch_all",
                AsyncMock(return_value=[]),
            ) as fetch_all,
        ):
            result = await main.list_accessible_meetings(limit=5000, offset=-10)

        params = fetch_all.await_args.args[1]
        self.assertEqual(params["inventory_limit"], 500)
        self.assertEqual(params["inventory_offset"], 0)
        self.assertEqual(result["total_count"], 0)
        self.assertFalse(result["has_more"])

    async def test_preserves_total_count_when_offset_is_past_the_last_meeting(self):
        workspace = main.Workspace(
            email="member@example.com",
            user_id="11111111-1111-4111-8111-111111111111",
            team_id="22222222-2222-4222-8222-222222222222",
            can_create_meetings=True,
            can_manage_team_meetings=False,
        )
        empty_page = [
            {
                "id": None,
                "team_id": None,
                "owner_user_id": None,
                "title": None,
                "platform": None,
                "status": None,
                "started_at": None,
                "ended_at": None,
                "created_at": None,
                "total_count": 92,
            },
        ]

        with (
            patch.object(
                main,
                "_workspace_for_current_user",
                AsyncMock(return_value=workspace),
            ),
            patch.object(
                main,
                "_fetch_all",
                AsyncMock(return_value=empty_page),
            ) as fetch_all,
        ):
            result = await main.list_accessible_meetings(limit=50, offset=100)

        query = fetch_all.await_args.args[0]
        self.assertIn("left join lateral", query.lower())
        self.assertEqual(result["meetings"], [])
        self.assertEqual(result["returned_count"], 0)
        self.assertEqual(result["total_count"], 92)
        self.assertFalse(result["has_more"])


if __name__ == "__main__":
    unittest.main()
