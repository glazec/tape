## Product Direction

Tape is an internal meeting workspace for capture, review, search, sharing, correction, and follow up.

Prioritize the colleague's task over system details. Use plain language, sensible defaults, progressive disclosure, and truthful status. Keep meeting identifiers, provider metadata, and operational controls hidden unless they help the user complete the current task.

Use Claude as a complementary layer for organization, matching, summaries, suggestions, and defaults. Generated intelligence supports the meeting record and must not obscure the transcript, media, access boundary, or failure state.

## Documentation Contract

Keep `README.md`, `PRODUCT.md`, `DESIGN.md`, `docs/setup.md`, `docs/testing.md`, the MCP documentation, and recorder documentation aligned with verified code behavior.

Treat dated specifications and plans under `docs/superpowers` as historical records. Add current status context when needed instead of rewriting past decisions.

Verify commands, routes, environment variables, providers, permissions, UI labels, and deployment claims from the repository before documenting them. Use `docs/setup.md` as the canonical environment and deployment guide and `docs/testing.md` as the canonical verification guide.

When helping a user configure providers, explain and collect one provider at a time. Finish the provider decisions before editing configuration or adapters. Never print secrets back to the user.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
