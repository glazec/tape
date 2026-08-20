<p align="center">
  <img src="../public/brand/tape-lockup.svg" alt="Tape logo" width="270">
</p>

# Tape MCP API

This MCP exposes authenticated Tape reads and local audio meeting uploads. It reuses Neon Auth for caller identity, maps the verified subject to `users.auth_user_id`, gives the agent a safe SQL layer over meeting data, and sends upload mutations through signed Tape web backend routes.

## Design Choice

SQL is the primary analytical retrieval surface. `list_accessible_meetings` is the canonical inventory tool so an agent cannot mistake one keyword result for the caller's complete meeting library. More specialized one off tools like `search_meetings`, `get_meeting_transcript`, `get_meeting_entities`, `find_related_meetings`, and `get_person_speaking_timeline` are not exposed because `execute_meeting_sql` can express those queries more flexibly.

Media retrieval remains in dedicated tools because audio and image access must stay behind authenticated application routes instead of exposing storage or Recall URLs from MCP.

Local recording input also uses dedicated tools. A remote MCP cannot read a caller's local path, so Tape returns a short lived R2 `PUT` URL. The client transfers bytes directly to R2, outside the model context, then the MCP asks the web backend to validate and process the upload.

Visible tools:

1. `get_user_info`
2. `get_version`
3. `list_meeting_sql_schema`
4. `describe_meeting_sql_table`
5. `list_common_meeting_queries`
6. `list_accessible_meetings`
7. `execute_meeting_sql`
8. `get_meeting_audio`
9. `get_meeting_images`
10. `prepare_meeting_upload`
11. `complete_meeting_upload`

## Access Model

Interactive MCP callers authenticate with Google OAuth through FastMCP's OAuth proxy. Direct bearer clients can still send a Neon Auth JWT in the `Authorization: Bearer ...` header. The server verifies Neon JWTs against `NEON_AUTH_JWKS_URL`, `NEON_AUTH_ISSUER`, and `NEON_AUTH_AUDIENCE` when configured. It resolves Neon JWTs by `users.auth_user_id`; Google OAuth users are resolved by the verified email already registered in Tape.

MCP data access mirrors the app read policy:

1. Workspace owners and admins can read non cancelled meetings in their workspace team.
2. Regular workspace members can read meetings they own plus non cancelled meetings explicitly shared with them through `meeting_access`.
3. Shared only users can read only non cancelled meetings explicitly shared with them through `meeting_access`.
4. Workspace users can also read explicit shares from other teams.
5. Pending share invites, calendar attendees, and transcript speakers are not separate MCP authorization paths.
6. Cancelled meetings are hidden from the inventory and SQL tables.
7. Shared scoped SQL rows keep transcript content available but hide workspace team ids, join URLs, URL derived grouping keys, and participant email lists.
8. Duplicate allowed domains fail closed unless the user already has explicit team membership.

The MCP does not create users, memberships, shares, or translations. Users must already exist in the app. Neon Auth subjects resolve through `users.auth_user_id`; Google OAuth and shared API key identities can fall back to an exact verified email match, and the matched Tape user must still have a canonical `auth_user_id`. Workspace members with meeting creation rights can create an uploaded meeting. Shared only users cannot prepare or complete uploads.

MCP database access stays read only. Upload preparation and completion use HMAC signed requests to dedicated Tape web routes. The web backend applies the same workspace, provider credit, rate limit, media validation, R2, and transcription dispatch rules as the browser upload flow.

## Safe SQL Model

`execute_meeting_sql` is intentionally not unrestricted database access. It only accepts read only `select` or `with` queries over safe, caller scoped tables:

1. `readable_meetings`
2. `readable_transcript_segments`
3. `readable_meeting_entities`
4. `readable_meeting_participants`

The server rejects mutation keywords, semicolons, physical app table names, Postgres catalog or `information_schema` access, unknown relations, schema qualified relations, safe table shadowing in user CTEs, `pg_*` identifiers, schema qualified functions, SQL executing functions, and SQL that does not reference a safe table. Only a small allowlist of analytical functions such as `count`, `array_agg`, `lag`, `lead`, `coalesce`, `lower`, `regexp_replace`, and simple aggregates is allowed.

Transcript segment tables use the latest completed transcript job, ordered by `updated_at` then `created_at`, matching the app transcript reader.

## Tools

### get_user_info

Return the verified MCP identity, authentication source, and whether development authentication is disabled.

### get_version

Return the MCP server version.

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

1. `meeting_inventory`
2. `transcript_search`
3. `speaker`
4. `meeting_search`
5. `related`
6. `transcript`

