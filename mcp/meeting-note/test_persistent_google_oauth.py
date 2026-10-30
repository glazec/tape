import time
import unittest
from contextlib import contextmanager, nullcontext
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, patch

import httpx
from authlib.integrations.base_client.errors import OAuthError
from fastmcp.server.auth.jwt_issuer import JoseError
from fastmcp import FastMCP
try:
    from fastmcp.server.auth.oauth_proxy.models import ClientCode
except ModuleNotFoundError:
    from fastmcp.server.auth.oauth_proxy import ClientCode
from fastmcp.server.auth.providers.google import GoogleProvider
try:
    from key_value.aio.stores.disk import DiskStore
except ImportError:
    DiskStore = None
    from key_value.aio.stores.filetree import (
        FileTreeStore, FileTreeV1KeySanitizationStrategy,
        FileTreeV1CollectionSanitizationStrategy,
    )
from key_value.aio.wrappers.encryption import FernetEncryptionWrapper
from mcp.server.auth.provider import AuthorizationCode, TokenError
from mcp.shared.auth import OAuthClientInformationFull
from pydantic import AnyUrl

from persistent_google_oauth import PersistentGoogleProvider


@contextmanager
def at_time(timestamp):
    class ClockDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.fromtimestamp(timestamp, tz=tz)

    datetime_clock = (
        patch("key_value.aio._utils.time_to_live.datetime", ClockDateTime)
        if DiskStore is None else nullcontext()
    )
    with patch("time.time", return_value=timestamp), datetime_clock:
        yield


class PersistentGoogleOAuthTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.now = int(time.time())
        self.client = OAuthClientInformationFull(
            client_id="test-client",
            redirect_uris=[AnyUrl("http://localhost/callback")],
            token_endpoint_auth_method="none",
            grant_types=["authorization_code", "refresh_token"],
        )
        self.provider = self.make_provider()

    def make_provider(self, cls=PersistentGoogleProvider):
        if DiskStore is not None:
            disk = DiskStore(directory=self.directory.name)
            self.addAsyncCleanup(disk.__aexit__, None, None, None)
        else:
            disk = FileTreeStore(
                data_directory=Path(self.directory.name),
                key_sanitization_strategy=FileTreeV1KeySanitizationStrategy(Path(self.directory.name)),
                collection_sanitization_strategy=FileTreeV1CollectionSanitizationStrategy(Path(self.directory.name)),
            )
        provider = cls(
            client_id="google-test-client",
            client_secret="test-secret",
            base_url="https://mcp.example.test",
            jwt_signing_key="test-signing-key-" + "a" * 32,
            client_storage=FernetEncryptionWrapper(
                key_value=disk,
                source_material="test-storage-key",
                salt="test-oauth-storage",
            ),
        )
        provider.get_routes(mcp_path="/mcp")
        return provider

    async def issue(self, provider=None, **overrides):
        provider = provider or self.provider
        tokens = {
            "access_token": "google-access",
            "refresh_token": "google-refresh",
            "expires_in": 3600,
            "scope": "openid",
            **overrides,
        }
        await provider.register_client(self.client)
        await provider._code_store.put(
            key="test-code",
            value=ClientCode(
                code="test-code",
                client_id=self.client.client_id,
                redirect_uri="http://localhost/callback",
                code_challenge=None,
                code_challenge_method="S256",
                scopes=["openid"],
                idp_tokens=tokens,
                expires_at=time.time() + 300,
                created_at=time.time(),
            ),
            ttl=300,
        )
        return await provider.exchange_authorization_code(
            self.client,
            AuthorizationCode(
                code="test-code",
                scopes=["openid"],
                expires_at=time.time() + 300,
                client_id=self.client.client_id,
                code_challenge="",
                redirect_uri=AnyUrl("http://localhost/callback"),
                redirect_uri_provided_explicitly=True,
            ),
        )

    async def refresh(self, provider, token, response=None):
        loaded = await provider.load_refresh_token(self.client, token)
        self.assertIsNotNone(loaded)
        upstream = AsyncMock(return_value=response or {
            "access_token": "google-refreshed-access", "expires_in": 3600
        })
        with patch("authlib.integrations.httpx_client.AsyncOAuth2Client.refresh_token", new=upstream):
            result = await provider.exchange_refresh_token(self.client, loaded, ["openid"])
        upstream.assert_awaited_once()
        self.assertEqual(upstream.call_args.kwargs["refresh_token"], "google-refresh")
        return result

    async def test_refresh_has_no_deadline_but_access_still_expires(self):
        result = await self.issue()
        refresh = self.provider._verify_session_token(result.refresh_token, "refresh")
        access = self.provider.jwt_issuer.verify_token(result.access_token)
        self.assertNotIn("exp", refresh)
        self.assertEqual(result.expires_in, 3600)
        self.assertLessEqual(access["exp"], time.time() + 3600)
        loaded = await self.provider.load_refresh_token(self.client, result.refresh_token)
        self.assertIsNone(loaded.expires_at)
        with at_time(self.now + 7200):
            with self.assertRaises(JoseError):
                self.provider.jwt_issuer.verify_token(result.access_token)

    async def test_idle_session_survives_years_and_provider_restart(self):
        result = await self.issue()
        for days in (31, 400, 4000):
            with at_time(self.now + days * 86400):
                restarted = self.make_provider()
                self.assertIsNotNone(await restarted.get_client(self.client.client_id))
                previous = result.refresh_token
                result = await self.refresh(restarted, previous)
                self.assertIsNone(await restarted.load_refresh_token(self.client, previous))
                self.assertNotEqual(previous, result.refresh_token)
                self.assertNotIn("exp", restarted._verify_session_token(result.refresh_token, "refresh"))

    async def test_valid_legacy_session_converts_on_refresh(self):
        legacy = await self.issue(self.make_provider(GoogleProvider))
        with at_time(self.now + 20 * 86400):
            result = await self.refresh(self.provider, legacy.refresh_token)
        with at_time(self.now + 400 * 86400):
            await self.refresh(self.make_provider(), result.refresh_token)

    async def test_expired_legacy_session_is_not_resurrected(self):
        legacy = await self.issue(self.make_provider(GoogleProvider))
        with at_time(self.now + 4000 * 86400):
            self.assertIsNone(await self.provider.load_refresh_token(self.client, legacy.refresh_token))

    async def test_google_rejection_still_blocks_refresh(self):
        result = await self.issue()
        loaded = await self.provider.load_refresh_token(self.client, result.refresh_token)
        upstream = AsyncMock(side_effect=OAuthError("invalid_grant", "revoked or expired"))
        with patch("authlib.integrations.httpx_client.AsyncOAuth2Client.refresh_token", new=upstream):
            with self.assertRaises(TokenError):
                await self.provider.exchange_refresh_token(self.client, loaded, ["openid"])

    async def test_wrong_client_and_refresh_as_access_are_rejected(self):
        result = await self.issue()
        other = self.client.model_copy(update={"client_id": "other-client"})
        self.assertIsNone(await self.provider.load_refresh_token(other, result.refresh_token))
        self.assertIsNone(await self.provider.load_access_token(result.refresh_token))

    async def test_no_google_refresh_token_does_not_create_permanent_session(self):
        result = await self.issue(refresh_token=None)
        self.assertIsNone(result.refresh_token)
        self.assertEqual(result.expires_in, 3600)

    async def test_local_revocation_removes_session_and_credentials(self):
        result = await self.issue()
        payload = self.provider._verify_session_token(result.refresh_token, "refresh")
        mapping = await self.provider._jti_mapping_store.get(key=payload["jti"])
        loaded = await self.provider.load_refresh_token(self.client, result.refresh_token)
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock):
            await self.provider.revoke_token(loaded)
        self.assertIsNone(await self.provider.load_refresh_token(self.client, result.refresh_token))
        self.assertIsNone(await self.provider._jti_mapping_store.get(key=payload["jti"]))
        self.assertIsNone(await self.provider._upstream_token_store.get(key=mapping.upstream_token_id))

    async def test_http_refresh_after_a_year_rotates_and_rejects_replay(self):
        result = await self.issue()
        app = FastMCP("test", auth=self.provider).http_app()
        upstream = AsyncMock(return_value={"access_token": "fresh-google-access", "expires_in": 3600})
        with at_time(self.now + 400 * 86400), patch(
            "authlib.integrations.httpx_client.AsyncOAuth2Client.refresh_token", new=upstream
        ):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="https://mcp.example.test"
            ) as client:
                form = {"grant_type": "refresh_token", "client_id": "test-client",
                        "refresh_token": result.refresh_token}
                response = await client.post("/token", data=form)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["expires_in"], 3600)
                self.assertNotIn("exp", self.provider._verify_session_token(
                    response.json()["refresh_token"], "refresh"
                ))
                replay = await client.post("/token", data=form)
                self.assertIn(replay.status_code, (400, 401), replay.text)
                self.assertEqual(replay.json()["error"], "invalid_grant")
        upstream.assert_awaited_once()

    @unittest.skipUnless(hasattr(GoogleProvider, "_try_transparent_refresh"), "No transparent refresh in this FastMCP version")
    async def test_transparent_refresh_does_not_restore_storage_deadline(self):
        result = await self.issue()
        payload = self.provider._verify_session_token(result.refresh_token, "refresh")
        mapping = await self.provider._jti_mapping_store.get(key=payload["jti"])
        record = await self.provider._upstream_token_store.get(key=mapping.upstream_token_id)
        upstream = AsyncMock(return_value={
            "access_token": "transparent-access", "refresh_token": "google-refresh",
            "expires_in": 3600,
        })
        with patch("authlib.integrations.httpx_client.AsyncOAuth2Client.refresh_token", new=upstream):
            await self.provider._try_transparent_refresh(record)
        with at_time(self.now + 400 * 86400):
            await self.refresh(self.make_provider(), result.refresh_token)

    async def test_google_expiry_is_still_enforced_by_upstream(self):
        result = await self.issue(refresh_token_expires_in=60)
        with at_time(self.now + 120):
            loaded = await self.provider.load_refresh_token(self.client, result.refresh_token)
            self.assertIsNotNone(loaded)
            upstream = AsyncMock(side_effect=OAuthError("invalid_grant", "expired"))
            with patch("authlib.integrations.httpx_client.AsyncOAuth2Client.refresh_token", new=upstream):
                with self.assertRaises(TokenError):
                    await self.provider.exchange_refresh_token(self.client, loaded, ["openid"])
            upstream.assert_awaited_once()

    async def test_modified_refresh_signature_is_rejected(self):
        result = await self.issue()
        header, payload, signature = result.refresh_token.split(".")
        signature = ("A" if signature[0] != "A" else "B") + signature[1:]
        with self.assertRaises(JoseError):
            self.provider._verify_session_token(f"{header}.{payload}.{signature}", "refresh")


if __name__ == "__main__":
    unittest.main()
