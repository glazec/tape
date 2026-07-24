import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { meetings } from "@/db/schema";
import { deleteScheduledRecallBot } from "@/lib/vendors/recall";

const MAX_BOTS_PER_RECONCILIATION = 100;

export async function stopBotsForExhaustedWorkspaces() {
  const result = await db.execute<{
    meeting_id: string;
    recall_bot_id: string;
  }>(sql`
    select
      meeting.id as meeting_id,
      meeting.recall_bot_id
    from meetings meeting
    join teams team on team.id = meeting.team_id
    join (
      select
        team_id,
        coalesce(sum(cost_usd_micros), 0) as used_usd_micros
      from provider_usage_events
      group by team_id
    ) usage on usage.team_id = meeting.team_id
    where meeting.status = 'scheduled'
      and meeting.recall_bot_id is not null
      and team.credit_limit_usd_micros is not null
      and usage.used_usd_micros >= team.credit_limit_usd_micros
    order by meeting.started_at asc nulls last, meeting.created_at asc
    limit ${MAX_BOTS_PER_RECONCILIATION}
  `);
  let failed = 0;
  let stopped = 0;

  for (const candidate of result.rows) {
    try {
      await deleteScheduledRecallBot({ botId: candidate.recall_bot_id });
      await db
        .update(meetings)
        .set({
          recallBotId: null,
          status: "failed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(meetings.id, candidate.meeting_id),
            eq(meetings.recallBotId, candidate.recall_bot_id),
          ),
        );
      stopped += 1;
    } catch {
      failed += 1;
    }
  }

  return { failed, stopped };
}
