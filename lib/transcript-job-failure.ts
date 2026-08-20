import { and, eq, ne } from "drizzle-orm";

import { databaseSql, db } from "@/db/client";
import { transcriptJobs } from "@/db/schema";

export async function markTranscriptJobFailedSafely(input: {
  errorMessage: string;
  meetingId: string;
  transcriptJobId: string;
}) {
  const now = new Date();
  const [failedJob] = await db
    .update(transcriptJobs)
    .set({
      errorMessage: input.errorMessage,
      status: "failed",
      updatedAt: now,
    })
    .where(
      and(
        eq(transcriptJobs.id, input.transcriptJobId),
        eq(transcriptJobs.meetingId, input.meetingId),
        ne(transcriptJobs.status, "completed"),
      ),
    )
    .returning({ id: transcriptJobs.id });

  if (!failedJob) {
    return { jobUpdated: false, meetingFinalized: false };
  }

  return {
    jobUpdated: true,
    meetingFinalized: await finalizeMeetingTranscriptGeneration(
      input.meetingId,
      now,
    ),
  };
}

export async function finalizeMeetingTranscriptGeneration(
  meetingId: string,
  now: Date,
) {
  const rows = await databaseSql`
    with latest_replace as (
      select id, created_at, generation_id
      from transcript_jobs
      where meeting_id = ${meetingId}::uuid
        and mode = 'replace'
      order by created_at desc, id desc
      limit 1
    ), active_generation as (
      select active_job.id, active_job.status
      from transcript_jobs active_job
      where active_job.meeting_id = ${meetingId}::uuid
        and (
          active_job.id = (select id from latest_replace)
          or (
          active_job.mode = 'append'
          and (
              active_job.generation_id = (
                select generation_id from latest_replace
              )
              or (
                active_job.generation_id is null
                and (
                  active_job.created_at > (select created_at from latest_replace)
                  or (
                    active_job.created_at = (select created_at from latest_replace)
                    and active_job.id > (select id from latest_replace)
                  )
                )
              )
            )
          )
        )
    )
    update meetings
    set
      status = case
        when exists (
          select 1 from active_generation where status = 'failed'
        ) then 'failed'::meeting_status
        else 'ready'::meeting_status
      end,
      updated_at = ${now}
    where id = ${meetingId}::uuid
      and status = 'processing'
      and not exists (
        select 1
        from active_generation
        where status in ('queued', 'running')
      )
    returning status
  `;

  return Boolean(
    rows?.some((row: { status?: string }) => row.status === "ready"),
  );
}
