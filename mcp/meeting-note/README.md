<p align="center">
  <img src="../../public/brand/tape-lockup.svg" alt="Tape logo" width="270">
</p>

# Tape MCP

FastMCP server for authenticated Tape read access. Python 3.13 or newer is required.

It exposes caller identity, schema discovery, common SQL templates, safe read only SQL, and protected application URLs for meeting audio and images. See the [complete tool and access contract](../../docs/meeting-note-mcp-api.md).

## Local run

```bash
uv sync
cp .env.example .env
uv run python main.py
```

For local testing only, set `DISABLE_AUTH=true`, `MCP_ALLOW_DEV_AUTH=true`, `MCP_HOST=127.0.0.1`, `MCP_DEV_USER_EMAIL`, and `MCP_DEV_AUTH_USER_ID` to an existing Tape user.

Run the MCP suite from the repository root:

```bash
npm run test:mcp
```

## Production

Deploy the MCP and image worker as separate services in one Railway project named `tape`. This keeps the MCP OAuth volume attached to the MCP service while the stateless image worker can sleep and scale independently.

Keep `DISABLE_AUTH=false`. Configure `MCP_BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FASTMCP_JWT_SIGNING_KEY`, `OAUTH_STORAGE_PATH`, `NEON_AUTH_JWKS_URL`, `NEON_AUTH_ISSUER`, `DATABASE_URL`, and `APP_BASE_URL`. Use a least privilege read only database role.

Add `https://<mcp-domain>/auth/callback` to the Google OAuth client. Set `NEON_AUTH_AUDIENCE` only when Neon Auth JWTs include a known audience claim. Interactive MCP clients use OAuth; direct bearer clients may send a Neon Auth JWT in the `Authorization: Bearer ...` header.
