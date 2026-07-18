# Tape MCP

FastMCP server for Tape read access.

It exposes schema discovery, common SQL templates, safe read only SQL over caller scoped meeting tables, and protected app audio route URLs. The tool contract is documented in `../../docs/meeting-note-mcp-api.md`.

## Local run

```bash
uv sync
cp .env.example .env
uv run python main.py
```

For local testing only, set `DISABLE_AUTH=true`, `MCP_ALLOW_DEV_AUTH=true`, `MCP_HOST=127.0.0.1`, `MCP_DEV_USER_EMAIL`, and `MCP_DEV_AUTH_USER_ID` to an existing Tape user. Production must keep `DISABLE_AUTH=false`, set `MCP_BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FASTMCP_JWT_SIGNING_KEY`, `OAUTH_STORAGE_PATH`, `NEON_AUTH_JWKS_URL`, and `NEON_AUTH_ISSUER`, and add `https://<mcp-domain>/auth/callback` to the Google OAuth client. Set `NEON_AUTH_AUDIENCE` only when the Neon Auth JWTs include a known audience claim. MCP clients use OAuth; direct bearer clients can still send a Neon Auth JWT in the `Authorization: Bearer ...` header.
