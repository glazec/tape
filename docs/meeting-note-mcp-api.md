# Tape MCP API

This MCP exposes Tape as a read only tool surface for authenticated colleagues. It reuses Neon Auth for caller identity, maps the verified subject to `users.auth_user_id`, then gives the agent a safe SQL layer over meeting data.

## Design Choice

SQL is the primary retrieval surface. One off tools like `search_meetings`, `get_meeting_transcript`, `get_meeting_entities`, `find_related_meetings`, and `get_person_speaking_timeline` are no longer exposed because `execute_meeting_sql` can express those queries more flexibly.

The only non SQL retrieval tool kept is `get_meeting_audio`, because audio access should stay behind the app's authenticated audio route instead of exposing storage or Recall URLs from MCP.

Visible tools:

1. `get_user_info`
2. `get_version`
3. `list_meeting_sql_schema`
4. `describe_meeting_sql_table`
5. `list_common_meeting_queries`
6. `execute_meeting_sql`
7. `get_meeting_audio`

## Access Model

Interactive MCP callers authenticate with Google OAuth through FastMCP's OAuth proxy. Direct bearer clients can still send a Neon Auth JWT in the `Authorization: Bearer ...` header. The server verifies Neon JWTs against `NEON_AUTH_JWKS_URL`, `NEON_AUTH_ISSUER`, and `NEON_AUTH_AUDIENCE` when configured. It resolves Neon JWTs by `users.auth_user_id`; Google OAuth users are resolved by the verified email already registered in Tape.

MCP data access mirrors the app read policy:

1. Workspace members can read non cancelled meetings in their workspace team.
2. Shared only users can read only non cancelled meetings explicitly shared with them through `meeting_access`.
3. Workspace members can also read explicit shares from other teams.
4. Pending share invites, calendar attendees, transcript speakers, and meeting ownership are not separate MCP authorization paths.
5. Cancelled meetings are hidden from the SQL tables.
6. Shared scoped SQL rows keep transcript content available but hide workspace team ids, join URLs, URL derived grouping keys, and participant email lists.
7. Duplicate allowed domains fail closed unless the user already has explicit team membership.

The MCP does not create users, memberships, shares, translations, or transcripts. It only returns data already stored by the app. Users must already exist in the app because the MCP resolves access through `users.auth_user_id`.

## Safe SQL Model

`execute_meeting_sql` is intentionally not unrestricted database access. It only accepts read only `select` or `with` queries over safe, caller scoped tables:

1. `readable_meetings`
2. `readable_transcript_segments`
3. `readable_meeting_entities`
4. `readable_meeting_participants`

The server rejects mutation keywords, semicolons, physical app table names, Postgres catalog or `information_schema` access, unknown relations, schema qualified relations, safe table shadowing in user CTEs, `pg_*` identifiers, schema qualified functions, SQL executing functions, and SQL that does not reference a safe table. Only a small allowlist of analytical functions such as `count`, `array_agg`, `lag`, `lead`, `coalesce`, `lower`, `regexp_replace`, and simple aggregates is allowed.

Transcript segment tables use the latest completed transcript job, ordered by `updated_at` then `created_at`, matching the app transcript reader.

## Tools

### list_meeting_sql_schema

List the safe SQL tables available to `execute_meeting_sql`.

Returns:

1. Table name
2. Table description
3. Column count

Use this first when the agent does not know which table to query.

### describe_meeting_sql_table

Describe one safe SQL table.

Arguments:

1. `table_name`: one of the safe table names

Returns:

1. Table name
2. Description
3. Column names
4. Column types
5. Column descriptions

### list_common_meeting_queries

Return common query templates and parameters for `execute_meeting_sql`.

Arguments:

1. `category`: optional category filter

Current categories:

1. `transcript_search`
2. `speaker`
3. `meeting_search`
4. `related`
5. `transcript`

### execute_meeting_sql

Execute a read only SQL query against caller scoped meeting tables.

Arguments:

1. `sql`: `select` or `with` query that references at least one safe table
2. `params`: optional named parameters for psycopg placeholders such as `%(keyword)s`
3. `limit`: default 100, max 500

### get_meeting_audio

Return the app audio download route for one accessible meeting.

Behavior:

1. Check the same MCP meeting read policy used by SQL.
2. Return `${APP_BASE_URL}/api/meetings/{meetingId}/audio?download=1` when the meeting has audio.
3. Do not sign R2 URLs or return Recall media URLs from MCP.

The tool returns a URL, not bytes. The URL is still protected by the app session because the app route owns storage and Recall retrieval.

## Safe Tables

`readable_meetings`:

1. `id`
2. `team_id` (null for shared rows)
3. `title`
4. `platform`
5. `status`
6. `access_scope`
7. `meeting_url`
8. `started_at`
9. `ended_at`
10. `created_at`
11. `team_meeting_key`

`readable_transcript_segments`:

1. `meeting_id`
2. `meeting_title`
3. `meeting_access_scope`
4. `meeting_started_at`
5. `meeting_created_at`
6. `segment_id`
7. `speaker`
8. `start_ms`
9. `end_ms`
10. `text`
11. `polished_text`
12. `translated_text`
13. `emotion_label`
14. `emotion_reason`

`readable_meeting_entities`:

1. `meeting_id`
2. `meeting_title`
3. `meeting_access_scope`
4. `entity_id`
5. `segment_id`
6. `type`
7. `value`
8. `normalized_value`
9. `aliases`
10. `source`

For shared scoped meetings, this table only includes transcript derived `organization`, `name`, and `money` entities. Workspace scoped meetings include all stored meeting entities.

`readable_meeting_participants`:

1. `meeting_id`
2. `meeting_title`
3. `meeting_access_scope`
4. `email`
5. `name`
6. `source`

This table is workspace scoped only. Shared scoped meetings do not expose participant email lists.

## Common Query Examples

Keyword hits with nearby transcript context:

```sql
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
```

Params:

```json
{"keyword": "%portfolio%"}
```

One person speaking across meetings in time order:

```sql
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
```

Params:

```json
{"person": "%James%"}
```

Find meetings related by shared entities:

```sql
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
```

## Environment

Required in production:

1. `DISABLE_AUTH=false`
2. `MCP_BASE_URL`
3. `GOOGLE_CLIENT_ID`
4. `GOOGLE_CLIENT_SECRET`
5. `FASTMCP_JWT_SIGNING_KEY`
6. `OAUTH_STORAGE_PATH`
7. `NEON_AUTH_JWKS_URL`
8. `NEON_AUTH_ISSUER`
9. `DATABASE_URL` for a least privilege read only database role
10. `APP_BASE_URL`

Recommended:

1. `MCP_HOST`
2. `MCP_PORT`
3. `NEON_AUTH_AUDIENCE` when the Neon Auth JWTs include a known audience claim
4. `POSTHOG_API_KEY`
5. `POSTHOG_HOST`

Every MCP database query opens a read only transaction and applies `SQL_TOOL_STATEMENT_TIMEOUT_MS`. Production should still use a dedicated read only database role so a future code path cannot write by accident.

Local development can use `DISABLE_AUTH=true`, `MCP_ALLOW_DEV_AUTH=true`, `MCP_HOST=127.0.0.1`, `MCP_DEV_USER_EMAIL`, and `MCP_DEV_AUTH_USER_ID` to test with a known app user. Dev auth bypass is rejected in production runtimes or when configured with a non localhost host or base URL. Production should not use the app owner database URL for the SQL tool.
