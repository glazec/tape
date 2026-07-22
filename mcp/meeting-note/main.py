"""Meeting Note FastMCP server.

Read only SQL tools for meeting data plus audio URL retrieval.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import UUID
import asyncio
import atexit
import os
import re

from dotenv import load_dotenv

load_dotenv()

import psycopg
import jwt
import sqlglot
from fastmcp import FastMCP
from fastmcp.server.auth import AccessToken, AuthProvider, MultiAuth, TokenVerifier
from fastmcp.server.auth.providers.google import GoogleProvider
from fastmcp.server.dependencies import get_access_token
from jwt import PyJWKClient, PyJWTError
from key_value.aio.stores.filetree import (
    FileTreeStore,
    FileTreeV1CollectionSanitizationStrategy,
    FileTreeV1KeySanitizationStrategy,
)
from key_value.aio.wrappers.encryption import FernetEncryptionWrapper
from psycopg.rows import dict_row
from sqlglot import exp
from sqlglot.errors import ParseError

SERVICE_NAME = "meeting-note-mcp"
DISABLE_AUTH = os.environ.get("DISABLE_AUTH", "false").strip().lower() in {
    "1",
    "true",
    "yes",
}
MCP_ALLOW_DEV_AUTH = os.environ.get("MCP_ALLOW_DEV_AUTH", "false").strip().lower() in {
    "1",
    "true",
    "yes",
}
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
APP_BASE_URL = os.environ.get("APP_BASE_URL", "").strip().rstrip("/")
DEFAULT_MCP_HOST = "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1"
MCP_HOST = os.environ.get("MCP_HOST", DEFAULT_MCP_HOST).strip() or DEFAULT_MCP_HOST
MCP_PORT = int(os.environ.get("PORT") or os.environ.get("MCP_PORT", "8000"))
SQL_TOOL_STATEMENT_TIMEOUT_MS = int(
    os.environ.get("SQL_TOOL_STATEMENT_TIMEOUT_MS", "10000"),
)
NEON_AUTH_ISSUER = os.environ.get("NEON_AUTH_ISSUER", "").strip()
NEON_AUTH_AUDIENCE = os.environ.get("NEON_AUTH_AUDIENCE", "").strip() or None
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
FASTMCP_JWT_SIGNING_KEY = os.environ.get("FASTMCP_JWT_SIGNING_KEY", "").strip()
OAUTH_STORAGE_PATH = os.environ.get("OAUTH_STORAGE_PATH", "./oauth_data").strip()
NEON_AUTH_ALLOWED_ALGORITHMS = {
    "RS256",
    "RS384",
    "RS512",
    "ES256",
    "ES384",
    "ES512",
    "PS256",
    "PS384",
    "PS512",
    "EdDSA",
}
SAFE_SQL_CTES = {
    "readable_meetings",
    "readable_transcript_segments",
    "readable_meeting_entities",
    "readable_meeting_participants",
}
SQL_SCHEMA = {
    "readable_meetings": {
        "description": "One row per readable, non cancelled meeting.",
        "columns": [
            {"name": "id", "type": "uuid", "description": "Meeting id."},
            {"name": "team_id", "type": "uuid", "description": "Workspace team id. Null for shared rows."},
            {"name": "title", "type": "text", "description": "Meeting title."},
            {"name": "platform", "type": "text", "description": "google_meet, zoom, in_person, or upload."},
            {"name": "status", "type": "text", "description": "scheduled, recording, processing, ready, failed, missed, or cancelled. Cancelled rows are excluded."},
            {"name": "access_scope", "type": "text", "description": "workspace or shared."},
            {"name": "meeting_url", "type": "text", "description": "Original meeting URL for workspace scoped rows. Null for shared rows."},
            {"name": "started_at", "type": "timestamptz", "description": "Meeting start time when known."},
            {"name": "ended_at", "type": "timestamptz", "description": "Meeting end time when known."},
            {"name": "created_at", "type": "timestamptz", "description": "Row creation time."},
            {"name": "team_meeting_key", "type": "text", "description": "Stable grouping key for workspace scoped recurring or related team meetings. Null for shared rows."},
        ],
    },
    "readable_transcript_segments": {
        "description": "Current transcript segments for readable meetings, one row per segment.",
        "columns": [
            {"name": "meeting_id", "type": "uuid", "description": "Meeting id."},
            {"name": "meeting_title", "type": "text", "description": "Meeting title."},
            {"name": "meeting_access_scope", "type": "text", "description": "workspace or shared."},
            {"name": "meeting_started_at", "type": "timestamptz", "description": "Meeting start time."},
            {"name": "meeting_created_at", "type": "timestamptz", "description": "Meeting row creation time."},
            {"name": "segment_id", "type": "uuid", "description": "Transcript segment id."},
            {"name": "speaker", "type": "text", "description": "Speaker label from diarization or user correction."},
            {"name": "start_ms", "type": "integer", "description": "Segment start relative to meeting audio."},
            {"name": "end_ms", "type": "integer", "description": "Segment end relative to meeting audio."},
            {"name": "text", "type": "text", "description": "Raw transcript text."},
            {"name": "polished_text", "type": "text", "description": "Original language polished transcript text when available."},
            {"name": "translated_text", "type": "text", "description": "Translated transcript text when available."},
            {"name": "emotion_label", "type": "text", "description": "Optional emotion label."},
            {"name": "emotion_reason", "type": "text", "description": "Optional emotion reasoning."},
        ],
    },
    "readable_meeting_entities": {
        "description": "Entities extracted from readable meetings.",
        "columns": [
            {"name": "meeting_id", "type": "uuid", "description": "Meeting id."},
            {"name": "meeting_title", "type": "text", "description": "Meeting title."},
            {"name": "meeting_access_scope", "type": "text", "description": "workspace or shared."},
            {"name": "entity_id", "type": "uuid", "description": "Entity id."},
            {"name": "segment_id", "type": "uuid", "description": "Transcript segment id when the entity came from a segment."},
            {"name": "type", "type": "text", "description": "Entity type such as organization, name, money, product, or meeting_link."},
            {"name": "value", "type": "text", "description": "Displayed entity value."},
            {"name": "normalized_value", "type": "text", "description": "Lowercase normalized entity value for joining and grouping."},
            {"name": "aliases", "type": "jsonb", "description": "Known aliases for the entity."},
            {"name": "source", "type": "text", "description": "Entity source such as transcript, calendar, meeting_url, or elevenlabs."},
        ],
    },
    "readable_meeting_participants": {
        "description": "Participants from attendee records and speaker timeline records for workspace scoped readable meetings.",
        "columns": [
            {"name": "meeting_id", "type": "uuid", "description": "Meeting id."},
            {"name": "meeting_title", "type": "text", "description": "Meeting title."},
            {"name": "meeting_access_scope", "type": "text", "description": "Always workspace. Shared scoped rows do not expose participant emails."},
            {"name": "email", "type": "text", "description": "Participant email when known."},
            {"name": "name", "type": "text", "description": "Participant name when known."},
            {"name": "source", "type": "text", "description": "attendee or timeline."},
        ],
    },
}
COMMON_SQL_QUERIES = [
    {
        "id": "keyword_context",
        "category": "transcript_search",
        "title": "Search every transcript for a keyword with nearby context",
        "params": {"keyword": "%portfolio%"},
        "sql": """
