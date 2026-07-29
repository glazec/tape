import { inngest } from "@/inngest/client";
import {
  deleteRecallCalendarEventBot,
  deleteScheduledRecallBot,
} from "@/lib/vendors/recall";

export async function retireScheduledRecallBot(botId: string) {
  let retryQueued = false;

  try {
    await inngest.send({
      id: `delete-recall-bot:${botId}`,
      name: "meeting/delete.recall-bot",
      data: { botId },
    });
    retryQueued = true;
  } catch {
    // The direct deletion below remains authoritative when queueing is down.
  }

  try {
    await deleteScheduledRecallBot({ botId });
  } catch (error) {
    if (!retryQueued) {
      throw error;
    }
  }
}

export async function retireRecallCalendarEventBot(input: {
  botId?: string;
  calendarEventId: string;
}) {
  let calendarCleanupError: unknown;
  let retryQueued = false;

  try {
    await inngest.send({
      id: `delete-recall-calendar-event-bot:${input.calendarEventId}`,
      name: "meeting/delete.recall-calendar-event-bot",
      data: { calendarEventId: input.calendarEventId },
    });
    retryQueued = true;
  } catch {
    // The direct deletion below remains authoritative when queueing is down.
  }

  try {
    await deleteRecallCalendarEventBot({
      calendarEventId: input.calendarEventId,
    });
  } catch (error) {
    if (!retryQueued) {
      calendarCleanupError = error;
    }
  }

  let botCleanupError: unknown;

  if (input.botId) {
    try {
      await retireScheduledRecallBot(input.botId);
    } catch (error) {
      botCleanupError = error;
    }
  }

  if (calendarCleanupError) {
    throw calendarCleanupError;
  }

  if (botCleanupError) {
    throw botCleanupError;
  }
}
