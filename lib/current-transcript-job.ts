import { sql } from "drizzle-orm";

import { transcriptJobs } from "@/db/schema";

export function currentTranscriptJobIdSubquery(meetingId: unknown) {
  return sql<string>`(
    select ${transcriptJobs.id}
    from ${transcriptJobs}
    where ${transcriptJobs.meetingId} = ${meetingId}
      and ${transcriptJobs.status} = 'completed'
    order by ${transcriptJobs.updatedAt} desc, ${transcriptJobs.createdAt} desc
    limit 1
  )`;
}