with ordered_segments as (
  select
    meeting_id,
    meeting_title,
    meeting_started_at,
    speaker,
    start_ms,
    text,
    lag(text, 2) over (partition by meeting_id order by start_ms) as context_before_2,
    lag(text, 1) over (partition by meeting_id order by start_ms) as context_before_1,
    lead(text, 1) over (partition by meeting_id order by start_ms) as context_after_1,
    lead(text, 2) over (partition by meeting_id order by start_ms) as context_after_2
  from readable_transcript_segments
)
select *
from ordered_segments
where text ilike %(keyword)s
order by meeting_started_at desc, start_ms asc
""".strip(),
    },
    {
        "id": "person_speaking_timeline",
        "category": "speaker",
        "title": "Pull one person's speaking across meetings in time order",
        "params": {"person": "%James%"},
        "sql": """
select
  meeting_id,
  meeting_title,
  speaker,
  meeting_started_at,
  start_ms,
  coalesce(translated_text, polished_text, text) as best_text
from readable_transcript_segments
where speaker ilike %(person)s
order by meeting_started_at asc, start_ms asc
""".strip(),
    },
    {
        "id": "meeting_search",
        "category": "meeting_search",
        "title": "Search meetings by title, participant, entity, or transcript text",
        "params": {"query": "%Solana%"},
        "sql": """
select distinct
  m.id,
  m.title,
  m.platform,
  m.status,
  m.started_at
from readable_meetings m
left join readable_meeting_participants p on p.meeting_id = m.id
left join readable_meeting_entities e on e.meeting_id = m.id
left join readable_transcript_segments t on t.meeting_id = m.id
where
  m.title ilike %(query)s
  or p.email ilike %(query)s
  or p.name ilike %(query)s
  or e.value ilike %(query)s
  or e.normalized_value ilike %(query)s
  or t.text ilike %(query)s
  or t.polished_text ilike %(query)s
  or t.translated_text ilike %(query)s
order by m.started_at desc nulls last
""".strip(),
    },
    {
        "id": "related_meetings",
        "category": "related",
        "title": "Find meetings related by shared entities",
        "params": {"meeting_id": "00000000-0000-0000-0000-000000000000"},
        "sql": """
with target_entities as (
  select type, normalized_value
  from readable_meeting_entities
  where meeting_id = %(meeting_id)s::uuid
)
select
  e.meeting_id,
  e.meeting_title,
  count(*) as shared_entity_count,
  array_agg(distinct e.normalized_value order by e.normalized_value) as shared_entities
from readable_meeting_entities e
join target_entities target
  on target.type = e.type
 and target.normalized_value = e.normalized_value
where e.meeting_id <> %(meeting_id)s::uuid
group by e.meeting_id, e.meeting_title
order by shared_entity_count desc, e.meeting_title asc
""".strip(),
    },
    {
        "id": "meeting_transcript_best_text",
        "category": "transcript",
        "title": "Get best available transcript text for one meeting",
        "params": {"meeting_id": "00000000-0000-0000-0000-000000000000"},
        "sql": """
select
  speaker,
  start_ms,
  end_ms,
  coalesce(translated_text, polished_text, text) as best_text
