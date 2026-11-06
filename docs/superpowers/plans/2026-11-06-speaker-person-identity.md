# Speaker person identity implementation plan

> Execute tasks with regression tests and independent review. The user authorized implementation, review, commit and push after GPT 6 Astra reviews this plan.

Goal: Support selecting an email then customizing a name, or entering a name then selecting the correct person/email, while preserving one durable workspace person identity across accessible meetings and Intel.

Architecture: Separate workspace people, confirmed email addresses and meeting speaker assignments. Persist immutable meeting speaker groups and segment membership. Resolve display names from the linked person's workspace preferred name; changing a name never changes identity or expands an edit to other same named speakers. External contacts do not require application accounts.

Tech stack: Next.js App Router, React, Drizzle, PostgreSQL RLS, Vitest and browser component fixtures.

## Approved behavior

1. A customized linked name becomes the workspace preferred name by default.
2. Both name first and email first entry paths reach the same identity selection and editable name.
3. A visible linked person row survives saving and reopening. Change person and unlink are separate actions.
4. Name only saves remain possible. Existing contacts without email remain linkable.
5. Scope is one utterance or the selected immutable speaker group in this meeting. Same display names never expand scope.
6. Person emails may change over time and one person may have multiple explicitly confirmed emails. A conflicting email never silently merges existing people.
7. Access to a contact does not confer access to any meeting or another user's private notes.

## Task 1: Isolate and establish baseline

Create a managed worktree from current origin/main and a codex/speaker-person-identity branch. Leave the original dirty index and unrelated edits intact. Inspect the remote delta and read the installed Next.js data fetching guide. Install locked dependencies or reuse the unchanged dependency tree. Run baseline speaker route, alias, transcript interaction and Intel provenance tests.

## Task 2: Add database identity primitives

Files: db/schema.ts; next numbered SQL migration and db/migrations/meta; tests/speaker-identity-database.integration.test.ts; tests/migrations.test.ts.

Add workspace_people with UUID, team_id, preferred_name, created_by and timestamps. Add person_emails with person_id, team_id, normalized email, confirming actor and time. Enforce person and team consistency; conflicting confirmed emails require an explicit person selection rather than name based merging.

Add meeting_speakers with UUID, meeting_id, transcript job/source group, original source label, optional person_id, local display_name and timestamps. Add meeting_speaker_id to transcript_segments with database constraints preventing a segment from referencing another meeting or transcript job's speaker. Preserve the original transcript speaker text as source evidence. Creation of new transcript segments must assign a speaker group, including imports, append jobs and replacement jobs. Prefer a single database insertion trigger to avoid missing ingestion paths.

Backfill stable speaker groups per transcript job and exact original speaker label. Do not merge group identity by normalized display name. Existing bare names remain unlinked. Seed person identity only where literal transcript email establishes an unambiguous binding; remembered aliases alone must not establish historical assignments. Keep migration additive and preserve transcript text, job IDs and existing generated evidence hashes.

RLS: people and emails are workspace scoped; speaker groups and assignment history require personally readable meetings for reads and manageable meetings for writes. Enforce cross workspace constraints in database and application. A shared reader may view an allowed meeting's displayed speaker names but must not browse the workspace contact directory or unrelated emails. Record actor, time and prior link when changing an assignment.

Tests first: real PostgreSQL fixtures for same named speakers, unrelated workspace, read only sharing, private notes, email conflict, segment membership, append/replacement generation and safe backfill. Replay migrations from an empty database and run drift checks.

## Task 3: Identity service and mutation API

Files: new lib/speaker-identity.ts and a small pure normalization helper if useful; app/api/meetings/[meetingId]/speakers/route.ts; a meeting scoped people suggestions route; tests/speaker-identity.test.ts; existing speaker route tests.

Expose meeting scoped suggestions containing contact ID, preferred name and permitted email metadata. Rank actual participants before other visible workspace contacts. Name/email text is only a search query until the user selects a contact or confirms a meeting participant email.

PATCH input includes anchor segmentId, scope, edited preferred/display name, and explicit link action: preserve, link existing person, confirm participant email, create person without email, or unlink. Compatibility requests without link action preserve the current identity. Derive the speaker group from the authorized anchor, not client supplied aliases. Reject stale/cross meeting groups and other workspace people. Transactionally lock the assignment, resolve or create the person, update the workspace preferred name when linked, and update only intended group membership. A line correction must create/move only that line's assignment and cannot relink the whole old group. Return the updated affected segment metadata and linked person for immediate UI updates.

Keep email validation tied to authorized meeting participant records for email first creation. Linking a second email to an existing person is an explicit operation, not a name match. Allow existing contacts without emails. Unlink leaves a local display name and the source transcript intact. Log the change for undo or correction; no automatic union of names.

Regression examples: select alice@example.test, save custom name Alice Q, reopen and retain the same person ID; rename linked Alice Q to Alex and verify another Alex group is unchanged; relink one utterance to Maya without moving other utterances; reject linking another workspace's person; preserve an existing identity when old client submits only a rename.

## Task 4: Meeting reads and editor UX

Files: lib/meeting-queries.ts; components/transcript-viewer.tsx; lib/transcript-speaker-helpers.ts or existing helper location; components/meeting-followup.tsx; tests/transcript-viewer-interactions.test.tsx; speaker statistics tests.

Carry meetingSpeakerId, personId, preferred display name and permitted linked email through authenticated meeting reads. Apply workspace preferred names at read time, keeping raw source speaker fields available for generated evidence hashes. Shared views receive display labels but no contact directory data.

