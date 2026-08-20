import { and, eq, ne, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { meetings, transcriptJobs } from "@/db/schema";

export async function markTranscriptJobFailedSafely(input: {
  errorMessage: string;
  meetingId: string;
  transcriptJobId: string;
}) {
  const [failedJob] = await db
    .update(transcriptJobs)
    .set({
      errorMessage: input.errorMessage,
      status: "failed",
      updatedAt: new Date(),
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
    return;
  }

  await db
    .update(meetings)
    .set({ status: "failed", updatedAt: new Date() })
    .where(
      and(
        eq(meetings.id, input.meetingId),
        eq(meetings.status, "processing"),
        sql`not exists (
          select 1
          from transcript_jobs as alive
          where alive.meeting_id = ${input.meetingId}::uuid
            and alive.id <> ${input.transcriptJobId}::uuid
            and alive.status in ('queued', 'running', 'completed')
        )`,
      ),
    );
}