from readable_transcript_segments
where meeting_id = %(meeting_id)s::uuid
order by start_ms asc
""".strip(),
    },
]
FORBIDDEN_SQL_KEYWORDS = {
    "alter",
    "analyze",
    "begin",
    "call",
    "commit",
    "copy",
    "create",
    "delete",
    "do",
    "drop",
    "execute",
    "explain",
    "grant",
    "insert",
    "merge",
    "refresh",
    "reset",
    "revoke",
    "rollback",
    "set",
    "truncate",
    "update",
    "vacuum",
}
FORBIDDEN_SQL_TABLES = {
    "allowed_domains",
    "audit_events",
    "calendar_connections",
    "calendar_events",
    "local_recorder_device_sessions",
    "local_recorder_devices",
    "local_recording_attempts",
    "local_recordings",
    "media_assets",
    "meeting_access",
    "meeting_attendees",
    "meeting_entities",
    "meeting_library_views",
    "meeting_participant_timeline",
    "meeting_reminders",
    "meeting_share_invites",
    "meetings",
    "oauth_accounts",
    "information_schema",
    "pg_catalog",
    "pg_class",
    "pg_namespace",
    "pg_roles",
    "pg_stat_activity",
    "pg_tables",
    "pg_user",
    "recordings",
    "share_links",
    "team_meeting_bot_profiles",
    "team_memberships",
    "team_vocabulary_terms",
    "teams",
    "transcript_jobs",
    "transcript_segments",
    "users",
    "vendor_webhook_events",
}
SQL_CALL_SYNTAX_KEYWORDS = {
    "and",
    "as",
    "by",
    "case",
    "cast",
    "else",
    "exists",
    "filter",
    "from",
    "in",
    "not",
    "or",
    "over",
    "then",
    "when",
    "where",
    "window",
}
ALLOWED_SQL_FUNCTIONS = {
    "abs",
    "array_agg",
    "avg",
    "bool_and",
    "bool_or",
    "btrim",
    "ceil",
    "ceiling",
    "char_length",
    "coalesce",
    "concat",
    "concat_ws",
    "count",
    "date_trunc",
    "dense_rank",
    "extract",
    "first_value",
    "floor",
    "greatest",
    "json_agg",
    "lag",
    "last_value",
    "lead",
    "least",
    "left",
    "length",
    "lower",
    "max",
    "min",
    "nullif",
    "rank",
    "regexp_replace",
    "right",
    "round",
    "row_number",
    "string_agg",
    "substring",
    "sum",
    "to_char",
    "trim",
    "upper",
}


@dataclass(frozen=True)
class Workspace:
    email: str
    user_id: str
    team_id: str | None
    can_create_meetings: bool
    can_manage_team_meetings: bool


class MeetingAccessError(Exception):
    """Raised when the caller cannot read the requested meeting."""


def _optional_env(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


def _require_https_url(value: str, name: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        raise RuntimeError(f"{name} must be an https URL")
    return value


def _is_local_host(value: str) -> bool:
    parsed = urlparse(value if "://" in value else f"http://{value}")
    host = (parsed.hostname or value).lower()
    return host in {"127.0.0.1", "::1", "localhost"}


def _production_runtime_detected() -> bool:
    if os.environ.get("NODE_ENV", "").strip().lower() == "production":
        return True
    if os.environ.get("ENVIRONMENT", "").strip().lower() == "production":
        return True

    return any(
        os.environ.get(name)
        for name in (
            "VERCEL",
            "VERCEL_ENV",
            "RAILWAY_ENVIRONMENT",
            "RAILWAY_PROJECT_ID",
            "RENDER",
            "FLY_APP_NAME",
            "K_SERVICE",
        )
    )


def _validate_dev_auth_runtime() -> None:
    if _production_runtime_detected():
        raise RuntimeError("Dev auth bypass is not allowed in production runtimes")
    if not _is_local_host(MCP_HOST):
        raise RuntimeError("Dev auth bypass requires MCP_HOST to be localhost")

    for name in ("MCP_BASE_URL", "BASE_URL", "APP_BASE_URL"):
        value = _optional_env(name)
        if value and not _is_local_host(value):
            raise RuntimeError(f"Dev auth bypass requires {name} to be localhost")


def _neon_auth_jwks_url() -> str:
    jwks_url = _optional_env("NEON_AUTH_JWKS_URL")
    if jwks_url:
        if not urlparse(jwks_url).path.endswith("/.well-known/jwks.json"):
            raise RuntimeError(
                "NEON_AUTH_JWKS_URL must end with /.well-known/jwks.json",
            )
        return _require_https_url(jwks_url, "NEON_AUTH_JWKS_URL")

    base_url = _optional_env("NEON_AUTH_BASE_URL")
    if base_url:
        auth_base_url = _require_https_url(
            base_url,
            "NEON_AUTH_BASE_URL",
        ).rstrip("/")
        return f"{auth_base_url}/.well-known/jwks.json"

    raise RuntimeError(
        "NEON_AUTH_JWKS_URL or NEON_AUTH_BASE_URL is required when DISABLE_AUTH=false",
    )


def _scope_claims_to_list(claims: dict[str, Any]) -> list[str]:
    for key in ("scope", "scp"):
        value = claims.get(key)
        if isinstance(value, str):
            return [scope for scope in value.split() if scope]
        if isinstance(value, list):
            return [str(scope) for scope in value if str(scope).strip()]
    return []


def _claim_value(claims: dict[str, Any], key: str) -> str | None:
    value = claims.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()

    upstream_claims = claims.get("upstream_claims")
    if isinstance(upstream_claims, dict):
        upstream_value = upstream_claims.get(key)
        if isinstance(upstream_value, str) and upstream_value.strip():
            return upstream_value.strip()

    nested_user = claims.get("user")
    if isinstance(nested_user, dict):
        nested_value = nested_user.get(key)
        if isinstance(nested_value, str) and nested_value.strip():
            return nested_value.strip()

    return None


class NeonAuthJWTVerifier(TokenVerifier):
    """Verify Neon Auth bearer JWTs with the configured JWKS and issuer."""

    def __init__(
        self,
        *,
        jwks_url: str,
        issuer: str,
        audience: str | None = None,
        base_url: str | None = None,
    ):
        super().__init__(base_url=base_url)
        self.issuer = issuer
        self.audience = audience
        self.jwks_client = PyJWKClient(jwks_url)

    async def verify_token(self, token: str) -> AccessToken | None:
        return await asyncio.to_thread(self._verify_token_sync, token)

    def _verify_token_sync(self, token: str) -> AccessToken | None:
        try:
            header = jwt.get_unverified_header(token)
            algorithm = str(header.get("alg") or "")
            if algorithm not in NEON_AUTH_ALLOWED_ALGORITHMS:
                return None

            signing_key = self.jwks_client.get_signing_key_from_jwt(token).key
            decode_kwargs: dict[str, Any] = {
                "algorithms": [algorithm],
                "issuer": self.issuer,
            }
            if self.audience:
                decode_kwargs["audience"] = self.audience

            claims = jwt.decode(token, signing_key, **decode_kwargs)
        except PyJWTError:
            return None

        client_id = (
            _claim_value(claims, "client_id")
            or _claim_value(claims, "azp")
            or _claim_value(claims, "sub")
            or _claim_value(claims, "email")
            or "neon-auth"
        )
        expires_at = claims.get("exp")
        return AccessToken(
            token=token,
            client_id=client_id,
            scopes=_scope_claims_to_list(claims),
            expires_at=int(expires_at) if isinstance(expires_at, int) else None,
            subject=_claim_value(claims, "sub"),
            claims=claims,
        )


def _mcp_base_url() -> str:
    base_url = (
        _optional_env("MCP_BASE_URL")
        or _optional_env("BASE_URL")
        or _optional_env("APP_BASE_URL")
    )
    if not base_url:
        raise RuntimeError("MCP_BASE_URL or BASE_URL is required when DISABLE_AUTH=false")
    return _require_https_url(base_url, "MCP_BASE_URL").rstrip("/")


def _oauth_client_storage() -> FernetEncryptionWrapper:
    if not FASTMCP_JWT_SIGNING_KEY:
        raise RuntimeError("FASTMCP_JWT_SIGNING_KEY is required when DISABLE_AUTH=false")

    storage_dir = Path(OAUTH_STORAGE_PATH or "./oauth_data")
    storage_dir.mkdir(parents=True, exist_ok=True)
    file_store = FileTreeStore(
        data_directory=storage_dir,
        key_sanitization_strategy=FileTreeV1KeySanitizationStrategy(storage_dir),
        collection_sanitization_strategy=FileTreeV1CollectionSanitizationStrategy(
            storage_dir,
        ),
    )
    return FernetEncryptionWrapper(
        key_value=file_store,
        source_material=FASTMCP_JWT_SIGNING_KEY,
        salt="meeting-note-mcp-oauth-storage",
        raise_on_decryption_error=False,
    )


def _build_auth_provider() -> AuthProvider | None:
    if DISABLE_AUTH:
        if not MCP_ALLOW_DEV_AUTH:
            raise RuntimeError(
                "DISABLE_AUTH=true requires MCP_ALLOW_DEV_AUTH=true and is only for local development",
            )
        _validate_dev_auth_runtime()
        return None

    if not NEON_AUTH_ISSUER:
        raise RuntimeError("NEON_AUTH_ISSUER is required when DISABLE_AUTH=false")
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise RuntimeError(
            "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required when DISABLE_AUTH=false",
        )

    base_url = _mcp_base_url()
    google_provider = GoogleProvider(
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        base_url=base_url,
        required_scopes=[
            "openid",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/userinfo.profile",
        ],
        allowed_client_redirect_uris=[
            "https://claude.ai/api/mcp/auth_callback",
            "https://chatgpt.com/connector/oauth/*",
            "https://chatgpt.com/connector_platform_oauth_redirect",
            "http://localhost:*",
            "http://127.0.0.1:*",
        ],
        redirect_path="/auth/callback",
        client_storage=_oauth_client_storage(),
        jwt_signing_key=FASTMCP_JWT_SIGNING_KEY,
        require_authorization_consent="external",
    )
    neon_verifier = NeonAuthJWTVerifier(
        jwks_url=_neon_auth_jwks_url(),
        issuer=_require_https_url(NEON_AUTH_ISSUER, "NEON_AUTH_ISSUER"),
        audience=NEON_AUTH_AUDIENCE,
        base_url=(
            _optional_env("MCP_BASE_URL")
            or _optional_env("BASE_URL")
            or _optional_env("APP_BASE_URL")
        ),
    )
    return MultiAuth(server=google_provider, verifiers=[neon_verifier])


mcp = FastMCP(name=SERVICE_NAME, auth=_build_auth_provider())


def _init_posthog():
    api_key = os.environ.get("POSTHOG_API_KEY", "").strip()
    if not api_key:
        class NoOpPostHog:
            def capture(self, *args: Any, **kwargs: Any) -> None:
                return None

            def capture_exception(self, *args: Any, **kwargs: Any) -> None:
                return None

            def flush(self) -> None:
                return None

            def shutdown(self) -> None:
                return None

        return NoOpPostHog()

    from posthog import Posthog

    client = Posthog(
        project_api_key=api_key,
        host=os.environ.get("POSTHOG_HOST", "https://us.i.posthog.com"),
        enable_exception_autocapture=True,
        disable_geoip=True,
        super_properties={"service": SERVICE_NAME},
    )
    atexit.register(client.shutdown)
    return client


_ph = _init_posthog()


def _ph_capture(
    event: str,
    distinct_id: str | None,
    properties: dict[str, Any] | None = None,
) -> None:
    _ph.capture(
        event,
        distinct_id=distinct_id or "anonymous",
        properties=properties or {},
    )


def _ph_capture_exception(
    exc: Exception,
    distinct_id: str | None,
    properties: dict[str, Any] | None = None,
) -> None:
    _ph.capture_exception(
        exc,
        distinct_id=distinct_id or "anonymous",
        properties=properties or {},
    )


def _current_user_claims() -> dict[str, Any]:
    if DISABLE_AUTH:
        email = os.environ.get("MCP_DEV_USER_EMAIL", "").strip()
        if not email:
            raise RuntimeError("MCP_DEV_USER_EMAIL is required when DISABLE_AUTH=true")
        return {
            "sub": os.environ.get("MCP_DEV_AUTH_USER_ID", "").strip()
            or f"dev:{email}",
            "email": email,
            "name": os.environ.get("MCP_DEV_USER_NAME", "Local MCP User"),
        }

    token = get_access_token()
    return dict(token.claims)


def _current_user_id() -> str | None:
    claims = _current_user_claims()
    return _claim_value(claims, "sub") or _claim_value(claims, "email")


async def _fetch_all(
    query: str,
    params: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is required")

    conn = await psycopg.AsyncConnection.connect(
        DATABASE_URL,
        row_factory=dict_row,
    )
    async with conn:
        async with conn.cursor() as cur:
            await cur.execute("set transaction read only")
            await cur.execute(
                f"set local statement_timeout = {SQL_TOOL_STATEMENT_TIMEOUT_MS}",
            )
            await cur.execute(query, params or {})
            rows = await cur.fetchall()
    return [dict(row) for row in rows]


async def _fetch_one(
    query: str,
    params: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    rows = await _fetch_all(query, params)
    return rows[0] if rows else None


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _email_domain(email: str) -> str:
    if "@" not in email:
        raise MeetingAccessError("Meeting Note user email must include a domain")
    return email.rsplit("@", 1)[1]


async def _workspace_for_current_user() -> Workspace:
    claims = _current_user_claims()
    auth_user_id = _claim_value(claims, "sub")
    token_email = _claim_value(claims, "email")
    if not auth_user_id:
        raise RuntimeError("Authenticated caller subject is required")
    if not token_email:
        raise RuntimeError("Authenticated caller email is required")

    return await _workspace_for_auth_user(auth_user_id, token_email)


async def _workspace_for_auth_user(auth_user_id: str, token_email: str) -> Workspace:
    normalized_token_email = _normalize_email(token_email)
    user = await _fetch_one(
        """
        select id, email, name, auth_user_id
        from users
        where auth_user_id = %(auth_user_id)s
        limit 1
        """,
        {"auth_user_id": auth_user_id},
    )
    if not user:
        user = await _fetch_one(
            """
            select id, email, name, auth_user_id
            from users
            where lower(email) = %(email)s
            limit 1
            """,
            {"email": normalized_token_email},
        )
    if not user:
        raise MeetingAccessError("Authenticated user is not registered in Meeting Note")

    user_id = str(user["id"])
    user_email = _normalize_email(str(user["email"] or ""))
    if not user_email or "@" not in user_email:
        raise MeetingAccessError("Meeting Note user email is invalid")
    if normalized_token_email != user_email:
        raise MeetingAccessError(
            "Authenticated token email does not match Meeting Note user email",
        )

    domain = _email_domain(user_email)
    matching_domains = await _fetch_all(
        """
        select team_id
        from allowed_domains
        where domain = %(domain)s
        limit 2
        """,
        {"domain": domain},
    )

    if len(matching_domains) > 1:
        membership = await _fetch_existing_membership(user_id)
        if membership:
            return _workspace_from_membership(user_email, user_id, membership)
        raise MeetingAccessError(
            "Multiple workspaces are configured for this email domain; explicit membership is required",
        )

    if matching_domains:
        return Workspace(
            email=user_email,
            user_id=user_id,
            team_id=str(matching_domains[0]["team_id"]),
            can_create_meetings=True,
            can_manage_team_meetings=False,
        )

    membership = await _fetch_existing_membership(user_id)
    if membership:
        return _workspace_from_membership(user_email, user_id, membership)

    return Workspace(
        email=user_email,
        user_id=user_id,
        team_id=None,
        can_create_meetings=False,
        can_manage_team_meetings=False,
    )


async def _fetch_existing_membership(user_id: str) -> dict[str, Any] | None:
    return await _fetch_one(
        """
        select team_id, role
        from team_memberships
        where user_id = %(user_id)s::uuid
        order by created_at asc
        limit 1
        """,
        {"user_id": user_id},
    )


def _workspace_from_membership(
    user_email: str,
    user_id: str,
    membership: dict[str, Any],
) -> Workspace:
    role = str(membership["role"])
    return Workspace(
        email=user_email,
        user_id=user_id,
        team_id=str(membership["team_id"]),
        can_create_meetings=role != "external",
        can_manage_team_meetings=role in {"admin", "owner"},
    )


def _access_condition(
    workspace: Workspace,
    params: dict[str, Any],
    meeting_alias: str = "m",
    param_prefix: str = "access",
) -> str:
    conditions: list[str] = []

    user_key = f"{param_prefix}_user_id"
    params[user_key] = workspace.user_id
    conditions.append(f"{meeting_alias}.owner_user_id = %({user_key})s::uuid")

    if workspace.can_manage_team_meetings and workspace.team_id:
        team_key = f"{param_prefix}_team_id"
        params[team_key] = workspace.team_id
        conditions.append(f"{meeting_alias}.team_id = %({team_key})s::uuid")

    conditions.append(
        f"""
        exists (
            select 1
            from meeting_access access_ma
            where access_ma.meeting_id = {meeting_alias}.id
              and access_ma.user_id = %({user_key})s::uuid
              and access_ma.revoked_at is null
        )
        """,
    )

    return f"({' or '.join(conditions)})" if conditions else "false"


def _uuid(value: str, name: str = "id") -> str:
    try:
        return str(UUID(str(value)))
    except ValueError as exc:
        raise ValueError(f"{name} must be a UUID") from exc


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _limit(value: int, default: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(1, min(parsed, maximum))


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return str(value)


def _json_safe(value: Any) -> Any:
    if isinstance(value, datetime):
        return _iso(value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    return value


def _json_safe_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [_json_safe(row) for row in rows]


def _strip_sql_literals_and_comments(sql: str) -> str:
    without_comments = re.sub(r"(--.*?$|/\*.*?\*/)", " ", sql, flags=re.M | re.S)
    return re.sub(r"'([^']|'')*'", " ", without_comments)


def _contains_sql_word(sql: str, word: str) -> bool:
    return re.search(rf"\b{re.escape(word)}\b", sql) is not None


def _validate_sql_functions(comparable: str) -> None:
    if re.search(r'"([^"]|"")+"\s*\(', comparable):
        raise ValueError("Quoted SQL functions are not allowed")
    if re.search(
        r"\b[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\s*\(",
        comparable,
    ):
        raise ValueError("Schema qualified SQL functions are not allowed")

    for match in re.finditer(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\(", comparable):
        name = match.group(1).lower()
        if name in SQL_CALL_SYNTAX_KEYWORDS:
            continue
        if name not in ALLOWED_SQL_FUNCTIONS:
            raise ValueError(f"SQL function is not allowed: {name}")


def _sql_for_parse(sql: str) -> str:
    return re.sub(r"%\([A-Za-z_][A-Za-z0-9_]*\)s", "NULL", sql)


def _validate_cte_name(name: str, seen: set[str]) -> str:
    normalized = name.strip().lower()
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", normalized):
        raise ValueError(f"Invalid CTE name: {name}")
    if normalized in SAFE_SQL_CTES:
        raise ValueError(f"CTE cannot shadow readable table: {normalized}")
    if normalized in FORBIDDEN_SQL_TABLES or normalized.startswith("pg_"):
        raise ValueError(f"CTE name is not allowed: {normalized}")
    if normalized in seen:
        raise ValueError(f"Duplicate CTE name: {normalized}")
    return normalized


def _validate_table_node(table: exp.Table, allowed_relations: set[str]) -> str:
    name = (table.name or "").strip().lower()
    if not name:
        raise ValueError("Unnamed SQL relations are not allowed")
    if table.db or table.catalog:
        raise ValueError("Schema qualified SQL relations are not allowed")
    if name.startswith("pg_"):
        raise ValueError("Postgres catalog identifiers are not allowed")
    if name in FORBIDDEN_SQL_TABLES:
        raise ValueError(f"Use readable CTEs instead of physical table: {name}")
    if name not in allowed_relations:
        raise ValueError(f"SQL relation is not allowed: {name}")
    return name


def _validate_sql_relations(sql: str) -> None:
    try:
        expression = sqlglot.parse_one(_sql_for_parse(sql), read="postgres")
    except ParseError as exc:
        raise ValueError("SQL could not be parsed safely") from exc

    for with_expression in expression.find_all(exp.With):
        if with_expression.args.get("recursive"):
            raise ValueError("Recursive CTEs are not allowed")

    ctes = list(expression.find_all(exp.CTE))
    cte_names: set[str] = set()
    ordered_ctes: list[tuple[str, exp.CTE]] = []
    for cte in ctes:
        name = _validate_cte_name(cte.alias_or_name, cte_names)
        cte_names.add(name)
        ordered_ctes.append((name, cte))

    allowed_relations = set(SAFE_SQL_CTES) | cte_names
    for table in expression.find_all(exp.Table):
        _validate_table_node(table, allowed_relations)

    visible_ctes = set(SAFE_SQL_CTES)
    for cte_name, cte in ordered_ctes:
        for table in cte.this.find_all(exp.Table):
            relation_name = _validate_table_node(table, visible_ctes)
            if relation_name == cte_name:
                raise ValueError(f"CTE cannot reference itself: {cte_name}")
        visible_ctes.add(cte_name)


def _validate_agent_sql(sql: str) -> str:
    cleaned = _clean(sql)
    if not cleaned:
        raise ValueError("sql is required")

    comparable = _strip_sql_literals_and_comments(cleaned).lower()
    comparable_stripped = comparable.strip()

    if ";" in comparable:
        raise ValueError("SQL must be a single statement without semicolons")
    if not (
        comparable_stripped.startswith("select")
        or comparable_stripped.startswith("with")
    ):
        raise ValueError("SQL must start with select or with")
    for keyword in FORBIDDEN_SQL_KEYWORDS:
        if _contains_sql_word(comparable, keyword):
            raise ValueError(f"SQL keyword is not allowed: {keyword}")
    for table in FORBIDDEN_SQL_TABLES:
        if _contains_sql_word(comparable, table):
            raise ValueError(
                f"Use readable CTEs instead of physical table: {table}",
            )
    _validate_sql_functions(comparable)
    _validate_sql_relations(cleaned)
    if re.search(r"\bpg_[A-Za-z0-9_]*\b", comparable):
        raise ValueError("Postgres catalog identifiers are not allowed")
    if not any(_contains_sql_word(comparable, cte) for cte in SAFE_SQL_CTES):
        raise ValueError(
            "SQL must reference at least one readable CTE: "
            + ", ".join(sorted(SAFE_SQL_CTES)),
        )
    return cleaned


def _normalize_sql_params(params: dict[str, Any] | None) -> dict[str, Any]:
    if params is None:
        return {}
    if not isinstance(params, dict):
        raise ValueError("params must be an object")

    normalized: dict[str, Any] = {}
    for key, value in params.items():
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", str(key)):
            raise ValueError(f"Invalid SQL param name: {key}")
        if str(key).startswith("sql_"):
            raise ValueError(f"SQL param name is reserved: {key}")
        normalized[str(key)] = value
    return normalized


def _current_transcript_job_subquery(meeting_id_sql: str) -> str:
    return f"""
        select tj.id
        from transcript_jobs tj
        where tj.meeting_id = {meeting_id_sql}
          and tj.status::text = 'completed'
        order by tj.updated_at desc, tj.created_at desc
        limit 1
    """


def _access_scope_expression(
    workspace: Workspace,
    meeting_alias: str,
    param_prefix: str,
) -> str:
    user_key = f"{param_prefix}_user_id"
    owner_condition = f"{meeting_alias}.owner_user_id = %({user_key})s::uuid"
    if workspace.can_manage_team_meetings and workspace.team_id:
        return (
            f"case when {owner_condition} "
            f"or {meeting_alias}.team_id = %({param_prefix}_team_id)s::uuid "
            "then 'workspace' else 'shared' end"
        )
    return f"case when {owner_condition} then 'workspace' else 'shared' end"


def _build_sql_tool_query(user_sql: str, access_sql: str, access_scope_sql: str) -> str:
    return f"""
    with readable_meetings as (
        select
            m.id,
            case
                when {access_scope_sql} = 'workspace' then m.team_id
                else null::uuid
            end as team_id,
            m.title,
            m.platform::text as platform,
            m.status::text as status,
            {access_scope_sql} as access_scope,
            case
                when {access_scope_sql} = 'workspace' then m.meeting_url
                else null::text
            end as meeting_url,
            m.started_at,
            m.ended_at,
            m.created_at,
            case
                when {access_scope_sql} = 'workspace' then m.team_meeting_key
                else null::text
            end as team_meeting_key
        from meetings m
        where m.status::text <> 'cancelled'
          and {access_sql}
    ),
    readable_transcript_segments as (
        select
            rm.id as meeting_id,
            rm.title as meeting_title,
            rm.access_scope as meeting_access_scope,
            rm.started_at as meeting_started_at,
            rm.created_at as meeting_created_at,
            ts.id as segment_id,
            ts.speaker,
            ts.start_ms,
            ts.end_ms,
            ts.text,
            ts.polished_text,
            ts.translated_text,
            ts.emotion_label,
            ts.emotion_reason
        from readable_meetings rm
        inner join transcript_segments ts on ts.meeting_id = rm.id
        where ts.job_id = (
            {_current_transcript_job_subquery("rm.id")}
        )
    ),
    readable_meeting_entities as (
        select
            rm.id as meeting_id,
            rm.title as meeting_title,
            rm.access_scope as meeting_access_scope,
            me.id as entity_id,
            me.segment_id,
            me.type,
            me.value,
            me.normalized_value,
            me.aliases,
            me.source
        from readable_meetings rm
        inner join meeting_entities me on me.meeting_id = rm.id
        where rm.access_scope = 'workspace'
           or (
             me.type in ('organization', 'name', 'money')
             and (
               me.segment_id is not null
               or me.source in ('transcript', 'elevenlabs')
             )
           )
    ),
    readable_meeting_participants as (
        select
            rm.id as meeting_id,
            rm.title as meeting_title,
            rm.access_scope as meeting_access_scope,
            ma.email,
            null::text as name,
            'attendee' as source
        from readable_meetings rm
        inner join meeting_attendees ma on ma.meeting_id = rm.id
        where rm.access_scope = 'workspace'
        union all
        select
            rm.id as meeting_id,
            rm.title as meeting_title,
            rm.access_scope as meeting_access_scope,
            mpt.email,
            mpt.name,
            'timeline' as source
        from readable_meetings rm
        inner join meeting_participant_timeline mpt on mpt.meeting_id = rm.id
        where rm.access_scope = 'workspace'
          and (mpt.email is not null or mpt.name is not null)
    ),
    agent_query as (
        {user_sql}
    )
    select *
    from agent_query
    limit %(sql_outer_limit)s
    """


def _meeting_access_scope(row: dict[str, Any], workspace: Workspace) -> str:
    if str(row.get("owner_user_id")) == workspace.user_id:
        return "workspace"
    if workspace.can_manage_team_meetings and workspace.team_id and str(
        row.get("team_id"),
    ) == workspace.team_id:
        return "workspace"
    return "shared"


def _meeting_summary(
    row: dict[str, Any],
    workspace: Workspace | None = None,
) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "platform": row["platform"],
        "status": row["status"],
        "started_at": _iso(row.get("started_at") or row.get("created_at")),
        "ended_at": _iso(row.get("ended_at")),
        "created_at": _iso(row.get("created_at")),
        "transcript_segment_count": row.get("transcript_segment_count") or 0,
        "translated_segment_count": row.get("translated_segment_count") or 0,
        "has_audio": bool(row.get("has_audio")),
        "access_scope": _meeting_access_scope(row, workspace)
        if workspace
        else "readable",
    }


async def _get_accessible_meeting(
    meeting_id: str,
    workspace: Workspace,
) -> dict[str, Any]:
    params: dict[str, Any] = {"meeting_id": _uuid(meeting_id, "meeting_id")}
    access_sql = _access_condition(workspace, params)
    meeting = await _fetch_one(
        f"""
        select
            m.id,
            m.team_id,
            m.owner_user_id,
            m.title,
            m.platform::text as platform,
            m.status::text as status,
            m.team_meeting_key,
            m.meeting_url,
            m.started_at,
            m.ended_at,
            m.created_at,
            m.translation_status::text as translation_status,
            m.translation_error_message,
            (
                select count(*)::int
                from transcript_segments ts
                where ts.meeting_id = m.id
                  and ts.job_id = (
                    {_current_transcript_job_subquery("m.id")}
                  )
            ) as transcript_segment_count,
            (
                select count(*)::int
                from transcript_segments ts
                where ts.meeting_id = m.id
                  and ts.job_id = (
                    {_current_transcript_job_subquery("m.id")}
                  )
                  and nullif(btrim(ts.translated_text), '') is not null
            ) as translated_segment_count,
            exists (
                select 1
                from media_assets ma
                where ma.meeting_id = m.id
                  and ma.type::text in ('audio', 'synthesized_audio')
            ) or m.recall_recording_id is not null as has_audio
        from meetings m
        where m.id = %(meeting_id)s::uuid
          and m.status::text <> 'cancelled'
          and {access_sql}
        limit 1
        """,
        params,
    )
    if not meeting:
        raise MeetingAccessError("Meeting not found or not readable")
    return meeting


@mcp.tool
async def get_user_info() -> dict[str, Any]:
    """Return the authenticated MCP user."""
    claims = _current_user_claims()
    return {
        "auth_provider": "disabled" if DISABLE_AUTH else "oauth_or_neon_auth",
        "auth_id": _claim_value(claims, "sub"),
        "email": _claim_value(claims, "email"),
        "name": _claim_value(claims, "name"),
        "auth_disabled": DISABLE_AUTH,
    }


@mcp.tool
def get_version() -> str:
    """Return the MCP server version."""
    return "0.1.0"


@mcp.tool
def list_meeting_sql_schema() -> dict[str, Any]:
    """List the safe SQL tables available to execute_meeting_sql."""
    user_id = _current_user_id()
    _ph_capture("list_meeting_sql_schema_called", user_id)
    return {
        "tables": [
            {
                "name": name,
                "description": schema["description"],
                "column_count": len(schema["columns"]),
            }
            for name, schema in SQL_SCHEMA.items()
        ],
        "notes": [
            "All tables are caller scoped and exclude cancelled meetings.",
            "Use describe_meeting_sql_table for columns.",
            "Use list_common_meeting_queries for copy ready query templates.",
        ],
    }


@mcp.tool
def describe_meeting_sql_table(table_name: str) -> dict[str, Any]:
    """Describe one safe SQL table for execute_meeting_sql."""
    user_id = _current_user_id()
    normalized_name = table_name.strip().lower()
    schema = SQL_SCHEMA.get(normalized_name)
    if not schema:
        _ph_capture(
            "describe_meeting_sql_table_failed",
            user_id,
            {"table_name": table_name},
        )
        return {
            "error": "Unknown table",
            "table_name": table_name,
            "available_tables": sorted(SQL_SCHEMA),
        }
    _ph_capture(
        "describe_meeting_sql_table_called",
        user_id,
        {"table_name": normalized_name},
    )
    return {
        "name": normalized_name,
        "description": schema["description"],
        "columns": schema["columns"],
    }


@mcp.tool
def list_common_meeting_queries(category: str | None = None) -> dict[str, Any]:
    """Return common execute_meeting_sql query templates and their params."""
    user_id = _current_user_id()
    normalized_category = category.strip().lower() if category else None
    queries = [
        query
        for query in COMMON_SQL_QUERIES
        if not normalized_category or query["category"] == normalized_category
    ]
    _ph_capture(
        "list_common_meeting_queries_called",
        user_id,
        {"category": normalized_category, "query_count": len(queries)},
    )
    return {
        "queries": queries,
        "categories": sorted({query["category"] for query in COMMON_SQL_QUERIES}),
    }


@mcp.tool
async def get_meeting_audio(meeting_id: str) -> dict[str, Any]:
    """Return the protected app audio route for one readable meeting. The tool returns a URL, not audio bytes."""
    user_id = _current_user_id()
    try:
        workspace = await _workspace_for_current_user()
        meeting = await _get_accessible_meeting(meeting_id, workspace)

        if not meeting.get("has_audio"):
            result = {
                "available": False,
                "reason": "Meeting has no stored audio or Recall recording.",
            }
        elif APP_BASE_URL:
            result = {
                "available": True,
                "source": "app_route",
                "url_type": "authenticated_app_route",
                "audio_url": f"{APP_BASE_URL}/api/meetings/{meeting['id']}/audio?download=1",
                "requires_app_session": True,
            }
        else:
            result = {
                "available": False,
                "reason": "APP_BASE_URL is required so MCP audio uses the authenticated app route.",
            }
    except Exception as exc:
        _ph_capture_exception(exc, user_id, {"tool": "get_meeting_audio"})
        raise

    _ph_capture("get_meeting_audio_called", user_id, {"meeting_id": meeting_id})
    return {
        "meeting": _meeting_summary(meeting, workspace),
        **result,
    }


def _meeting_images_payload(
    meeting_id: str,
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    if not APP_BASE_URL:
        return {
            "available": False,
            "reason": "APP_BASE_URL is required so MCP images use the authenticated app route.",
        }
    return {
        "available": bool(rows),
        "image_count": len(rows),
        "url_type": "authenticated_app_route",
        "requires_app_session": True,
        "images": [
            {
                "id": str(row["id"]),
                "mime_type": row.get("mime_type"),
                "timestamp_ms": row.get("timestamp_ms"),
                "captured_at": _iso(row.get("captured_at")),
                "url": f"{APP_BASE_URL}/api/meetings/{meeting_id}/images/{row['id']}",
            }
            for row in rows
        ],
    }


@mcp.tool
async def get_meeting_images(meeting_id: str) -> dict[str, Any]:
    """List captured meeting images (screenshots and video frames) for one readable meeting with transcript timestamps. The tool returns protected app route URLs, not image bytes."""
    user_id = _current_user_id()
    try:
        workspace = await _workspace_for_current_user()
        meeting = await _get_accessible_meeting(meeting_id, workspace)
        rows = await _fetch_all(
            """
            select ma.id, ma.mime_type, ma.timestamp_ms, ma.captured_at
            from media_assets ma
            where ma.meeting_id = %(meeting_id)s::uuid
              and ma.type::text in ('screenshot', 'video_frame')
            order by ma.timestamp_ms asc nulls last, ma.created_at asc
            """,
            {"meeting_id": str(meeting["id"])},
        )
        result = _meeting_images_payload(str(meeting["id"]), rows)
    except Exception as exc:
        _ph_capture_exception(exc, user_id, {"tool": "get_meeting_images"})
        raise

    _ph_capture(
        "get_meeting_images_called",
        user_id,
        {"meeting_id": meeting_id, "image_count": len(rows)},
    )
    return {
        "meeting": _meeting_summary(meeting, workspace),
        **result,
    }


@mcp.tool
async def execute_meeting_sql(
    sql: str,
    params: dict[str, Any] | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    """Execute read only SQL over caller scoped CTEs: readable_meetings, readable_transcript_segments, readable_meeting_entities, readable_meeting_participants."""
    user_id = _current_user_id()
    try:
        user_sql = _validate_agent_sql(sql)
        workspace = await _workspace_for_current_user()
        query_params = _normalize_sql_params(params)
        query_params["sql_outer_limit"] = _limit(limit, 100, 500)
        access_sql = _access_condition(
            workspace,
            query_params,
            meeting_alias="m",
            param_prefix="sql_access",
        )
        access_scope_sql = _access_scope_expression(
            workspace,
            meeting_alias="m",
            param_prefix="sql_access",
        )
        rows = await _fetch_all(
            _build_sql_tool_query(user_sql, access_sql, access_scope_sql),
            query_params,
        )
    except Exception as exc:
        _ph_capture_exception(exc, user_id, {"tool": "execute_meeting_sql"})
        raise

    _ph_capture(
        "execute_meeting_sql_called",
        user_id,
        {"row_count": len(rows), "limit": query_params["sql_outer_limit"]},
    )
    return {
        "rows": _json_safe_rows(rows),
        "row_count": len(rows),
        "limit": query_params["sql_outer_limit"],
        "safe_ctes": sorted(SAFE_SQL_CTES),
    }


if __name__ == "__main__":
    mcp.run(
        transport="http",
        port=MCP_PORT,
        host=MCP_HOST,
        stateless_http=True,
        uvicorn_config={
            "proxy_headers": True,
            "forwarded_allow_ips": "*",
        },
    )
