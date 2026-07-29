import {
  and,
  asc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db/client";
import {
  auditEvents,
  calendarEvents,
  localRecordingAttempts,
  meetings,
} from "@/db/schema";
import { normalizeEmail } from "@/lib/access";
import {
  buildAppUrl,
  detectMeetingPlatform,
  type MeetingLinkPlatform,
  type SupportedMeetingPlatform,
} from "@/lib/meeting-links";
import { buildSmartMeetingTitle } from "@/lib/meeting-intelligence";
import { syncMeetingParticipantAccess } from "@/lib/meeting-participant-access";
import { applyMeetingShareRules } from "@/lib/meeting-share-rules";
import {
  cancelLocationRemindersForMeeting,
  hasUndispatchedLocationReminder,
  scheduleLocationReminder,
} from "@/lib/location-reminders";
import {
  getMeetingBotMetadata,
  getMeetingBotProfile,
  getMeetingBotRecallCreateInput,
  getMeetingBotRecallUpdateInput,
} from "@/lib/meeting-bot-profile";
import {
  retireRecallCalendarEventBot,
  retireScheduledRecallBot,
} from "@/lib/meeting-bot-retirement";
import {
  deleteRecallCalendarEventBot,
  deleteScheduledRecallBot,
  retrieveRecallBot,
  scheduleRecallCalendarEventBot,
  scheduleRecallBot,
  updateScheduledRecallBot,
} from "@/lib/vendors/recall";
import { assertWorkspaceHasProviderCredit } from "@/lib/provider-credit";

type CalendarConnection = {
  id: string;
  teamId: string;
  userId: string;
  autoJoinEnabled: boolean;
  creditLimitUsdMicros?: number | null;
  workspaceDomain?: string | null;
  workspaceName?: string | null;
};

type SyncedCalendarAttendee = {
  email: string;
  responseStatus?: string | null;
};

type CalendarEventEntryPoint = {
  entryPointType?: string | null;
  uri?: string | null;
};

export type SyncedCalendarEvent = {
  externalEventId: string;
  title: string;
  startsAt: string | Date;
  endsAt?: string | Date | null;
  attendeeEmails?: string[];
  attendees?: SyncedCalendarAttendee[];
  meetingUrl?: string | null;
  location?: string | null;
  description?: string | null;
  hangoutLink?: string | null;
  isDeleted?: boolean;
  recallCalendarEventId?: string | null;
  recallCalendarEventDeduplicationKey?: string | null;
  recallCalendarEventBots?: Array<{
    botId: string;
    deduplicationKey: string | null;
  }>;
  conferenceData?: {
    entryPoints?: CalendarEventEntryPoint[] | null;
  } | null;
};

type AutoJoinInput = {
  connection: CalendarConnection;
  event: SyncedCalendarEvent;
  forceBotConfigRefresh?: boolean;
  repairMode?: boolean;
};

type RecallBotResponse = {
  id?: unknown;
  bots?: Array<{
    bot_id?: unknown;
    deduplication_key?: unknown;
  }>;
};

type ScheduledRecallBot = {
  cleanup:
    | {
        botId?: string;
        calendarEventId: string;
        kind: "calendar_event";
      }
    | {
        botId: string;
        kind: "scheduled_bot";
      }
    | null;
  response: RecallBotResponse;
};

type MeetingPlatform = typeof meetings.$inferSelect.platform;
type MeetingStatus = typeof meetings.$inferSelect.status;

type ExistingMeeting = {
  id: string;
  ownerUserId: string;
  calendarEventId?: string | null;
  linkedCalendarEventMeetingUrl?: string | null;
  linkedCalendarEventTeamMeetingKey?: string | null;
  teamMeetingKey?: string | null;
  title: string;
  titleSource: string | null;
  platform: MeetingPlatform;
  recallBotId: string | null;
  recallRecordingId: string | null;
  meetingUrl: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  status: MeetingStatus;
};

type CalendarEventRow = {
  id: string;
  teamMeetingKey?: string | null;
};

export function findCalendarMeetingUrl(event: SyncedCalendarEvent) {
  const structuredCandidates = [
    event.meetingUrl,
    ...getConferenceEntryPointUris(event),
    event.hangoutLink,
  ];
  const textCandidates = [
    ...extractUrls(event.location),
    ...extractUrls(event.description),
  ];

  return (
    [...structuredCandidates, ...textCandidates].find(isSupportedMeetingUrl) ??
    structuredCandidates.find(isHttpUrl) ??
    null
  );
}

export function getIgnoredCalendarEventSource(
  event: SyncedCalendarEvent,
): "luma" | "partiful" | null {
  const urls = [
    event.meetingUrl,
    event.location,
    getCalendarImportDescriptionHeader(event.description),
    event.hangoutLink,
    ...getConferenceEntryPointUris(event),
  ].flatMap((value) => extractUrls(value));

  for (const value of urls) {
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase();

      if (
        url.pathname !== "/" &&
        (matchesHostname(hostname, "luma.com") ||
          matchesHostname(hostname, "lu.ma"))
      ) {
        return "luma";
      }

      if (
        /^\/e\/[^/]+/i.test(url.pathname) &&
        matchesHostname(hostname, "partiful.com")
      ) {
        return "partiful";
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function autoJoinCalendarEvent(input: AutoJoinInput) {
  const attendeeEmails = getCalendarAttendeeEmails(input.event);
  const canonicalAttendeeEmails = [...attendeeEmails].sort();
  const declinedByExternalAttendees =
    isDeclinedByAllExternalAttendees(input);
  const ignoredCalendarEventSource = input.event.isDeleted
    ? null
    : getIgnoredCalendarEventSource(input.event);
  const ignoredImportedEvent = ignoredCalendarEventSource !== null;
  const autoJoinSuppressed =
    declinedByExternalAttendees || ignoredImportedEvent;
  const meetingUrl = input.event.isDeleted
    ? null
    : autoJoinSuppressed
      ? null
      : findCalendarMeetingUrl(input.event);
  const platform = meetingUrl ? detectMeetingPlatform(meetingUrl) : null;
  const title = normalizeEventTitle(
    { ...input.event, attendeeEmails: canonicalAttendeeEmails },
    platform,
    input.connection.workspaceDomain,
    input.connection.workspaceName,
  );
  const startsAt = parseEventDate(input.event.startsAt);
  const endsAt = input.event.endsAt ? parseEventDate(input.event.endsAt) : null;
  const location = input.event.location?.trim() || null;
  const description = input.event.description?.trim() || null;
  const teamMeetingKey =
    meetingUrl && platform
      ? buildTeamMeetingKey({
          teamId: input.connection.teamId,
          startsAt,
          meetingUrl,
        })
      : location && !input.event.isDeleted && !autoJoinSuppressed
        ? buildLocationMeetingKey({
            teamId: input.connection.teamId,
            startsAt,
            location,
          })
      : null;
  const teamMeetingKeyUpdate = ignoredImportedEvent
    ? null
    : teamMeetingKey ??
      sql`coalesce(${calendarEvents.teamMeetingKey}, excluded.team_meeting_key)`;
  const teamMeetingKeyComparison = ignoredImportedEvent
    ? sql`excluded.team_meeting_key`
    : sql`coalesce(
        excluded.team_meeting_key,
        ${calendarEvents.teamMeetingKey}
      )`;
  const [persistedCalendarEvent] = await db
    .insert(calendarEvents)
    .values({
      teamId: input.connection.teamId,
      connectionId: input.connection.id,
      externalEventId: input.event.externalEventId,
      title,
      teamMeetingKey,
      meetingUrl,
      location,
      description,
      startsAt,
      endsAt,
      attendeeEmails: canonicalAttendeeEmails,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [calendarEvents.connectionId, calendarEvents.externalEventId],
      set: {
        title,
        teamMeetingKey: teamMeetingKeyUpdate,
        meetingUrl,
        location,
        description,
        startsAt,
        endsAt,
        attendeeEmails: canonicalAttendeeEmails,
        updatedAt: new Date(),
      },
      setWhere: sql`(
        ${calendarEvents.title},
        ${calendarEvents.meetingUrl},
        ${calendarEvents.location},
        ${calendarEvents.description},
        ${calendarEvents.startsAt},
        ${calendarEvents.endsAt},
        ${calendarEvents.attendeeEmails}
      ) is distinct from (
        excluded.title,
        excluded.meeting_url,
        excluded.location,
        excluded.description,
        excluded.starts_at,
        excluded.ends_at,
        excluded.attendee_emails
      ) or ${calendarEvents.teamMeetingKey} is distinct from ${teamMeetingKeyComparison}`,
    })
    .returning({
      id: calendarEvents.id,
      teamMeetingKey: calendarEvents.teamMeetingKey,
    });
  const calendarEventChanged = Boolean(persistedCalendarEvent);
  const calendarEvent =
    persistedCalendarEvent ??
    (await findCalendarEvent({
      connectionId: input.connection.id,
      externalEventId: input.event.externalEventId,
    }));

  if (!calendarEvent) {
    throw new Error("Calendar event persistence failed");
  }
  const activeTeamMeetingKey =
    teamMeetingKey ?? calendarEvent.teamMeetingKey ?? null;

  if (!input.connection.autoJoinEnabled && !ignoredImportedEvent) {
    return {
      action: "skipped" as const,
      calendarEventId: calendarEvent.id,
      reason: "auto_join_disabled" as const,
    };
  }

  let existingMeeting: ExistingMeeting | null = await findExistingMeeting({
    teamId: input.connection.teamId,
    calendarEventId: calendarEvent.id,
    externalEventId: input.event.externalEventId,
    teamMeetingKey: activeTeamMeetingKey,
  });
  let participantAccessSynced = false;
  let shareRulesApplied = false;
  const isPastRepairEvent =
    input.repairMode && isPastCalendarEvent({ startsAt, endsAt });
  const hasSchedulableNextOccurrence = Boolean(
    (meetingUrl && platform) ||
      (location && !input.event.isDeleted && !autoJoinSuppressed),
  );
  const locationReminderNeedsRepair = Boolean(
    existingMeeting &&
      location &&
      !meetingUrl &&
      !input.event.isDeleted &&
      !autoJoinSuppressed &&
      (await hasUndispatchedLocationReminder({
        meetingId: existingMeeting.id,
        userId: input.connection.userId,
      })),
  );

  if (
    existingMeeting &&
    hasSchedulableNextOccurrence &&
    shouldCreateNewRecordedMeetingOccurrence({
      meeting: existingMeeting,
      startsAt,
      endsAt,
    })
  ) {
    existingMeeting = null;
  }
  const recoverRescheduledRecording = existingMeeting
    ? await canSafelyRecoverRescheduledRecording({
        endsAt,
        meeting: existingMeeting,
        meetingUrl,
        startsAt,
      })
    : false;
  const ownedByActiveSiblingCalendarEvent = Boolean(
    existingMeeting &&
      isMeetingOwnedByActiveSiblingCalendarEvent({
        currentCalendarEventId: calendarEvent.id,
        meeting: existingMeeting,
        teamMeetingKey: activeTeamMeetingKey,
      }),
  );

  if (existingMeeting && !ignoredImportedEvent) {
    await syncMeetingParticipantAccess({
      attendeeEmails,
      meetingId: existingMeeting.id,
      ownerUserId: existingMeeting.ownerUserId,
      teamId: input.connection.teamId,
    });
    participantAccessSynced = true;
  }

  if (
    existingMeeting &&
    !ignoredImportedEvent &&
    calendarEventChanged &&
    input.connection.workspaceDomain
  ) {
    await applyMeetingShareRules({
      attendeeEmails,
      meetingId: existingMeeting.id,
      ownerUserId: existingMeeting.ownerUserId,
      teamId: input.connection.teamId,
      title: getCalendarMeetingTitle(existingMeeting, title),
      workspaceDomain: input.connection.workspaceDomain,
    });
    shareRulesApplied = true;
  }

  if (existingMeeting && ownedByActiveSiblingCalendarEvent) {
    return {
      action: "skipped" as const,
      calendarEventId: calendarEvent.id,
      meetingId: existingMeeting.id,
      meetingUrl: meetingUrl ?? undefined,
      reason: "already_scheduled" as const,
    };
  }

  if (
    existingMeeting &&
    !ignoredImportedEvent &&
    !calendarEventChanged &&
    !locationReminderNeedsRepair &&
    !needsUnchangedCalendarEventRepair({
      calendarEventId: calendarEvent.id,
      event: input.event,
      existingMeeting,
      forceBotConfigRefresh: input.forceBotConfigRefresh,
      meetingUrl,
      platform,
      recoverRescheduledRecording,
      startsAt,
      endsAt,
      teamMeetingKey: activeTeamMeetingKey,
      title,
    })
  ) {
    return {
      action: "skipped" as const,
      calendarEventId: calendarEvent.id,
      meetingId: existingMeeting.id,
      meetingUrl: meetingUrl ?? undefined,
      reason: "already_scheduled" as const,
    };
  }

  if (!meetingUrl) {
    if (isPastRepairEvent && !existingMeeting) {
      return {
        action: "skipped" as const,
        calendarEventId: calendarEvent.id,
        reason: "missing_meeting_link" as const,
      };
    }

    if (location && !input.event.isDeleted && !autoJoinSuppressed) {
      return syncLocationCalendarMeeting({
        connection: input.connection,
        calendarEvent,
        attendeeEmails,
        existingMeeting,
        title,
        startsAt,
        endsAt,
        location,
        teamMeetingKey: activeTeamMeetingKey,
      });
    }

    if (autoJoinSuppressed) {
      if (
        ignoredImportedEvent &&
        existingMeeting &&
        shouldPreserveIgnoredCalendarMeeting(existingMeeting)
      ) {
        await cancelLocationRemindersForMeeting(existingMeeting.id);

        return {
          action: "skipped" as const,
          calendarEventId: calendarEvent.id,
          meetingId: existingMeeting.id,
          reason: "ignored_event" as const,
        };
      }

      if (existingMeeting) {
        await cancelScheduledMeetingBotFromCalendar({
          botId: existingMeeting.recallBotId,
          endsAt,
          meetingId: existingMeeting.id,
          meetingUrl: null,
          nextStatus: "cancelled",
          recallCalendarEventId: input.event.recallCalendarEventId,
          startsAt,
          title: getCalendarMeetingTitle(existingMeeting, title),
          titleSource: getCalendarMeetingTitleSource(existingMeeting),
          durableBotCleanup: ignoredImportedEvent,
        });

        if (ignoredImportedEvent) {
          await cancelLocationRemindersForMeeting(existingMeeting.id);
        }

        return {
          action: "skipped" as const,
          calendarEventId: calendarEvent.id,
          meetingId: existingMeeting.id,
          reason: ignoredImportedEvent
            ? ("ignored_event" as const)
            : ("missing_meeting_link" as const),
        };
      }

      return {
        action: "skipped" as const,
        calendarEventId: calendarEvent.id,
        reason: ignoredImportedEvent
          ? ("ignored_event" as const)
          : ("missing_meeting_link" as const),
      };
    }

    if (existingMeeting?.status === "scheduled") {
      if (
        await hasOtherActiveCalendarEventForTeamMeeting({
          teamId: input.connection.teamId,
          calendarEvent,
          teamMeetingKey: activeTeamMeetingKey,
        })
      ) {
        return {
          action: "skipped" as const,
          calendarEventId: calendarEvent.id,
          meetingId: existingMeeting.id,
          reason: "shared_meeting_still_scheduled" as const,
        };
      }

      await cancelScheduledMeetingBotFromCalendar({
        botId: existingMeeting.recallBotId,
        endsAt,
        meetingId: existingMeeting.id,
        meetingUrl: null,
        recallCalendarEventId: input.event.recallCalendarEventId,
        skipVendorDelete: input.event.isDeleted === true,
        startsAt,
        title: getCalendarMeetingTitle(existingMeeting, title),
        titleSource: getCalendarMeetingTitleSource(existingMeeting),
      });

      return {
        action: "skipped" as const,
        calendarEventId: calendarEvent.id,
        meetingId: existingMeeting.id,
        reason: "missing_meeting_link" as const,
      };
    }

    return {
      action: "skipped" as const,
      calendarEventId: calendarEvent.id,
      reason: "missing_meeting_link" as const,
    };
  }

  if (!platform) {
    if (existingMeeting?.status === "scheduled") {
      if (
        await hasOtherActiveCalendarEventForTeamMeeting({
          teamId: input.connection.teamId,
          calendarEvent,
          teamMeetingKey: activeTeamMeetingKey,
        })
      ) {
        return {
          action: "skipped" as const,
          calendarEventId: calendarEvent.id,
          meetingId: existingMeeting.id,
          meetingUrl,
          reason: "shared_meeting_still_scheduled" as const,
        };
      }

      await cancelScheduledMeetingBotFromCalendar({
        botId: existingMeeting.recallBotId,
        endsAt,
        meetingId: existingMeeting.id,
        meetingUrl,
        recallCalendarEventId: input.event.recallCalendarEventId,
        startsAt,
        title: getCalendarMeetingTitle(existingMeeting, title),
        titleSource: getCalendarMeetingTitleSource(existingMeeting),
      });

      return {
        action: "skipped" as const,
        calendarEventId: calendarEvent.id,
        meetingId: existingMeeting.id,
        meetingUrl,
        reason: "unsupported_meeting_link" as const,
      };
    }

    return {
      action: "skipped" as const,
      calendarEventId: calendarEvent.id,
      meetingUrl,
      reason: "unsupported_meeting_link" as const,
    };
  }

  if (platform === "microsoft_teams") {
    return syncLocalRecorderCalendarMeeting({
      attendeeEmails,
      calendarEvent,
      connection: input.connection,
      endsAt,
      event: input.event,
      existingMeeting,
      isPastRepairEvent: Boolean(isPastRepairEvent),
      meetingUrl,
      startsAt,
      teamMeetingKey: activeTeamMeetingKey,
      title,
    });
  }

  if (existingMeeting) {
    await cancelLocationRemindersForMeeting(existingMeeting.id);
  }

  if (isPastRepairEvent && !existingMeeting) {
    return {
      action: "skipped" as const,
      calendarEventId: calendarEvent.id,
      meetingUrl,
      reason: "already_scheduled" as const,
    };
  }

  if (existingMeeting?.status === "failed" && isPastCalendarEvent({ startsAt, endsAt })) {
    await markMeetingMissedFromCalendar({
      meetingId: existingMeeting.id,
      title: getCalendarMeetingTitle(existingMeeting, title),
      platform,
      meetingUrl,
      startsAt,
      endsAt,
      teamMeetingKey: activeTeamMeetingKey,
      recallBotId: existingMeeting.recallBotId,
      titleSource: getCalendarMeetingTitleSource(existingMeeting),
    });

    return {
      action: "skipped" as const,
      calendarEventId: calendarEvent.id,
      meetingId: existingMeeting.id,
      meetingUrl,
      reason: "already_scheduled" as const,
    };
  }

  if (isPastRepairEvent && existingMeeting && !existingMeeting.recallBotId) {
    return {
      action: "skipped" as const,
      calendarEventId: calendarEvent.id,
      meetingId: existingMeeting.id,
      meetingUrl,
      reason: "already_scheduled" as const,
    };
  }

  if (existingMeeting?.recallBotId) {
    return syncExistingCalendarMeeting({
      meeting: existingMeeting,
      event: input.event,
      calendarEvent,
      title,
      platform,
      meetingUrl,
      startsAt,
      endsAt,
      teamId: input.connection.teamId,
      creditLimitUsdMicros: input.connection.creditLimitUsdMicros,
      teamMeetingKey: activeTeamMeetingKey,
      forceScheduleBot: input.forceBotConfigRefresh,
      recoverRescheduledRecording,
    });
  }

  let meeting: ExistingMeeting | { id: string; ownerUserId: string } | null =
    existingMeeting;
  if (!meeting) {
    try {
      meeting = (
        await db
          .insert(meetings)
          .values({
            teamId: input.connection.teamId,
            ownerUserId: input.connection.userId,
            calendarEventId: calendarEvent.id,
            teamMeetingKey: activeTeamMeetingKey,
            title,
            titleSource: "calendar",
            platform,
            status: "scheduled",
            meetingUrl,
            startedAt: startsAt,
            endedAt: endsAt,
          })
          .returning({ id: meetings.id, ownerUserId: meetings.ownerUserId })
      )[0];
    } catch (error) {
      if (!isTeamMeetingKeyUniqueConflict(error) || !activeTeamMeetingKey) {
        throw error;
      }

      existingMeeting = await findExistingMeeting({
        teamId: input.connection.teamId,
        calendarEventId: calendarEvent.id,
        externalEventId: input.event.externalEventId,
        teamMeetingKey: activeTeamMeetingKey,
      });

      if (!existingMeeting) {
        throw error;
      }

      meeting = existingMeeting;
    }
  }

  if (existingMeeting?.recallBotId) {
    return syncExistingCalendarMeeting({
      meeting: existingMeeting,
      event: input.event,
      calendarEvent,
      title,
      platform,
      meetingUrl,
      startsAt,
      endsAt,
      teamId: input.connection.teamId,
      creditLimitUsdMicros: input.connection.creditLimitUsdMicros,
      teamMeetingKey: activeTeamMeetingKey,
      forceScheduleBot: true,
      recoverRescheduledRecording,
    });
  }

  if (!meeting) {
    throw new Error("Meeting creation failed");
  }

  if (!participantAccessSynced) {
    await syncMeetingParticipantAccess({
      attendeeEmails,
      meetingId: meeting.id,
      ownerUserId: meeting.ownerUserId,
      teamId: input.connection.teamId,
    });
  }

  if (input.connection.workspaceDomain && !shareRulesApplied) {
    await applyMeetingShareRules({
      attendeeEmails,
      meetingId: meeting.id,
      ownerUserId: meeting.ownerUserId,
      teamId: input.connection.teamId,
      title: getCalendarMeetingTitle(
        existingMeeting,
        title,
      ),
      workspaceDomain: input.connection.workspaceDomain,
    });
  }

  let botCleanup: ScheduledRecallBot["cleanup"] = null;

  try {
    const scheduledBot = await scheduleBotForCalendarEvent({
      creditLimitUsdMicros: input.connection.creditLimitUsdMicros,
      event: input.event,
      meetingUrl,
      startsAt,
      teamId: input.connection.teamId,
      teamMeetingKey: activeTeamMeetingKey,
      calendarEventId: calendarEvent.id,
      meetingId: meeting.id,
    });
    botCleanup = scheduledBot.cleanup;
    const recallBotId = getRecallBotResponseId(
      scheduledBot.response,
      getRecallCalendarEventBotDeduplicationKey({
        event: input.event,
        teamMeetingKey: activeTeamMeetingKey,
      }),
    );

    if (!recallBotId) {
      throw new Error("Recall bot response missing id");
    }

    if (botCleanup?.kind === "calendar_event") {
      botCleanup = { ...botCleanup, botId: recallBotId };
    }

    const updateResult = await db
      .update(meetings)
      .set({
        recallBotId,
        teamMeetingKey: activeTeamMeetingKey,
        title: getCalendarMeetingTitle(
          "titleSource" in meeting ? meeting : null,
          title,
        ),
        titleSource:
          existingMeeting?.titleSource === "manual"
            ? "manual"
            : "calendar",
        platform,
        meetingUrl,
        startedAt: startsAt,
        endedAt: endsAt,
        status: "scheduled",
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, meeting.id));

    if (updateResult?.rowCount === 0) {
      throw new Error("Calendar meeting update failed");
    }

    botCleanup = null;

    return {
      action: "scheduled" as const,
      calendarEventId: calendarEvent.id,
      meetingId: meeting.id,
      meetingUrl,
      platform,
      recallBotId,
    };
  } catch (error) {
    await cleanupScheduledRecallBot(botCleanup);
    await markMeetingFailed(meeting.id);
    await recordCalendarAutoJoinFailure({
      calendarEventId: calendarEvent.id,
      error,
      event: input.event,
      meetingId: meeting.id,
      meetingUrl,
      reason: "schedule_bot_failed",
      startsAt,
      teamId: input.connection.teamId,
      title,
      userId: input.connection.userId,
    });

    throw error;
  }
}

async function syncLocalRecorderCalendarMeeting(input: {
  attendeeEmails: string[];
  calendarEvent: CalendarEventRow;
  connection: CalendarConnection;
  endsAt: Date | null;
  event: SyncedCalendarEvent;
  existingMeeting: ExistingMeeting | null;
  isPastRepairEvent: boolean;
  meetingUrl: string;
  startsAt: Date;
  teamMeetingKey?: string | null;
  title: string;
}) {
  let meeting = input.existingMeeting;
  let meetingIdentity: { id: string; ownerUserId: string } | undefined;
  let reconciledManualRecording = false;

  if (!meeting && input.isPastRepairEvent) {
    meeting = await findMatchingManualLocalRecorderMeeting({
      endsAt: input.endsAt,
      ownerUserId: input.connection.userId,
      startsAt: input.startsAt,
      teamId: input.connection.teamId,
    });
    reconciledManualRecording = Boolean(meeting);
  }

  if (
    meeting &&
    !reconciledManualRecording &&
    meeting.status !== "scheduled" &&
    !shouldRecoverCalendarMeeting({
      endsAt: input.endsAt,
      meeting,
      meetingUrl: input.meetingUrl,
      startsAt: input.startsAt,
    })
  ) {
    return {
      action: "skipped" as const,
      calendarEventId: input.calendarEvent.id,
      meetingId: meeting.id,
      meetingUrl: input.meetingUrl,
      reason: "already_scheduled" as const,
    };
  }

  const title = getCalendarMeetingTitle(meeting, input.title);
  const titleSource = getCalendarMeetingTitleSource(meeting);
  const status: MeetingStatus = reconciledManualRecording
    ? meeting?.status ?? "processing"
    : isPastCalendarEvent({
          endsAt: input.endsAt,
          startsAt: input.startsAt,
        })
      ? "missed"
      : "scheduled";

  if (!meeting) {
    try {
      meetingIdentity = (
        await db
          .insert(meetings)
          .values({
            calendarEventId: input.calendarEvent.id,
            endedAt: input.endsAt,
            meetingUrl: input.meetingUrl,
            ownerUserId: input.connection.userId,
            platform: "microsoft_teams",
            startedAt: input.startsAt,
            status,
            teamId: input.connection.teamId,
            teamMeetingKey: input.teamMeetingKey,
            title,
            titleSource,
          })
          .returning({
            id: meetings.id,
            ownerUserId: meetings.ownerUserId,
          })
      )[0];
    } catch (error) {
      if (!isTeamMeetingKeyUniqueConflict(error) || !input.teamMeetingKey) {
        throw error;
      }

      meeting = await findExistingMeeting({
        calendarEventId: input.calendarEvent.id,
        externalEventId: input.event.externalEventId,
        teamId: input.connection.teamId,
        teamMeetingKey: input.teamMeetingKey,
      });

      if (!meeting) {
        throw error;
      }

      meetingIdentity = meeting;
    }
  } else {
    meetingIdentity = meeting;

    if (meeting.recallBotId && input.event.recallCalendarEventId) {
      await deleteRecallCalendarEventBot({
        calendarEventId: input.event.recallCalendarEventId,
      });
    } else if (meeting.recallBotId) {
      await deleteScheduledRecallBot({ botId: meeting.recallBotId });
    }

    await updateMeetingFromCalendar({
      calendarEventId: input.calendarEvent.id,
      endsAt: input.endsAt,
      meetingId: meeting.id,
      meetingUrl: input.meetingUrl,
      platform: "microsoft_teams",
      recallBotId: null,
      startsAt: input.startsAt,
      status,
      teamMeetingKey: input.teamMeetingKey,
      title,
      titleSource,
    });
  }

  if (!meetingIdentity) {
    throw new Error("Microsoft Teams meeting creation failed");
  }

  await cancelLocationRemindersForMeeting(meetingIdentity.id);
  await syncMeetingParticipantAccess({
    attendeeEmails: input.attendeeEmails,
    meetingId: meetingIdentity.id,
    ownerUserId: meetingIdentity.ownerUserId,
    teamId: input.connection.teamId,
  });

  if (input.connection.workspaceDomain) {
    await applyMeetingShareRules({
      attendeeEmails: input.attendeeEmails,
      meetingId: meetingIdentity.id,
      ownerUserId: meetingIdentity.ownerUserId,
      teamId: input.connection.teamId,
      title,
      workspaceDomain: input.connection.workspaceDomain,
    });
  }

  return {
    action: "scheduled" as const,
    calendarEventId: input.calendarEvent.id,
    meetingId: meetingIdentity.id,
    meetingUrl: input.meetingUrl,
    platform: "microsoft_teams" as const,
  };
}

async function findMatchingManualLocalRecorderMeeting(input: {
  endsAt: Date | null;
  ownerUserId: string;
  startsAt: Date;
  teamId: string;
}) {
  const matchPaddingMs = 15 * 60 * 1000;
  const windowStart = new Date(input.startsAt.getTime() - matchPaddingMs);
  const windowEnd = new Date(
    (input.endsAt?.getTime() ??
      input.startsAt.getTime() + 2 * 60 * 60 * 1000) + matchPaddingMs,
  );
  const candidates = await db
    .select({
      id: meetings.id,
      ownerUserId: meetings.ownerUserId,
      calendarEventId: meetings.calendarEventId,
      teamMeetingKey: meetings.teamMeetingKey,
      title: meetings.title,
      titleSource: meetings.titleSource,
      platform: meetings.platform,
      recallBotId: meetings.recallBotId,
      recallRecordingId: meetings.recallRecordingId,
      meetingUrl: meetings.meetingUrl,
      startedAt: meetings.startedAt,
      endedAt: meetings.endedAt,
      status: meetings.status,
    })
    .from(meetings)
    .innerJoin(
      localRecordingAttempts,
      eq(localRecordingAttempts.meetingId, meetings.id),
    )
    .where(
      and(
        eq(meetings.teamId, input.teamId),
        eq(meetings.ownerUserId, input.ownerUserId),
        eq(meetings.platform, "in_person"),
        isNull(meetings.calendarEventId),
        isNotNull(meetings.startedAt),
        lte(meetings.startedAt, windowEnd),
        gte(meetings.startedAt, windowStart),
      ),
    )
    .orderBy(asc(meetings.startedAt))
    .limit(2);

  return candidates.length === 1 ? candidates[0] : null;
}

async function syncLocationCalendarMeeting(input: {
  connection: CalendarConnection;
  calendarEvent: CalendarEventRow;
  attendeeEmails: string[];
  existingMeeting: ExistingMeeting | null;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  location: string;
  teamMeetingKey?: string | null;
}) {
  let meeting = input.existingMeeting;
  const title = getCalendarMeetingTitle(meeting, input.title);
  const titleSource = getCalendarMeetingTitleSource(meeting);

  if (!meeting) {
    meeting = (
      await db
        .insert(meetings)
        .values({
          teamId: input.connection.teamId,
          ownerUserId: input.connection.userId,
          calendarEventId: input.calendarEvent.id,
          teamMeetingKey: input.teamMeetingKey,
          title,
          titleSource,
          platform: "in_person",
          status: "scheduled",
          startedAt: input.startsAt,
          endedAt: input.endsAt,
        })
        .returning({
          id: meetings.id,
          ownerUserId: meetings.ownerUserId,
          calendarEventId: meetings.calendarEventId,
          teamMeetingKey: meetings.teamMeetingKey,
          title: meetings.title,
          titleSource: meetings.titleSource,
          platform: meetings.platform,
          recallBotId: meetings.recallBotId,
          recallRecordingId: meetings.recallRecordingId,
          meetingUrl: meetings.meetingUrl,
          startedAt: meetings.startedAt,
          endedAt: meetings.endedAt,
          status: meetings.status,
        })
    )[0];
  } else {
    if (
      hasCalendarMeetingRecordChange(meeting, {
        calendarEventId: input.calendarEvent.id,
        endedAt: input.endsAt,
        meetingUrl: null,
        platform: "in_person",
        recallBotId: meeting.recallBotId,
        startsAt: input.startsAt,
        teamMeetingKey: input.teamMeetingKey,
        title,
        titleSource,
      }) ||
      meeting.status !== "scheduled"
    ) {
      await db
        .update(meetings)
        .set({
          calendarEventId: input.calendarEvent.id,
          teamMeetingKey: input.teamMeetingKey,
          title,
          titleSource,
          platform: "in_person",
          status: "scheduled",
          meetingUrl: null,
          startedAt: input.startsAt,
          endedAt: input.endsAt,
          updatedAt: new Date(),
        })
        .where(eq(meetings.id, meeting.id));
    }
  }

  if (!meeting) {
    throw new Error("Location meeting creation failed");
  }

  await syncMeetingParticipantAccess({
    attendeeEmails: input.attendeeEmails,
    meetingId: meeting.id,
    ownerUserId: meeting.ownerUserId,
    teamId: input.connection.teamId,
  });

  if (input.connection.workspaceDomain) {
    await applyMeetingShareRules({
      attendeeEmails: input.attendeeEmails,
      meetingId: meeting.id,
      ownerUserId: meeting.ownerUserId,
      teamId: input.connection.teamId,
      title,
      workspaceDomain: input.connection.workspaceDomain,
    });
  }

  const reminderScheduledFor = new Date(input.startsAt.getTime() - 2 * 60 * 1000);

  await scheduleLocationReminder({
    meetingId: meeting.id,
    scheduledFor: reminderScheduledFor,
    userId: input.connection.userId,
  });

  return {
    action: "scheduled" as const,
    calendarEventId: input.calendarEvent.id,
    meetingId: meeting.id,
    platform: "in_person" as const,
    reminderScheduledFor: reminderScheduledFor.toISOString(),
  };
}

async function syncExistingCalendarMeeting(input: {
  meeting: ExistingMeeting;
  event: SyncedCalendarEvent;
  calendarEvent: CalendarEventRow;
  title: string;
  platform: SupportedMeetingPlatform;
  meetingUrl: string;
  startsAt: Date;
  endsAt: Date | null;
  teamId: string;
  creditLimitUsdMicros?: number | null;
  teamMeetingKey?: string | null;
  forceScheduleBot?: boolean;
  recoverRescheduledRecording?: boolean;
}) {
  const canRecoverCalendarMeeting =
    input.recoverRescheduledRecording ||
    shouldRecoverCalendarMeeting(input);
  const ownedByActiveSiblingCalendarEvent =
    isMeetingOwnedByActiveSiblingCalendarEvent({
      currentCalendarEventId: input.calendarEvent.id,
      meeting: input.meeting,
      teamMeetingKey: input.teamMeetingKey,
    });
  const canonicalCalendarEventId =
    ownedByActiveSiblingCalendarEvent && input.meeting.calendarEventId
      ? input.meeting.calendarEventId
      : input.calendarEvent.id;

  if (input.meeting.status !== "scheduled" && !canRecoverCalendarMeeting) {
    return {
      action: "skipped" as const,
      calendarEventId: input.calendarEvent.id,
      meetingId: input.meeting.id,
      meetingUrl: input.meetingUrl,
      reason: "already_scheduled" as const,
    };
  }

  const shouldUpdateBot = hasScheduledBotChange(input.meeting, {
    meetingUrl: input.meetingUrl,
    startsAt: input.startsAt,
  });
  const recallCalendarEventDeduplicationKey =
    getRecallCalendarEventBotDeduplicationKey({
      event: input.event,
      teamMeetingKey: input.teamMeetingKey,
    });
  const shouldLinkRecallCalendarEvent = Boolean(
    input.event.recallCalendarEventId &&
      input.meeting.calendarEventId !== canonicalCalendarEventId,
  );
  const shouldReplaceRecallCalendarEventBot = Boolean(
    input.event.recallCalendarEventId &&
      !ownedByActiveSiblingCalendarEvent &&
      (isExistingBotOutsideRecallCalendarEvent(
        input.event,
        input.meeting.recallBotId,
      ) ||
        hasConflictingRecallCalendarEventBot(
          input.event,
          recallCalendarEventDeduplicationKey,
        )),
  );
  const shouldScheduleBot =
    !ownedByActiveSiblingCalendarEvent &&
    (input.forceScheduleBot ||
      shouldUpdateBot ||
      shouldLinkRecallCalendarEvent ||
      shouldReplaceRecallCalendarEventBot ||
      canRecoverCalendarMeeting);
  let recallBotId = input.meeting.recallBotId;
  let botCleanup: ScheduledRecallBot["cleanup"] = null;

  try {
    if (shouldScheduleBot) {
      const scheduledBot = await scheduleBotForCalendarEvent({
        creditLimitUsdMicros: input.creditLimitUsdMicros,
        event: input.event,
        meetingUrl: input.meetingUrl,
        startsAt: input.startsAt,
        teamId: input.teamId,
        teamMeetingKey: input.teamMeetingKey,
        calendarEventId: input.calendarEvent.id,
        meetingId: input.meeting.id,
        existingBotId: input.meeting.recallBotId ?? undefined,
      });
      botCleanup = scheduledBot.cleanup;
      recallBotId = getRecallBotResponseId(
        scheduledBot.response,
        recallCalendarEventDeduplicationKey,
      );

      if (!recallBotId && input.event.recallCalendarEventId) {
        throw new Error("Recall bot response missing id");
      }

      recallBotId = recallBotId ?? input.meeting.recallBotId;
      if (botCleanup?.kind === "calendar_event" && recallBotId) {
        botCleanup = { ...botCleanup, botId: recallBotId };
      }

      if (
        input.meeting.status === "recording" &&
        input.meeting.recallBotId &&
        recallBotId !== input.meeting.recallBotId
      ) {
        await retireScheduledRecallBot(input.meeting.recallBotId);
      }
    }

    const title = getCalendarMeetingTitle(input.meeting, input.title);
    const titleSource = getCalendarMeetingTitleSource(input.meeting);

    if (
      canRecoverCalendarMeeting ||
      hasCalendarMeetingRecordChange(input.meeting, {
        calendarEventId: canonicalCalendarEventId,
        endedAt: input.endsAt,
        meetingUrl: input.meetingUrl,
        platform: input.platform,
        recallBotId,
        startsAt: input.startsAt,
        teamMeetingKey: input.teamMeetingKey,
        title,
        titleSource,
        clearRecallRecordingId: true,
      })
    ) {
      await updateMeetingFromCalendar({
        calendarEventId: canonicalCalendarEventId,
        meetingId: input.meeting.id,
        title,
        titleSource,
        platform: input.platform,
        meetingUrl: input.meetingUrl,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        teamMeetingKey: input.teamMeetingKey,
        recallBotId,
        status: canRecoverCalendarMeeting ? "scheduled" : undefined,
      });
    }
    botCleanup = null;
  } catch (error) {
    await cleanupScheduledRecallBot(botCleanup);
    await recordCalendarAutoJoinFailure({
      calendarEventId: input.calendarEvent.id,
      error,
      event: input.event,
      meetingId: input.meeting.id,
      meetingUrl: input.meetingUrl,
      reason: "schedule_bot_failed",
      startsAt: input.startsAt,
      teamId: input.teamId,
      title: input.title,
    });
    if (canRecoverCalendarMeeting) {
      await updateMeetingFromCalendar({
        calendarEventId: input.calendarEvent.id,
        meetingId: input.meeting.id,
        title: getCalendarMeetingTitle(input.meeting, input.title),
        titleSource: getCalendarMeetingTitleSource(input.meeting),
        platform: input.platform,
        meetingUrl: input.meetingUrl,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        teamMeetingKey: input.teamMeetingKey,
        recallBotId: null,
        status: "scheduled",
      });
    } else {
      await markMeetingFailed(input.meeting.id);
    }
    throw error;
  }

  if (shouldUpdateBot && !input.forceScheduleBot) {
    return {
      action: "updated" as const,
      calendarEventId: input.calendarEvent.id,
      meetingId: input.meeting.id,
      meetingUrl: input.meetingUrl,
      platform: input.platform,
      recallBotId,
    };
  }

  if (
    !ownedByActiveSiblingCalendarEvent &&
    (shouldLinkRecallCalendarEvent ||
      input.forceScheduleBot ||
      canRecoverCalendarMeeting)
  ) {
    return {
      action: "scheduled" as const,
      calendarEventId: input.calendarEvent.id,
      meetingId: input.meeting.id,
      meetingUrl: input.meetingUrl,
      platform: input.platform,
      recallBotId,
    };
  }

  return {
    action: "skipped" as const,
    calendarEventId: input.calendarEvent.id,
    meetingId: input.meeting.id,
    meetingUrl: input.meetingUrl,
    reason: "already_scheduled" as const,
  };
}

async function updateMeetingFromCalendar(input: {
  calendarEventId: string;
  meetingId: string;
  title: string;
  titleSource: string;
  platform: MeetingLinkPlatform;
  meetingUrl: string;
  startsAt: Date;
  endsAt: Date | null;
  teamMeetingKey?: string | null;
  recallBotId?: string | null;
  status?: MeetingStatus;
}) {
  const updates = {
    calendarEventId: input.calendarEventId,
    title: input.title,
    titleSource: input.titleSource,
    platform: input.platform,
    teamMeetingKey: input.teamMeetingKey,
    meetingUrl: input.meetingUrl,
    startedAt: input.startsAt,
    endedAt: input.endsAt,
    recallBotId: input.recallBotId,
    recallRecordingId: null,
    ...(input.status ? { status: input.status } : {}),
    updatedAt: new Date(),
  };

  const result = await db
    .update(meetings)
    .set(updates)
    .where(eq(meetings.id, input.meetingId));

  if (result?.rowCount === 0) {
    throw new Error("Calendar meeting update failed");
  }
}

function getCalendarMeetingTitle(
  meeting: ExistingMeeting | null | undefined,
  calendarTitle: string,
) {
  return meeting?.titleSource === "manual" ? meeting.title : calendarTitle;
}

function getCalendarMeetingTitleSource(
  meeting: ExistingMeeting | null | undefined,
) {
  return meeting?.titleSource === "manual" ? "manual" : "calendar";
}

async function findExistingMeeting(input: {
  teamId: string;
  calendarEventId: string;
  externalEventId: string;
  teamMeetingKey?: string | null;
}) {
  const matchesSiblingCalendarCopy = sql<boolean>`exists (
    select 1
    from ${calendarEvents} as sibling_calendar_event
    where sibling_calendar_event.id = ${meetings.calendarEventId}
      and sibling_calendar_event.team_id = ${input.teamId}
      and sibling_calendar_event.external_event_id = ${input.externalEventId}
  )`;
  const existing = await db
    .select({
      id: meetings.id,
      ownerUserId: meetings.ownerUserId,
      calendarEventId: meetings.calendarEventId,
      linkedCalendarEventMeetingUrl: sql<string | null>`(
        select linked_calendar_event.meeting_url
        from ${calendarEvents} as linked_calendar_event
        where linked_calendar_event.id = ${meetings.calendarEventId}
        limit 1
      )`,
      linkedCalendarEventTeamMeetingKey: sql<string | null>`(
        select linked_calendar_event.team_meeting_key
        from ${calendarEvents} as linked_calendar_event
        where linked_calendar_event.id = ${meetings.calendarEventId}
        limit 1
      )`,
      teamMeetingKey: meetings.teamMeetingKey,
      title: meetings.title,
      titleSource: meetings.titleSource,
      platform: meetings.platform,
      recallBotId: meetings.recallBotId,
      recallRecordingId: meetings.recallRecordingId,
      meetingUrl: meetings.meetingUrl,
      startedAt: meetings.startedAt,
      endedAt: meetings.endedAt,
      status: meetings.status,
    })
    .from(meetings)
    .where(
      and(
        eq(meetings.teamId, input.teamId),
        or(
          eq(meetings.calendarEventId, input.calendarEventId),
          matchesSiblingCalendarCopy,
          ...(input.teamMeetingKey
            ? [eq(meetings.teamMeetingKey, input.teamMeetingKey)]
            : []),
        ),
      ),
    )
    .limit(25);

  return selectCurrentMeetingOccurrence(existing, input.teamMeetingKey);
}

function selectCurrentMeetingOccurrence(
  existing: ExistingMeeting[],
  teamMeetingKey?: string | null,
) {
  return (
    existing.slice().sort((left, right) => {
      const exactKeyDifference =
        Number(right.teamMeetingKey === teamMeetingKey) -
        Number(left.teamMeetingKey === teamMeetingKey);

      if (teamMeetingKey && exactKeyDifference !== 0) {
        return exactKeyDifference;
      }

      return (
        (right.startedAt?.getTime() ?? Number.NEGATIVE_INFINITY) -
        (left.startedAt?.getTime() ?? Number.NEGATIVE_INFINITY)
      );
    })[0] ?? null
  );
}

async function findCalendarEvent(input: {
  connectionId: string;
  externalEventId: string;
}) {
  const [event] = await db
    .select({
      id: calendarEvents.id,
      teamMeetingKey: calendarEvents.teamMeetingKey,
    })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.connectionId, input.connectionId),
        eq(calendarEvents.externalEventId, input.externalEventId),
      ),
    )
    .limit(1);

  return event ?? null;
}

async function hasOtherActiveCalendarEventForTeamMeeting(input: {
  teamId: string;
  calendarEvent: CalendarEventRow;
  teamMeetingKey?: string | null;
}) {
  if (!input.teamMeetingKey) {
    return false;
  }

  const active = await db
    .select({
      id: calendarEvents.id,
      meetingUrl: calendarEvents.meetingUrl,
    })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.teamId, input.teamId),
        eq(calendarEvents.teamMeetingKey, input.teamMeetingKey),
        ne(calendarEvents.id, input.calendarEvent.id),
        isNotNull(calendarEvents.meetingUrl),
      ),
    )
    .limit(25);

  return active.some((event) => isSupportedMeetingUrl(event.meetingUrl));
}

