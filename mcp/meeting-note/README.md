<p align="center">
  <img src="../../public/brand/tape-lockup.svg" alt="Tape logo" width="270">
</p>

# Tape MCP

FastMCP server for authenticated Tape access. Python 3.13 or newer is required.

It exposes caller identity, a canonical authorized meeting inventory, schema discovery, common SQL templates, safe read only SQL, protected application URLs for meeting audio and images, and a backend mediated local audio upload flow. See the [complete tool and access contract](../../docs/meeting-note-mcp-api.md).

Local recordings use two MCP calls. `prepare_meeting_upload` returns a short lived R2 `PUT` URL and opaque completion token. After the client uploads the exact file bytes, `complete_meeting_upload` asks the Tape web backend to validate the object, create the meeting at the chosen time, and queue transcription.

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

Keep `DISABLE_AUTH=false`. Configure `MCP_BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FASTMCP_JWT_SIGNING_KEY`, `OAUTH_STORAGE_PATH`, `NEON_AUTH_JWKS_URL`, `NEON_AUTH_ISSUER`, `DATABASE_URL`, `APP_BASE_URL`, and `MCP_BACKEND_SHARED_SECRET`. Set the same generated `MCP_BACKEND_SHARED_SECRET` on the `tape-web` service. Set `APIKEY_DATABASE_URL` to the shared Neon database containing the `api_keys` table. `DATABASE_URL` must use a login role granted `tape_mcp`, never the Neon owner role. The MCP transaction injects the verified caller claims before every read so PostgreSQL RLS independently enforces the caller boundary. Upload mutations use only the signed Tape web endpoints; the MCP database role remains read only.

Add `https://<mcp-domain>/auth/callback` to the Google OAuth client. Set `NEON_AUTH_AUDIENCE` only when Neon Auth JWTs include a known audience claim. Shared `sk_mcp_` bearer keys are resolved first. Requests without a shared key use Google OAuth, and direct bearer clients may still send a Neon Auth JWT.