Refine the existing editor rather than replacing the page. One name/email search selects an identity; editable display name does not clear that identity. Show Linked to with Change person and Unlink. Keep name only available and allow selecting an existing email free contact. Show workspace name effect clearly. On reopening, initialize from persisted speaker identity, never infer identity from name. Use stable group IDs for transcript cards, statistics, voice preview and local optimistic updates, so identical names remain separate. Keep per line scope explicit.

Tests cover both entry orders, typing after selection, save and reopen, named contact without email, change/unlink, same name collisions, scope and failure feedback. Exercise the actual component in a localhost fixture with fictional records and inspect desktop/mobile behavior.

## Task 5: Intel aggregation and source stability

Files: lib/intel/types.ts, store.ts, provenance.ts, search-batches.ts and relevant tests.

Load linked identity metadata only after existing meeting access and transcript generation filters. Catalog participants use workspace person ID when confirmed, otherwise immutable meeting speaker identity. Display the current workspace preferred name. Merge confirmed person meeting membership across meetings; never merge on a name alone. Keep selected source speaker exclusion and citation attribution based on person/group membership rather than the display name. Transcript hashes must ignore newly attached display/identity metadata unless an attribution actually changes; persist consistent canonical source data for existing extraction and followup evidence.

Verify two confirmed aliases produce one Intel person with both accessible histories, identical unlinked names remain separate, an inaccessible linked meeting contributes nothing, and changing preferred names preserves source validity. Verify changing the actual speaker assignment invalidates or rebuilds affected attribution safely.

## Task 6: Documentation, final review and delivery

Update README.md, PRODUCT.md, DESIGN.md, docs/setup.md and docs/testing.md with actual behavior, additive migration deployment order, ambiguous historical identities and test commands. Update language/format variants if present. Do not change unrelated recorder/MCP behavior.

Run focused tests, full Vitest with bounded workers, typecheck, lint, migration journal/snapshot/drift checks, real local PostgreSQL RLS integration and production build with safe test credentials where needed. Do not apply the migration to production without an explicitly required deployment action; this task authorizes commit and push, not a database deployment.

Request a fresh GPT 6 Astra review of the final diff against this plan. Fix important findings and rerun affected checks. Inspect the exact Git diff and staged paths. Commit only feature files and push the feature branch to origin, verifying the remote SHA. Report commit, branch, test evidence and migration requirement. No force push and no unrelated main checkout changes.

## Astra review amendments accepted before implementation

1. Contact directory policies require real workspace membership, not app_team_id alone. Shared meeting readers get only permitted display metadata, never the contact directory or unrelated emails.
2. Use one parameterized SQL mutation function for atomic writes with the Neon HTTP adapter. Lock anchor/group, verify current transcript generation and expected group revision, check manageable meeting and destination workspace, use a fixed search_path and restricted grants.
3. Preserve the historical speaker value present at migration. Backfill stable groups only, with no automatic person assignments. Existing aliases are suggestions, not identity proof; earlier destructive label merges cannot be reconstructed.
4. Original ingestion groups have a partial unique bucket key. Correction groups have no bucket key, so line splits can coexist. Insertion retries must never reset existing assignments or custom names.
5. Allow several people to associate the same mailbox, requiring explicit person selection. Confirmation is an asserted association, not verified ownership and never an access grant. Email first creation must not silently merge with an existing contact.
6. Person renaming is an explicit optional field in the mutation contract. On whole speaker edits the UI defaults an intentionally edited name to workspace persistence. A one line correction changes assignment only unless the user separately requests a workspace rename.
7. Add a meeting attribution revision, initially zero, incremented on real assignment changes. Preserve exact legacy hashes at zero using explicit source field projections. Bind positive revisions into hashes and generation snapshots, including composed sources, to prevent stale in flight generation from restoring invalid attribution. Preferred name changes do not alter the raw source or attribution revision.
8. Carry immutable speaker/person metadata through prompts and source exclusions. Never discard the only membership binding, infer source identity from the first evidence element, or merge transcript statistics by a shared display name.
9. Legacy mutation requests must have a valid anchor or resolve exactly one current group. Ambiguity or stale revisions produce a refresh conflict; there is no label union fallback.

## Implementation and verification outcome

Implemented in isolated branch `codex/speaker-person-identity`. GPT 6 Astra reviewed the plan and final implementation. Final review reported no remaining P1 or P2 findings after fixes for nullable participant names, email carryover, cached translated names, search/dashboard display names and export display names. Linked name edits without workspace consent now require consent or Unlink instead of silently reverting.

Verification on 2026-11-06: full Vitest run passed 2,374 tests across 302 files, with 97 environment gated cases skipped. Subsequent affected source/export/page checks passed 66 tests. Real PostgreSQL speaker and Intel suites passed 18 cases, including inaccessible linked history; the live model case was intentionally skipped. Historical backfill replay passed, with migration and fixtures rolled back. Migration lineage and schema drift checks passed. MCP passed 48 tests. Desktop and mobile browser fixture checks passed. Lint, TypeScript and production webpack build passed using synthetic configuration. A preexisting optional page argument rejected by Next's generated PageProps was corrected to unblock the production build.

The migration has not been applied to production. Local fixtures and model mocks do not establish production rollout or live matching quality. Composed source changes racing inside a save statement can persist a stale payload, but revision validation prevents displaying that payload. Earlier destructive label merges cannot be reconstructed automatically.
