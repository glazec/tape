import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { applyRecallMeetingEvent } from "@/lib/recall-meetings";
import { normalizeRecallWebhook, retrieveRecallBot } from "@/lib/vendors/recall";

// Poll the provider independently of webhook delivery, including jobs persisted
// before an Inngest send failed. Never re-submit running/completed/failed jobs.
export async function listRecallMeetingsToReconcile() {
  const result = await db.execute<{ id: string; recall_bot_id: string }>(sql`
    select m.id, m.recall_bot_id from meetings m
    where m.recall_bot_id is not null
      and m.status in ('scheduled', 'recording', 'processing', 'failed')
      and m.started_at <= now() - interval '2 minutes'
      and m.started_at >= now() - interval '30 days'
      and not exists (
        select 1 from transcript_jobs j
        join recordings r on r.id = j.recording_id
        where j.meeting_id = m.id and r.external_bot_id = m.recall_bot_id
          and (j.status <> 'queued' or j.provider_job_id is not null)
      )
    order by m.updated_at asc limit 100
  `);
  return result.rows;
}

const botSchema = z.object({
  id: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  status_changes: z.array(z.object({
    code: z.string(), sub_code: z.string().nullish(), created_at: z.string(),
  })),
  recordings: z.array(z.object({
    id: z.string(), status: z.object({ code: z.string(), updated_at: z.string() }),
  })),
});

export async function reconcileRecallMeeting(input: { id: string; recall_bot_id: string }) {
  const bot = botSchema.parse(await retrieveRecallBot(input.recall_bot_id));
  if (bot.id !== input.recall_bot_id) throw new Error("Recall bot identity mismatch");
  const recording = bot.recordings.at(-1);
  const lastStatus = bot.status_changes.at(-1);
  if (!lastStatus) return { action: "waiting" as const };
  // Do not use bot.done as evidence that media is ready.
  const complete = recording?.status.code === "done";
  const event = normalizeRecallWebhook({
    event: complete ? "recording.done" : `bot.${lastStatus.code}`,
    data: {
      bot: { id: bot.id, metadata: { ...bot.metadata, meetingId: input.id } },
      ...(recording ? { recording: { id: recording.id } } : {}),
      data: {
        code: complete ? "done" : lastStatus.code,
        sub_code: complete ? null : lastStatus.sub_code,
        updated_at: complete ? recording.status.updated_at : lastStatus.created_at,
      },
    },
  });
  return applyRecallMeetingEvent(event);
}
