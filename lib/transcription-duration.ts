import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { recordings, transcriptJobs } from "@/db/schema";

export async function getTranscriptJobDurationMs(transcriptJobId: string) {
  const [row] = await db
    .select({ durationMs: recordings.durationMs })
    .from(transcriptJobs)
    .leftJoin(recordings, eq(recordings.id, transcriptJobs.recordingId))
    .where(eq(transcriptJobs.id, transcriptJobId))
    .limit(1);

  return row?.durationMs ?? null;
}
