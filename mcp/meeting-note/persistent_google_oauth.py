"""Google sessions without a proxy-imposed refresh deadline.

FastMCP still handles authorization, access token validation, upstream
refresh, and refresh token rotation. Only the local refresh credential and its
backing records have no expiry. Google can reject a refresh at any time.
"""

import inspect

try:
    from fastmcp.server.auth.oauth_proxy.models import UpstreamTokenSet, _hash_token
except ModuleNotFoundError:
    from fastmcp.server.auth.oauth_proxy import UpstreamTokenSet, _hash_token
from fastmcp.server.auth.providers.google import GoogleProvider
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    RefreshToken,
    TokenError,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken


class PersistentGoogleProvider(GoogleProvider):
    @property
    def jwt_issuer(self):
        # 2.14.1 initializes this eagerly; later versions do so in get_routes.
        if self._jwt_issuer is None:
            raise RuntimeError("OAuth routes must be initialized before token exchange")
        return self._jwt_issuer

    def _verify_session_token(self, token: str, token_use: str) -> dict:
        issuer = self.jwt_issuer
        if "expected_token_use" in inspect.signature(issuer.verify_token).parameters:
            payload = issuer.verify_token(token, expected_token_use=token_use)
        else:
            payload = issuer.verify_token(token)
        if payload.get("token_use", "access") != token_use:
            raise ValueError("Wrong token type")
        return dict(payload)

    async def load_access_token(self, token: str) -> AccessToken | None:
        # FastMCP 2.x does not distinguish access and refresh JWTs itself.
        try:
            payload = self._verify_session_token(token, "access")
            if "exp" not in payload:
                return None
        except Exception:
            return None
        return await super().load_access_token(token)

    async def _retain_upstream(self, upstream: UpstreamTokenSet) -> None:
        # Do not present FastMCP's fallback as an expiry supplied by Google.
        if not any(upstream.raw_token_data.get(field) for field in (
            "refresh_expires_in", "refresh_token_expires_in"
        )):
            upstream.refresh_token_expires_at = None
        await self._upstream_token_store.put(
            key=upstream.upstream_token_id, value=upstream, ttl=None
        )

    async def _retain_session(self, result: OAuthToken) -> OAuthToken:
        if not result.refresh_token:
            return result

        old_token = result.refresh_token
        issuer = self.jwt_issuer
        payload = self._verify_session_token(old_token, "refresh")
        mapping = await self._jti_mapping_store.get(key=payload["jti"])
        metadata = await self._refresh_token_store.get(key=_hash_token(old_token))
        upstream = (
            await self._upstream_token_store.get(key=mapping.upstream_token_id)
            if mapping else None
        )
        if mapping is None or metadata is None or upstream is None:
            raise TokenError("invalid_grant", "Session records unavailable")

        # Re-sign only the refresh credential. Its signature, issuer, audience,
        # client binding, token type and rotating JTI remain unchanged.
        payload.pop("exp", None)
        if hasattr(issuer, "_jwt"):
            token = issuer._jwt.encode(
                {"alg": "HS256", "typ": "JWT"}, payload, issuer._signing_key
            ).decode("utf-8")
        else:
            from joserfc import jwt

            token = jwt.encode(
                {"alg": "HS256", "typ": "JWT"}, payload, issuer._jwt_key,
                algorithms=["HS256"],
            )
        metadata.expires_at = None

        # All three records must survive; extending only the JWT is insufficient.
        await self._retain_upstream(upstream)
        await self._jti_mapping_store.put(key=mapping.jti, value=mapping, ttl=None)
        await self._refresh_token_store.put(
            key=_hash_token(token), value=metadata, ttl=None
        )
        if token != old_token:
            await self._refresh_token_store.delete(key=_hash_token(old_token))
        return result.model_copy(update={"refresh_token": token})

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        result = await super().exchange_authorization_code(client, authorization_code)
        return await self._retain_session(result)

    async def exchange_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: RefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        # The upstream exchange must succeed before any new credentials are issued.
        result = await super().exchange_refresh_token(client, refresh_token, scopes)
        return await self._retain_session(result)

    async def _try_transparent_refresh(
        self, upstream_token_set: UpstreamTokenSet
    ) -> UpstreamTokenSet:
        upstream = await super()._try_transparent_refresh(upstream_token_set)
        await self._retain_upstream(upstream)
        return upstream

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        mapping = None
        if isinstance(token, RefreshToken):
            payload = self._verify_session_token(token.token, "refresh")
            mapping = await self._jti_mapping_store.get(key=payload["jti"])
        await super().revoke_token(token)
        if mapping is not None:
            # These records no longer have a TTL to clean them up after logout.
            await self._jti_mapping_store.delete(key=mapping.jti)
            await self._upstream_token_store.delete(key=mapping.upstream_token_id)
