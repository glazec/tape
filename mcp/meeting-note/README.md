# Meeting Note MCP

FastMCP server for Meeting Note read access.

It exposes schema discovery, common SQL templates, safe read only SQL over caller scoped meeting tables, and protected app audio route URLs. The tool contract is documented in `../../docs/meeting-note-mcp-api.md`.

## Local run

```bash
uv sync
cp .env.example .env
uv run python main.py
```

For local testing only, set `DISABLE_AUTH=true`, `MCP_ALLOW_DEV_AUTH=true`, `MCP_HOST=127.0.0.1`, `MCP_DEV_USER_EMAIL`, and `MCP_DEV_AUTH_USER_ID` to an existing Meeting Note user. Production must keep `DISABLE_AUTH=false` and set `NEON_AUTH_JWKS_URL`, `NEON_AUTH_ISSUER`, and `NEON_AUTH_AUDIENCE`. MCP clients send a Neon Auth JWT in the `Authorization: Bearer ...` header.
