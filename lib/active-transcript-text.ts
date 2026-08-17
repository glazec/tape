import { asc, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { transcriptSegments } from "@/db/schema";
import { currentTranscriptJobIdsSubquery } from "@/lib/current-transcript-job";

export async function getActiveTranscriptText(meetingId: string) {
  const segments = await db
    .select({ text: transcriptSegments.text })
    .from(transcriptSegments)
    .where(
      inArray(
        transcriptSegments.jobId,
        currentTranscriptJobIdsSubquery(meetingId),
      ),
    )
    .orderBy(
      asc(transcriptSegments.startMs),
      asc(transcriptSegments.endMs),
      asc(transcriptSegments.id),
    );

  return segments.map((segment) => segment.text).join("\n");
}