### list_accessible_meetings

List the caller's complete authorized, non cancelled meeting inventory before applying topic or transcript filters.

Arguments:

1. `limit`: default 100, max 500
2. `offset`: default 0, max 1,000,000

Returns the inventory page, total authorized meeting count, pagination state, meeting metadata, and each meeting's `workspace` or `shared` access scope.

### execute_meeting_sql

Execute a read only SQL query against caller scoped meeting tables.

Arguments:

1. `sql`: `select` or `with` query that references at least one safe table
2. `params`: optional named parameters for psycopg placeholders such as `%(keyword)s`
3. `limit`: default 100, max 500

`row_count` describes only the rows matched by the supplied SQL. It is not the caller's total readable meeting count. Use `list_accessible_meetings` first whenever the user asks what meetings are available.

### get_meeting_audio

Return the app audio download route for one accessible meeting.

Behavior:

1. Check the same MCP meeting read policy used by SQL.
2. Return `${APP_BASE_URL}/api/meetings/{meetingId}/audio?download=1` when the meeting has audio.
3. Do not sign R2 URLs or return Recall media URLs from MCP.

The tool returns a URL, not bytes. The URL is still protected by the app session because the app route owns storage and Recall retrieval.

### get_meeting_images

Return captured screenshots and extracted video frames for one accessible meeting.

Behavior:

1. Check the same MCP meeting read policy used by SQL.
2. Return image metadata, transcript timestamps, and `${APP_BASE_URL}/api/meetings/{meetingId}/images/{imageId}` URLs.
3. Include screenshots and extracted `video_frame` assets in timestamp order.
4. Do not sign R2 URLs or return image bytes from MCP.

The returned URLs require an authenticated application session.

### prepare_meeting_upload

Prepare a direct upload for one local audio recording.

Arguments:

1. `file_name`: basename or local path ending in `.mp3`, `.m4a`, or `.webm`
2. `file_size_bytes`: exact local file size, from 1 byte through 1 GB
3. `meeting_time`: ISO 8601 date and time with a timezone offset
4. `content_type`: optional when it can be inferred from the extension
5. `duration_ms`: optional recording duration, maximum 7 days
6. `title`: optional meeting title, maximum 200 characters

Returns a 15 minute `upload_url`, required `upload_headers`, and an opaque 30 minute `completion_token`. Upload the exact file bytes with HTTP `PUT` and the returned `Content-Type`. Do not pass recording bytes or base64 through the model context.

Example transfer:

```bash
curl --fail --request PUT \
  --header 'Content-Type: audio/mpeg' \
  --data-binary @meeting.mp3 \
  '<upload_url>'
```

### complete_meeting_upload

Complete a prepared upload with its `completion_token`. Tape checks that the token belongs to the authenticated user, rechecks meeting creation rights and provider credit, confirms the object size and type, creates the meeting at the prepared time, and emits the existing `meeting/transcribe.audio` event.

Completion is idempotent for the same uploaded object. The response includes the new meeting id, processing status, and authenticated Tape meeting URL.

## Safe Tables

`readable_meetings`:

1. `id`
2. `team_id` (null for shared rows)
3. `title`
4. `platform` (`google_meet`, `microsoft_teams`, `zoom`, `in_person`, or `upload`)
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

Inspect readable meeting metadata before analytical filtering. Use `list_accessible_meetings` when a complete paginated inventory or total count is required:

```sql
select
  id,
  title,
  platform,
  status,
  access_scope,
  started_at,
  ended_at,
  created_at
from readable_meetings
order by coalesce(started_at, created_at) desc
```

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
11. `MCP_BACKEND_SHARED_SECRET`, with the same value on the Tape web service

Recommended:

1. `MCP_HOST`
2. `MCP_PORT`
3. `NEON_AUTH_AUDIENCE` when the Neon Auth JWTs include a known audience claim

Every MCP database query opens a read only transaction and applies `SQL_TOOL_STATEMENT_TIMEOUT_MS`. Production should still use a dedicated read only database role so a future code path cannot write by accident. `MCP_BACKEND_SHARED_SECRET` must contain at least 32 characters and must not be reused as `FASTMCP_JWT_SIGNING_KEY`.

Local development can use `DISABLE_AUTH=true`, `MCP_ALLOW_DEV_AUTH=true`, `MCP_HOST=127.0.0.1`, `MCP_DEV_USER_EMAIL`, and `MCP_DEV_AUTH_USER_ID` to test with a known app user. Dev auth bypass is rejected in production runtimes or when configured with a non localhost host or base URL. Production should not use the app owner database URL for the SQL tool.