function isTeamMeetingKeyUniqueConflict(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown; constraint?: unknown };

  return (
    candidate.code === "23505" &&
    candidate.constraint === "meetings_team_meeting_key_unique"
  );
}

async function markMeetingFailed(meetingId: string) {
  await db
    .update(meetings)
    .set({
      status: "failed",
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, meetingId));
}

async function recordCalendarAutoJoinFailure(input: {
  calendarEventId: string;
  error: unknown;
  event: SyncedCalendarEvent;
  meetingId: string;
  meetingUrl: string;
  reason: "schedule_bot_failed";
  startsAt: Date;
  teamId: string;
  title: string;
  userId?: string;
}) {
  const metadata = {
    calendarEventId: input.calendarEventId,
    errorMessage: getErrorMessage(input.error),
    externalEventId: input.event.externalEventId,
    meetingId: input.meetingId,
    meetingUrl: input.meetingUrl,
    reason: input.reason,
    recallCalendarEventId: input.event.recallCalendarEventId ?? null,
    startsAt: input.startsAt.toISOString(),
    title: input.title,
  };

  console.error("calendar_auto_join_failure", metadata);

  await capturePostHogEvent("calendar_auto_join_failure", {
    distinctId: input.userId ?? input.meetingId,
    properties: {
      ...metadata,
      service: "meeting-note",
      teamId: input.teamId,
      userId: input.userId ?? null,
    },
  });

  try {
    await db.insert(auditEvents).values({
      action: "calendar_auto_join_failure",
      actorUserId: input.userId ?? null,
      metadata,
      targetId: input.meetingId,
      targetType: "meeting",
      teamId: input.teamId,
    });
  } catch {
    // Keep the original scheduling error as the authoritative failure.
  }
}

