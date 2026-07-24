import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { calendarEvents, meetingReminders, meetings } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { sendOneSignalLocationReminder } from "@/lib/vendors/onesignal";

type LocationReminderSchedule = {
  id: string;
  deliveryIdempotencyKey: string;
  dispatchedVersion: number;
  scheduleVersion: number;
  scheduledFor: Date;
  sentAt: Date | null;
  status: string;
};

type ScheduledLocationReminderInput = {
  reminderId: string;
  scheduleVersion: number;
  scheduledFor: string;
};

export async function scheduleLocationReminder(input: {
  meetingId: string;
  scheduledFor: Date;
  userId: string;
}) {
  const deliveryIdempotencyKey = randomUUID();
  const [changedReminder] = await db
    .insert(meetingReminders)
    .values({
      deliveryIdempotencyKey,
      meetingId: input.meetingId,
      scheduledFor: input.scheduledFor,
      status: "pending",
      userId: input.userId,
    })
    .onConflictDoUpdate({
      target: [meetingReminders.meetingId, meetingReminders.userId],
      set: {
        deliveryIdempotencyKey,
        errorMessage: null,
        providerNotificationId: null,
        scheduleVersion: sql`${meetingReminders.scheduleVersion} + 1`,
        scheduledFor: input.scheduledFor,
        sentAt: null,
        status: "pending",
        updatedAt: new Date(),
      },
      setWhere: sql`
        ${meetingReminders.scheduledFor} is distinct from excluded.scheduled_for
        or ${meetingReminders.status} in ('cancelled', 'failed')
      `,
    })
    .returning(reminderScheduleSelection);
  const reminder =
    changedReminder ??
    (await findLocationReminderSchedule({
      meetingId: input.meetingId,
      userId: input.userId,
    }));

  if (!reminder) {
    throw new Error("Location reminder persistence failed");
  }

  await dispatchLocationReminderSchedule(reminder);

  return reminder;
}

export async function hasUndispatchedLocationReminder(input: {
  meetingId: string;
  userId: string;
}) {
  const reminder = await findLocationReminderSchedule(input);

  return (
    !reminder ||
    (reminder.status === "pending" &&
      reminder.sentAt === null &&
      reminder.dispatchedVersion < reminder.scheduleVersion)
  );
}

export async function cancelLocationRemindersForMeeting(meetingId: string) {
  await db
    .update(meetingReminders)
    .set({
      errorMessage: null,
      status: "cancelled",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(meetingReminders.meetingId, meetingId),
        isNull(meetingReminders.sentAt),
        ne(meetingReminders.status, "cancelled"),
      ),
    );
}

export async function dispatchPendingLocationReminderSchedules() {
  const reminders = await db
    .select(reminderScheduleSelection)
    .from(meetingReminders)
    .innerJoin(meetings, eq(meetingReminders.meetingId, meetings.id))
    .where(
      and(
        eq(meetingReminders.status, "pending"),
        isNull(meetingReminders.sentAt),
        lt(
          meetingReminders.dispatchedVersion,
          meetingReminders.scheduleVersion,
        ),
        eq(meetings.status, "scheduled"),
        eq(meetings.platform, "in_person"),
      ),
    )
    .limit(1000);
  let dispatchedCount = 0;

  for (const reminder of reminders) {
    await dispatchLocationReminderSchedule(reminder);
    dispatchedCount += 1;
  }

  return { dispatchedCount };
}

