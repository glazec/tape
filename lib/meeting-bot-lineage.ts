import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { meetings } from "@/db/schema";

export async function isRecallBotAccepted(input: {
  botId: string;
  meetingId: string;
}) {
  const [meeting] = await db
    .select({ recallBotId: meetings.recallBotId })
    .from(meetings)
    .where(eq(meetings.id, input.meetingId))
    .limit(1);

  if (meeting?.recallBotId === input.botId) return true;
  if (!meeting || meeting.recallBotId) return false;
  // Signed provider callbacks can confirm a continuation whose POST response
  // was lost, without accepting replaced bots on ordinary meetings.
  const accepted = await db.update(meetings).set({ recallBotId: input.botId })
    .where(and(eq(meetings.id, input.meetingId), isNull(meetings.recallBotId),
      sql`exists (select 1 from meeting_parts where source_meeting_id=${input.meetingId}
        and kind='continuation' and dispatch_state='dispatching')`))
    .returning({ id: meetings.id });
  return accepted.length > 0;
}

export function getRecallWebhookBotIdentity(payload: unknown) {
  const root = getRecord(payload);
  const data = getRecord(root?.data);
  const bot = getRecord(data?.bot);
  const botId = getString(bot?.id);

  if (!botId) {
    return null;
  }

  for (const artifact of [
    bot,
    getRecord(data?.recording),
    getRecord(data?.participant_events),
    getRecord(data?.realtime_endpoint),
  ]) {
    const metadata = getRecord(artifact?.metadata);
    const meetingId =
      getString(metadata?.meetingId) ?? getString(metadata?.meeting_id);

    if (meetingId) {
      return { botId, meetingId };
    }
  }

  return null;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