async function capturePostHogEvent(
  event: string,
  input: {
    distinctId: string;
    properties: Record<string, unknown>;
  },
) {
  const apiKey = process.env.POSTHOG_API_KEY?.trim();

  if (!apiKey) {
    return;
  }

  const host = getPostHogHost();

  try {
    const response = await fetch(`${host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        distinct_id: input.distinctId,
        event,
        properties: input.properties,
      }),
    });

    if (!response.ok) {
      console.error("posthog_capture_failed", {
        event,
        status: response.status,
      });
    }
  } catch (error) {
    console.error("posthog_capture_failed", {
      errorMessage: getErrorMessage(error),
      event,
    });
  }
}

function getPostHogHost() {
  const host = process.env.POSTHOG_HOST?.trim() || "https://us.i.posthog.com";
  return host.replace(/\/+$/, "");
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown calendar sync error";
}

async function markMeetingMissedFromCalendar(input: {
  meetingId: string;
  title: string;
  titleSource?: string | null;
  platform: SupportedMeetingPlatform;
  meetingUrl: string;
  startsAt: Date;
  endsAt: Date | null;
  teamMeetingKey?: string | null;
  recallBotId?: string | null;
}) {
  await db
    .update(meetings)
    .set({
      title: input.title,
      titleSource: input.titleSource === "manual" ? "manual" : "calendar",
      platform: input.platform,
      teamMeetingKey: input.teamMeetingKey,
      meetingUrl: input.meetingUrl,
      startedAt: input.startsAt,
      endedAt: input.endsAt,
      recallBotId: input.recallBotId,
      status: "missed",
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, input.meetingId));
  await cancelLocationRemindersForMeeting(input.meetingId);
}

function shouldPreserveIgnoredCalendarMeeting(meeting: ExistingMeeting) {
  return (
    meeting.status === "processing" ||
    meeting.status === "ready" ||
    meeting.status === "missed" ||
    meeting.status === "cancelled"
  );
}

async function cancelScheduledMeetingBotFromCalendar(input: {
  botId?: string | null;
  durableBotCleanup?: boolean;
  meetingId: string;
  title: string;
  titleSource?: string | null;
  meetingUrl: string | null;
  nextStatus?: "cancelled" | "failed";
  recallCalendarEventId?: string | null;
  skipVendorDelete?: boolean;
  startsAt: Date;
  endsAt: Date | null;
}) {
  if (input.skipVendorDelete) {
    // Recall Calendar V2 automatically removes scheduled bots for deleted events.
  } else if (
    input.durableBotCleanup &&
    input.botId &&
    input.recallCalendarEventId
  ) {
    await retireRecallCalendarEventBot({
      botId: input.botId,
      calendarEventId: input.recallCalendarEventId,
    });
  } else if (input.durableBotCleanup && input.botId) {
    await retireScheduledRecallBot(input.botId);
  } else if (input.botId && input.recallCalendarEventId) {
    await deleteRecallCalendarEventBot({
      calendarEventId: input.recallCalendarEventId,
    });
  } else if (input.botId) {
    await deleteScheduledRecallBot({ botId: input.botId });
  }
  await db
    .update(meetings)
    .set({
      title: input.title,
      titleSource: input.titleSource === "manual" ? "manual" : "calendar",
      meetingUrl: input.meetingUrl,
      teamMeetingKey: null,
      startedAt: input.startsAt,
      endedAt: input.endsAt,
      recallBotId: null,
      status:
        input.nextStatus ?? (input.skipVendorDelete ? "cancelled" : "failed"),
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, input.meetingId));
}

async function scheduleBotForCalendarEvent(input: {
  creditLimitUsdMicros?: number | null;
  event: SyncedCalendarEvent;
  meetingUrl: string;
  startsAt: Date;
  teamMeetingKey?: string | null;
  calendarEventId: string;
  meetingId: string;
  teamId: string;
  existingBotId?: string;
}) {
  await assertWorkspaceHasProviderCredit(input);
  const botProfile = await getMeetingBotProfile(input.teamId);
  const metadata = {
    ...getMeetingBotMetadata(botProfile),
    calendarEventId: input.calendarEventId,
    meetingId: input.meetingId,
  };

  if (input.event.recallCalendarEventId) {
    const deduplicationKey = getRecallCalendarEventBotDeduplicationKey({
      event: input.event,
      teamMeetingKey: input.teamMeetingKey,
    });
    const hasEventBotSnapshot = Array.isArray(input.event.recallCalendarEventBots);
    const existingBotIsCalendarEventBot =
      input.existingBotId && hasEventBotSnapshot
        ? input.event.recallCalendarEventBots?.some(
            (bot) => bot.botId === input.existingBotId,
          )
        : null;
    const hasConflictingEventBot = hasConflictingRecallCalendarEventBot(
      input.event,
      deduplicationKey,
    );

    if (input.existingBotId && existingBotIsCalendarEventBot === false) {
      await deleteScheduledRecallBot({ botId: input.existingBotId });
    }

    if (
      (input.existingBotId && existingBotIsCalendarEventBot !== false) ||
      hasConflictingEventBot
    ) {
      await deleteRecallCalendarEventBot({
        calendarEventId: input.event.recallCalendarEventId,
      });
    }

    const response = (await scheduleRecallCalendarEventBot({
      calendarEventId: input.event.recallCalendarEventId,
      deduplicationKey: deduplicationKey ?? input.event.recallCalendarEventId,
      ...getMeetingBotRecallCreateInput(botProfile),
      metadata,
    })) as RecallBotResponse;

    return {
      cleanup: {
        calendarEventId: input.event.recallCalendarEventId,
        kind: "calendar_event",
      },
      response,
    } satisfies ScheduledRecallBot;
  }

  if (input.existingBotId) {
    try {
      const response = (await updateScheduledRecallBot({
        botId: input.existingBotId,
        meetingUrl: input.meetingUrl,
        ...getMeetingBotRecallUpdateInput(botProfile),
        startAt: input.startsAt.toISOString(),
        metadata,
      })) as RecallBotResponse;

      return {
        cleanup: null,
        response,
      } satisfies ScheduledRecallBot;
    } catch (error) {
      if (!isMissingRecallBotUpdateError(error)) {
        throw error;
      }
    }
  }

  const response = (await scheduleRecallBot({
    meetingUrl: input.meetingUrl,
    ...getMeetingBotRecallCreateInput(botProfile),
    startAt: input.startsAt.toISOString(),
    webhookUrl: buildAppUrl("/api/recall/webhook"),
    metadata,
  })) as RecallBotResponse;

  return {
    cleanup:
      typeof response.id === "string"
        ? { botId: response.id, kind: "scheduled_bot" }
        : null,
    response,
  } satisfies ScheduledRecallBot;
}

async function cleanupScheduledRecallBot(
  cleanup: ScheduledRecallBot["cleanup"],
) {
  if (cleanup?.kind === "calendar_event") {
    await retireRecallCalendarEventBot({
      botId: cleanup.botId,
      calendarEventId: cleanup.calendarEventId,
    }).catch(() => undefined);
  } else if (cleanup?.kind === "scheduled_bot") {
    await retireScheduledRecallBot(cleanup.botId).catch(
      () => undefined,
    );
  }
}

function buildTeamMeetingKey(input: {
  teamId: string;
  startsAt: Date;
  meetingUrl: string;
}) {
  return [
    `team:${input.teamId}`,
    `start:${input.startsAt.toISOString()}`,
    `url:${normalizeMeetingUrlForKey(input.meetingUrl)}`,
  ].join(":");
}

function buildLocationMeetingKey(input: {
  teamId: string;
  startsAt: Date;
  location: string;
}) {
  return [
    `team:${input.teamId}`,
    `start:${input.startsAt.toISOString()}`,
    `location:${input.location.toLowerCase().replace(/\s+/g, " ").trim()}`,
  ].join(":");
}

function normalizeMeetingUrlForKey(meetingUrl: string) {
  try {
    const url = new URL(meetingUrl);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";
    url.pathname = url.pathname.replace(/\/$/, "");

    return url.toString().replace(/\/$/, "");
  } catch {
    return meetingUrl.trim();
  }
}

function getRecallCalendarEventBotDeduplicationKey(input: {
  event: SyncedCalendarEvent;
  teamMeetingKey?: string | null;
}) {
  if (!input.event.recallCalendarEventId) {
    return null;
  }

  return (
    input.teamMeetingKey ??
    input.event.recallCalendarEventDeduplicationKey ??
    input.event.recallCalendarEventId
  );
}

function getRecallBotResponseId(
  bot: RecallBotResponse,
  deduplicationKey?: string | null,
) {
  if (deduplicationKey) {
    const botEntry = bot.bots?.find(
      (candidate) =>
        candidate.deduplication_key === deduplicationKey &&
        typeof candidate.bot_id === "string",
    );

    return typeof botEntry?.bot_id === "string" ? botEntry.bot_id : null;
  }

  const botEntry = bot.bots?.find(
    (candidate) => typeof candidate.bot_id === "string",
  );

  if (typeof botEntry?.bot_id === "string") {
    return botEntry.bot_id;
  }

  return typeof bot.id === "string" ? bot.id : null;
}

function isMissingRecallBotUpdateError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.startsWith("Recall bot update failed with 404 ")
  );
}

function hasConflictingRecallCalendarEventBot(
  event: SyncedCalendarEvent,
  deduplicationKey: string | null,
) {
  return Boolean(
    deduplicationKey &&
      event.recallCalendarEventBots?.length &&
      !event.recallCalendarEventBots.some(
        (bot) => bot.deduplicationKey === deduplicationKey,
      ),
  );
}

function isExistingBotOutsideRecallCalendarEvent(
  event: SyncedCalendarEvent,
  existingBotId: string | null,
) {
  return Boolean(
    existingBotId &&
      Array.isArray(event.recallCalendarEventBots) &&
      !event.recallCalendarEventBots.some((bot) => bot.botId === existingBotId),
  );
}

function hasScheduledBotChange(
  meeting: ExistingMeeting,
  next: { meetingUrl: string; startsAt: Date },
) {
  return (
    meeting.meetingUrl !== next.meetingUrl ||
    meeting.startedAt?.getTime() !== next.startsAt.getTime()
  );
}

function isMeetingOwnedByActiveSiblingCalendarEvent(input: {
  currentCalendarEventId: string;
  meeting: ExistingMeeting;
  teamMeetingKey?: string | null;
}) {
  return Boolean(
    input.teamMeetingKey &&
      input.meeting.calendarEventId &&
      input.meeting.calendarEventId !== input.currentCalendarEventId &&
      input.meeting.linkedCalendarEventTeamMeetingKey ===
        input.teamMeetingKey &&
      isSupportedMeetingUrl(input.meeting.linkedCalendarEventMeetingUrl),
  );
}

function needsUnchangedCalendarEventRepair(input: {
  calendarEventId: string;
  event: SyncedCalendarEvent;
  existingMeeting: ExistingMeeting;
  forceBotConfigRefresh?: boolean;
  meetingUrl: string | null;
  platform: MeetingLinkPlatform | null;
  recoverRescheduledRecording?: boolean;
  startsAt: Date;
  endsAt: Date | null;
  teamMeetingKey?: string | null;
  title: string;
}) {
  const ownedByActiveSiblingCalendarEvent =
    isMeetingOwnedByActiveSiblingCalendarEvent({
      currentCalendarEventId: input.calendarEventId,
      meeting: input.existingMeeting,
      teamMeetingKey: input.teamMeetingKey,
    });

  if (input.forceBotConfigRefresh && !ownedByActiveSiblingCalendarEvent) {
    return true;
  }

  if (input.meetingUrl && input.platform) {
    if (
      input.recoverRescheduledRecording ||
      shouldRecoverCalendarMeeting({
        endsAt: input.endsAt,
        meeting: input.existingMeeting,
        meetingUrl: input.meetingUrl,
        startsAt: input.startsAt,
      })
    ) {
      return true;
    }

    if (
      input.platform === "microsoft_teams" &&
      input.existingMeeting.status === "scheduled" &&
      isPastCalendarEvent({
        endsAt: input.endsAt,
        startsAt: input.startsAt,
      })
    ) {
      return true;
    }

    if (
      input.existingMeeting.status === "scheduled" &&
      !input.existingMeeting.recallBotId &&
      input.platform !== "microsoft_teams"
    ) {
      return true;
    }

    const deduplicationKey = getRecallCalendarEventBotDeduplicationKey({
      event: input.event,
      teamMeetingKey: input.teamMeetingKey,
    });

    if (
      input.event.recallCalendarEventId &&
      !ownedByActiveSiblingCalendarEvent &&
      (input.existingMeeting.calendarEventId !== input.calendarEventId ||
        isExistingBotOutsideRecallCalendarEvent(
          input.event,
          input.existingMeeting.recallBotId,
        ) ||
        hasConflictingRecallCalendarEventBot(
          input.event,
          deduplicationKey,
        ))
    ) {
      return true;
    }
  }

  if (input.existingMeeting.status !== "scheduled") {
    return false;
  }

  return hasCalendarMeetingRecordChange(input.existingMeeting, {
    calendarEventId:
      ownedByActiveSiblingCalendarEvent &&
      input.existingMeeting.calendarEventId
        ? input.existingMeeting.calendarEventId
        : input.calendarEventId,
    endedAt: input.endsAt,
    meetingUrl: input.meetingUrl,
    platform: input.platform ?? input.existingMeeting.platform,
    recallBotId: input.existingMeeting.recallBotId,
    startsAt: input.startsAt,
    teamMeetingKey: input.teamMeetingKey,
    title: getCalendarMeetingTitle(input.existingMeeting, input.title),
    titleSource: getCalendarMeetingTitleSource(input.existingMeeting),
  });
}

function hasCalendarMeetingRecordChange(
  meeting: ExistingMeeting,
  next: {
    calendarEventId: string;
    clearRecallRecordingId?: boolean;
    endedAt: Date | null;
    meetingUrl: string | null;
    platform: MeetingPlatform;
    recallBotId: string | null;
    startsAt: Date;
    teamMeetingKey?: string | null;
    title: string;
    titleSource: string;
  },
) {
  return (
    meeting.calendarEventId !== next.calendarEventId ||
    meeting.teamMeetingKey !== (next.teamMeetingKey ?? null) ||
    meeting.title !== next.title ||
    meeting.titleSource !== next.titleSource ||
    meeting.platform !== next.platform ||
    meeting.meetingUrl !== next.meetingUrl ||
    meeting.startedAt?.getTime() !== next.startsAt.getTime() ||
    (meeting.endedAt?.getTime() ?? null) !==
      (next.endedAt?.getTime() ?? null) ||
    meeting.recallBotId !== next.recallBotId ||
    (next.clearRecallRecordingId === true &&
      meeting.recallRecordingId !== null)
  );
}

function shouldRecoverCalendarMeeting(input: {
  endsAt: Date | null;
  meeting: ExistingMeeting;
  meetingUrl: string;
  startsAt: Date;
}) {
  if (!isCalendarOccurrenceActiveOrUpcoming(input.startsAt, input.endsAt)) {
    return false;
  }

  if (input.meeting.status === "failed") {
    return true;
  }

  return (
    input.meeting.status === "missed" &&
    hasScheduledBotChange(input.meeting, {
      meetingUrl: input.meetingUrl,
      startsAt: input.startsAt,
    })
  );
}

async function canSafelyRecoverRescheduledRecording(input: {
  endsAt: Date | null;
  meeting: ExistingMeeting;
  meetingUrl: string | null;
  startsAt: Date;
}) {
  if (
    input.meeting.status !== "recording" ||
    input.meeting.recallRecordingId ||
    !input.meeting.recallBotId ||
    !input.meetingUrl ||
    !isCalendarOccurrenceActiveOrUpcoming(input.startsAt, input.endsAt) ||
    !hasScheduledBotChange(input.meeting, {
      meetingUrl: input.meetingUrl,
      startsAt: input.startsAt,
    })
  ) {
    return false;
  }

  try {
    const bot = await retrieveRecallBot(input.meeting.recallBotId);

    if (!bot || typeof bot !== "object") {
      return false;
    }

    const candidate = bot as {
      recordings?: unknown;
      status_changes?: unknown;
    };
    if (Array.isArray(candidate.recordings) && candidate.recordings.length > 0) {
      return false;
    }

    const statusCodes = Array.isArray(candidate.status_changes)
      ? candidate.status_changes
          .map((status) => {
            if (!status || typeof status !== "object") {
              return null;
            }

            const code = (status as { code?: unknown }).code;
            return typeof code === "string" ? code.toLowerCase() : null;
          })
          .filter((code): code is string => Boolean(code))
      : [];
    const latestStatus = statusCodes.at(-1);

    return Boolean(
      latestStatus &&
        !statusCodes.includes("in_call_recording") &&
        new Set([
          "joining_call",
          "in_waiting_room",
          "call_ended",
          "done",
          "fatal",
        ]).has(latestStatus),
    );
  } catch {
    return false;
  }
}

function shouldCreateNewRecordedMeetingOccurrence(input: {
  meeting: ExistingMeeting;
  startsAt: Date;
  endsAt: Date | null;
}) {
  const previousStart = input.meeting.startedAt?.getTime();
  const nextStart = input.startsAt.getTime();
  const now = Date.now();

  return Boolean(
    input.meeting.recallRecordingId &&
      previousStart !== undefined &&
      previousStart <= now &&
      isCalendarOccurrenceActiveOrUpcoming(input.startsAt, input.endsAt) &&
      previousStart !== nextStart,
  );
}

function isCalendarOccurrenceActiveOrUpcoming(
  startsAt: Date,
  endsAt: Date | null,
) {
  const endTime = endsAt?.getTime() ?? startsAt.getTime() + 60 * 60 * 1000;

  return endTime > Date.now();
}

function getConferenceEntryPointUris(event: SyncedCalendarEvent) {
  return (event.conferenceData?.entryPoints ?? [])
    .filter(
      (entryPoint) =>
        !entryPoint.entryPointType || entryPoint.entryPointType === "video",
    )
    .map((entryPoint) => entryPoint.uri);
}

function extractUrls(value?: string | null) {
  const urls = new Set<string>();

  for (const match of value?.matchAll(/https?:\/\/[^\s<>"']+/g) ?? []) {
    urls.add(trimUrlPunctuation(match[0]));
  }

  for (const match of value?.matchAll(
    /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*zoom\.us\/j\/[^\s<>"']+/gi,
  ) ?? []) {
    const normalized = normalizeExtractedMeetingUrl(match[0]);

    if (normalized) {
      urls.add(normalized);
    }
  }

  return Array.from(urls);
}

function getCalendarImportDescriptionHeader(value?: string | null) {
  return value?.trimStart().split(/\r?\n/, 1)[0]?.slice(0, 500) ?? null;
}

function matchesHostname(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function trimUrlPunctuation(value: string) {
  return value.replace(/[),.;\]]+$/, "");
}

function normalizeExtractedMeetingUrl(value: string) {
  const candidate = trimUrlPunctuation(value);
  const withProtocol = /^https?:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`;

  try {
    const url = new URL(withProtocol);
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase();

    return isSupportedMeetingUrl(url.toString()) ? url.toString() : null;
  } catch {
    return null;
  }
}

function isSupportedMeetingUrl(value?: string | null): value is string {
  return Boolean(value && detectMeetingPlatform(value));
}

function isHttpUrl(value?: string | null): value is string {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeAttendeeEmails(attendeeEmails: string[]) {
  return Array.from(
    new Set(
      attendeeEmails
        .map(normalizeEmail)
        .filter((email) => email.includes("@")),
    ),
  );
}

function getCalendarAttendeeEmails(event: SyncedCalendarEvent) {
  const attendeeEmails =
    event.attendeeEmails ??
    event.attendees?.map((attendee) => attendee.email) ??
    [];

  return normalizeAttendeeEmails(attendeeEmails);
}

function isDeclinedByAllExternalAttendees(input: AutoJoinInput) {
  const workspaceDomain = normalizeWorkspaceDomain(
    input.connection.workspaceDomain,
  );

  if (!workspaceDomain || !input.event.attendees?.length) {
    return false;
  }

  const externalAttendees = input.event.attendees
    .map((attendee) => ({
      email: normalizeEmail(attendee.email),
      responseStatus: attendee.responseStatus?.trim().toLowerCase() ?? null,
    }))
    .filter((attendee) => {
      const domain = attendee.email.split("@")[1]?.trim().toLowerCase();

      return Boolean(domain && domain !== workspaceDomain);
    });

  return (
    externalAttendees.length > 0 &&
    externalAttendees.every(
      (attendee) => attendee.responseStatus === "declined",
    )
  );
}

function isPastCalendarEvent(input: { startsAt: Date; endsAt: Date | null }) {
  const endTime = (input.endsAt ?? input.startsAt).getTime();

  return Number.isFinite(endTime) && endTime <= Date.now();
}

function normalizeEventTitle(
  event: SyncedCalendarEvent,
  platform: MeetingLinkPlatform | null,
  workspaceDomain?: string | null,
  workspaceName?: string | null,
) {
  const title = event.title.trim();
  const attendeeDomains = (event.attendeeEmails ?? [])
    .map((email) => email.split("@")[1]?.trim().toLowerCase())
    .filter((domain): domain is string => Boolean(domain));
  const resolvedWorkspaceDomain =
    normalizeWorkspaceDomain(workspaceDomain) ?? attendeeDomains[0] ?? "";

  return buildSmartMeetingTitle({
    eventTitle:
      title ||
      (platform === "zoom"
        ? "Zoom recording"
        : platform === "microsoft_teams"
          ? "Microsoft Teams recording"
          : "Google Meet recording"),
    attendeeEmails: event.attendeeEmails ?? [],
    workspaceDomain: resolvedWorkspaceDomain,
    workspaceName,
  });
}

function parseEventDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Calendar event date is invalid");
  }

  return date;
}

function normalizeWorkspaceDomain(value?: string | null) {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  return normalized.includes("@")
    ? (normalized.split("@")[1]?.trim() ?? null)
    : normalized;
}
