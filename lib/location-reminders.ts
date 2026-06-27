import { and, eq, isNull, lte } from "drizzle-orm";

import { db } from "@/db/client";
import {
  calendarEvents,
  meetingReminders,
  meetings,
  users,
} from "@/db/schema";
import { sendOneSignalLocationReminder } from "@/lib/vendors/onesignal";

export async function sendDueLocationReminders(input: { now?: Date } = {}) {
  const now = input.now ?? new Date();
  const reminders = await db
    .select({
      id: meetingReminders.id,
      meetingId: meetingReminders.meetingId,
      userId: meetingReminders.userId,
      title: meetings.title,
      location: calendarEvents.location,
    })
    .from(meetingReminders)
    .innerJoin(meetings, eq(meetingReminders.meetingId, meetings.id))
    .innerJoin(calendarEvents, eq(meetings.calendarEventId, calendarEvents.id))
    .innerJoin(users, eq(meetingReminders.userId, users.id))
    .where(
      and(
        eq(meetingReminders.status, "pending"),
        isNull(meetingReminders.sentAt),
        lte(meetingReminders.scheduledFor, now),
      ),
    )
    .limit(100);
  let sentCount = 0;

  for (const reminder of reminders) {
    if (!reminder.location) {
      continue;
    }

    try {
      const response = await sendOneSignalLocationReminder({
        externalUserId: reminder.userId,
        meetingId: reminder.meetingId,
        meetingTitle: reminder.title,
        location: reminder.location,
      });

      await db
        .update(meetingReminders)
        .set({
          providerNotificationId: getNotificationId(response),
          sentAt: now,
          status: "sent",
          updatedAt: now,
        })
        .where(eq(meetingReminders.id, reminder.id));
      sentCount += 1;
    } catch (error) {
      await db
        .update(meetingReminders)
        .set({
          errorMessage:
            error instanceof Error ? error.message : "Reminder send failed",
          status: "failed",
          updatedAt: now,
        })
        .where(eq(meetingReminders.id, reminder.id));
    }
  }

  return { sentCount };
}

function getNotificationId(response: unknown) {
  return response && typeof response === "object"
    ? ((response as { id?: unknown }).id as string | undefined)
    : undefined;
}
