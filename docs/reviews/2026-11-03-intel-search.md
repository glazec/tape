# Intel search review

Status: implemented in isolated branch `codex/intel-search`; not deployed. Production schema and variables were not changed.

## Agreed workflow

Background extraction creates intel from each completed meeting. The meeting page does not gain an Intel section. The Intel page has search history on the left and one search bar with Intel and People beneath it. Intel and pasted text or links find interested people. A selected person finds relevant intel and connections. Explicit identity confirmation prevents names from being combined automatically.

## Review outcome

Astra reviewed workflow, evidence accuracy, access control and desktop/mobile screenshots. The final review found no remaining blocker in the reviewed implementation. Fixes included semantic verification, stable selection identities, canonical merged meeting sources, source speaker exclusion, continued navigation through results, URL substitution rejection, background retry fairness, and a complete matching snapshot check that detects newly added contradictory evidence.

## Evidence

1. 104 focused and regression tests passed, including existing navigation, Inngest registration, enrichment and OpenRouter followup tests.
2. TypeScript, focused ESLint, schema migration checks and migration drift checks passed.
3. Next.js production build passed. The schema migration has not been applied to production.
4. Real React component checks passed on desktop and mobile: Intel to People to Intel, explicit identity confirmation, source disclosure, link failure recovery, Escape dismissal and no horizontal overflow. Fixture data is fictional.
5. The configured project OpenRouter credential ran the real Jev verifier against eight synthetic cases. All eight matched the expected decisions. The local development credential returned HTTP 401; it was not used as evidence of model success.
6. TwitterAPI.io returned the exact requested public post ID with 6,451 characters. The supplied credential was used only for that request and was not committed. The attempted Exa path did not retrieve this example post.

The synthetic sample does not establish broad accuracy or 90 percent parity with Granola or Otter. Production deployment, authenticated live workflow validation and a user judged relevance evaluation remain outstanding. Deployment requires migration 0066, Inngest registration and server provider configuration documented in `docs/setup.md`.
