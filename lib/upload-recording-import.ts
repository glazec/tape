import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { databaseSql } from "@/db/client";
import { reconcileMeetingSharingForMeeting } from "@/lib/meeting-share-rules";
import { parseR2Env } from "@/lib/r2";
import {
  recordingImportPermission,
  recordingImportUnavailableReason,
} from "@/lib/upload-meeting-candidates";
import { RecordingImportError } from "@/lib/recording-import-error";
import type { WorkspaceContext } from "@/lib/workspace";

export type RecordingImportInput = {
  workspace: WorkspaceContext;
  kind: "audio" | "video";
  meetingId?: string;
  objectKey: string;
  title?: string;
  startedAt?: Date;
  durationMs?: number;
  fileSizeBytes?: number;
  mimeType?: string;
};

type ImportedRecording = {
  meetingId: string;
  mediaAssetId: string;
  recordingId: string;
  transcriptJobId: string;
  errorStatus: number | null;
  error: string | null;
};

export async function importUploadedRecording(input: RecordingImportInput) {
  if (input.workspace.canCreateMeetings === false) {
    throw new RecordingImportError("Shared users cannot add meetings", 403);
  }
  const meetingId = input.meetingId ?? randomUUID();
  const recordingId = randomUUID();
  const mediaAssetId = randomUUID();
  const transcriptJobId = randomUUID();
  const bucket = parseR2Env(process.env).R2_BUCKET;
  const endedAt = input.startedAt && input.durationMs
    ? new Date(input.startedAt.getTime() + input.durationMs) : null;
  const query = new PgDialect().sqlToQuery(sql`
    with permitted as materialized (
      select m.id, ${recordingImportUnavailableReason} as unavailable_reason
      from meetings m where m.id = ${meetingId}::uuid
        and m.calendar_event_id is not null and ${recordingImportPermission(input.workspace)}
    ), existing_object as materialized (
      select a.id, a.meeting_id, a.recording_id, j.id as job_id
      from media_assets a left join transcript_jobs j on j.recording_id = a.recording_id
      where a.object_key = ${input.objectKey} and a.bucket = ${bucket}
    ), replay as materialized (
      select a.* from existing_object a join meetings m on m.id = a.meeting_id
      where ${recordingImportPermission(input.workspace)} and a.job_id is not null
        and (${input.meetingId ?? null}::uuid = m.id or (
          ${input.meetingId ?? null}::uuid is null and m.platform = 'upload'
          and m.owner_user_id = ${input.workspace.userId}::uuid
        ))
    ), attached as (
      update meetings m set status = 'processing', updated_at = now()
      from permitted p where m.id = p.id and ${Boolean(input.meetingId)}
        and p.unavailable_reason is null and not exists (select 1 from existing_object)
      returning m.id
    ), created as (
      select m.id from meetings m
      where not ${Boolean(input.meetingId)} and m.id = ${meetingId}::uuid
        and m.owner_user_id = ${input.workspace.userId}::uuid
        and m.team_id = ${input.workspace.teamId}::uuid and m.platform = 'upload'
        and not exists (select 1 from existing_object)
    ), target as materialized (
      select id from attached union all select id from created
    ), recording as (
      insert into recordings (id, meeting_id, source, started_at, ended_at, duration_ms)
      select ${recordingId}::uuid, target.id, 'upload', ${input.startedAt ?? null}, ${endedAt}, ${input.durationMs ?? null}
      from target returning id, meeting_id
    ), asset as (
      insert into media_assets (id, meeting_id, recording_id, source, type, bucket, object_key, mime_type, file_size_bytes)
      select ${mediaAssetId}::uuid, recording.meeting_id, recording.id, 'upload',
        ${input.kind === "audio" ? "audio" : "transcript_source"}::asset_type,
        ${bucket}, ${input.objectKey}, ${input.mimeType ?? (input.kind === "audio" ? "audio/mpeg" : "video/mp4")},
        ${input.fileSizeBytes ?? null} from recording
      returning id, meeting_id, recording_id
    ), job as (
      insert into transcript_jobs (id, meeting_id, recording_id, media_asset_id, provider, status)
      select ${transcriptJobId}::uuid, asset.meeting_id, asset.recording_id,
        case when ${input.kind === "audio"} then asset.id else null end, 'elevenlabs', 'queued'
      from asset returning id, meeting_id, recording_id
    ), success as (
      select job.meeting_id as "meetingId", asset.id as "mediaAssetId", job.recording_id as "recordingId",
        job.id as "transcriptJobId", null::int as "errorStatus", null::text as error from job, asset
      union all select meeting_id, id, recording_id, job_id, null::int, null::text from replay
    )
    select * from success
    union all select null::uuid, null::uuid, null::uuid, null::uuid,
      case when ${Boolean(input.meetingId)} and not exists (select 1 from permitted) then 403 else 409 end,
      case when ${Boolean(input.meetingId)} and not exists (select 1 from permitted)
        then 'You no longer have permission to import into this calendar meeting'
        when exists (select 1 from existing_object) then 'This upload already belongs to a different meeting. Choose that meeting or select the file again.'
        else coalesce((select unavailable_reason from permitted), 'This meeting changed. Refresh the meeting choices or create a new meeting.') end
      where not exists (select 1 from success)
  `);
  // Separate statements give the guarded mutation a fresh snapshot after waiting.
  // The object lock also makes new-meeting retries return the original import.
  const results = await databaseSql.transaction((tx) => [
    tx`select pg_advisory_xact_lock(hashtextextended(${`recording-import:${input.objectKey}`}, 0))`,
    tx`select pg_advisory_xact_lock(hashtextextended(${`recording-timeline:${meetingId}`}, 0))`,
    tx`select id from meetings where id = ${meetingId}::uuid for update`,
    // Child RLS uses a stable meeting lookup, so new meetings must be visible
    // in an earlier statement of this same transaction before inserting media.
    tx`insert into meetings (id, team_id, owner_user_id, title, title_source, platform, status, started_at)
      select ${meetingId}::uuid, ${input.workspace.teamId}::uuid, ${input.workspace.userId}::uuid,
        ${input.title?.trim() || (input.kind === "audio" ? "Uploaded audio" : "Uploaded video")},
        'upload', 'upload', 'processing', ${input.startedAt ?? new Date()}
      where not ${Boolean(input.meetingId)}
        and not exists (select 1 from media_assets where object_key = ${input.objectKey} and bucket = ${bucket})
        and exists (select 1 from team_memberships where team_id = ${input.workspace.teamId}::uuid
          and user_id = ${input.workspace.userId}::uuid)`,
    tx.query(query.sql, query.params),
  ]).catch((error: unknown) => {
    // A unique asset can be hidden by RLS after the user switches workspaces.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      throw new RecordingImportError("This upload is already attached. Select the recording again to import a new copy.");
    }
    throw error;
  });
  const [row] = results[4] as ImportedRecording[];
  if (!row) throw new RecordingImportError("This meeting changed. Refresh the meeting choices or create a new meeting.");
  if (row.errorStatus) throw new RecordingImportError(row.error!, row.errorStatus === 403 ? 403 : 409);
  if (!input.meetingId) await reconcileMeetingSharingForMeeting(row.meetingId);
  return {
    meetingId: row.meetingId, mediaAssetId: row.mediaAssetId,
    recordingId: row.recordingId, transcriptJobId: row.transcriptJobId,
  };
}