export async function sendScheduledLocationReminder(
  input: ScheduledLocationReminderInput,
  options: { now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const [reminder] = await db
    .select({
      deliveryIdempotencyKey: meetingReminders.deliveryIdempotencyKey,
      id: meetingReminders.id,
      location: calendarEvents.location,
      meetingId: meetingReminders.meetingId,
      meetingStatus: meetings.status,
      platform: meetings.platform,
      scheduleVersion: meetingReminders.scheduleVersion,
      scheduledFor: meetingReminders.scheduledFor,
      sentAt: meetingReminders.sentAt,
      startsAt: meetings.startedAt,
      status: meetingReminders.status,
      title: meetings.title,
      userId: meetingReminders.userId,
    })
    .from(meetingReminders)
    .innerJoin(meetings, eq(meetingReminders.meetingId, meetings.id))
    .innerJoin(calendarEvents, eq(meetings.calendarEventId, calendarEvents.id))
    .where(
      and(
        eq(meetingReminders.id, input.reminderId),
        eq(meetingReminders.scheduleVersion, input.scheduleVersion),
      ),
    )
    .limit(1);

  if (!reminder) {
    return { action: "skipped" as const, reason: "stale_schedule" as const };
  }

  if (reminder.sentAt || reminder.status === "sent") {
    return { action: "skipped" as const, reason: "already_sent" as const };
  }

  if (
    reminder.status === "cancelled" ||
    reminder.meetingStatus !== "scheduled" ||
    reminder.platform !== "in_person"
  ) {
    await cancelLocationRemindersForMeeting(reminder.meetingId);
    return { action: "skipped" as const, reason: "cancelled" as const };
  }

  if (now < reminder.scheduledFor) {
    return { action: "skipped" as const, reason: "not_due" as const };
  }

  if (reminder.startsAt && now > reminder.startsAt) {
    await markLocationReminderFailed({
      errorMessage: "Reminder expired after meeting start",
      reminderId: reminder.id,
      scheduleVersion: reminder.scheduleVersion,
      now,
    });
    return { action: "skipped" as const, reason: "expired" as const };
  }

  if (!reminder.location) {
    await markLocationReminderFailed({
      errorMessage: "Reminder has no location",
      reminderId: reminder.id,
      scheduleVersion: reminder.scheduleVersion,
      now,
    });
    return { action: "skipped" as const, reason: "missing_location" as const };
  }

  const claimed = await claimLocationReminder({
    reminderId: reminder.id,
    scheduleVersion: reminder.scheduleVersion,
    now,
  });

  if (!claimed) {
    return { action: "skipped" as const, reason: "not_claimable" as const };
  }

  try {
    const response = await sendOneSignalLocationReminder({
      idempotencyKey: reminder.deliveryIdempotencyKey,
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
      .where(
        and(
          eq(meetingReminders.id, reminder.id),
          eq(meetingReminders.scheduleVersion, reminder.scheduleVersion),
          isNull(meetingReminders.sentAt),
        ),
      );

    return { action: "sent" as const };
  } catch (error) {
    await db
      .update(meetingReminders)
      .set({
        errorMessage:
          error instanceof Error ? error.message : "Reminder send failed",
        status: "pending",
        updatedAt: now,
      })
      .where(
        and(
          eq(meetingReminders.id, reminder.id),
          eq(meetingReminders.scheduleVersion, reminder.scheduleVersion),
          isNull(meetingReminders.sentAt),
          ne(meetingReminders.status, "cancelled"),
        ),
      );
    throw error;
  }
}

export async function markLocationReminderDeliveryFailed(input: {
  error: unknown;
  reminderId: string;
  scheduleVersion: number;
  now?: Date;
}) {
  await markLocationReminderFailed({
    errorMessage:
      input.error instanceof Error
        ? input.error.message
        : "Reminder delivery failed",
    reminderId: input.reminderId,
    scheduleVersion: input.scheduleVersion,
    now: input.now ?? new Date(),
  });
}

async function dispatchLocationReminderSchedule(
  reminder: LocationReminderSchedule,
) {
  if (
    reminder.status !== "pending" ||
    reminder.sentAt ||
    reminder.dispatchedVersion >= reminder.scheduleVersion
  ) {
    return false;
  }

  await inngest.send({
    id: `location-reminder:${reminder.id}:${reminder.scheduleVersion}`,
    name: "meeting/send.location-reminder",
    data: {
      reminderId: reminder.id,
      scheduleVersion: reminder.scheduleVersion,
      scheduledFor: reminder.scheduledFor.toISOString(),
    },
  });

  await db
    .update(meetingReminders)
    .set({
      dispatchedVersion: reminder.scheduleVersion,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(meetingReminders.id, reminder.id),
        eq(meetingReminders.scheduleVersion, reminder.scheduleVersion),
      ),
    );

  return true;
}

async function findLocationReminderSchedule(input: {
  meetingId: string;
  userId: string;
}) {
  const [reminder] = await db
    .select(reminderScheduleSelection)
    .from(meetingReminders)
    .where(
      and(
        eq(meetingReminders.meetingId, input.meetingId),
        eq(meetingReminders.userId, input.userId),
      ),
    )
    .limit(1);

  return reminder ?? null;
}

async function claimLocationReminder(input: {
  reminderId: string;
  scheduleVersion: number;
  now: Date;
}) {
  const claimed = await db
    .update(meetingReminders)
    .set({
      errorMessage: null,
      status: "sending",
      updatedAt: input.now,
    })
    .where(
      and(
        eq(meetingReminders.id, input.reminderId),
        eq(meetingReminders.scheduleVersion, input.scheduleVersion),
        isNull(meetingReminders.sentAt),
        inArray(meetingReminders.status, ["pending", "sending"]),
      ),
    )
    .returning({ id: meetingReminders.id });

  return claimed.length > 0;
}

async function markLocationReminderFailed(input: {
  errorMessage: string;
  reminderId: string;
  scheduleVersion: number;
  now: Date;
}) {
  await db
    .update(meetingReminders)
    .set({
      errorMessage: input.errorMessage,
      status: "failed",
      updatedAt: input.now,
    })
    .where(
      and(
        eq(meetingReminders.id, input.reminderId),
        eq(meetingReminders.scheduleVersion, input.scheduleVersion),
        isNull(meetingReminders.sentAt),
        ne(meetingReminders.status, "cancelled"),
      ),
    );
}

function getNotificationId(response: unknown) {
  return response && typeof response === "object"
    ? ((response as { id?: unknown }).id as string | undefined)
    : undefined;
}

const reminderScheduleSelection = {
  deliveryIdempotencyKey: meetingReminders.deliveryIdempotencyKey,
  dispatchedVersion: meetingReminders.dispatchedVersion,
  id: meetingReminders.id,
  scheduleVersion: meetingReminders.scheduleVersion,
  scheduledFor: meetingReminders.scheduledFor,
  sentAt: meetingReminders.sentAt,
  status: meetingReminders.status,
};
