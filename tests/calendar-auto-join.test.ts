import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@/lib/provider-credit", () => ({
  assertWorkspaceHasProviderCredit: vi.fn(),
}));

const {
  applyMeetingShareRules,
  deleteRecallCalendarEventBot,
  deleteScheduledRecallBot,
  getDatabaseClaimsJson,
  getMeetingBotProfile,
  cancelLocationRemindersForMeeting,
  hasUndispatchedLocationReminder,
  insert,
  randomUUID,
  retrieveRecallBot,
  scheduleLocationReminder,
  scheduleRecallCalendarEventBot,
  scheduleRecallBot,
  select,
  syncMeetingParticipantAccess,
  retireRecallCalendarEventBot,
  retireScheduledRecallBot,
  update,
  updateScheduledRecallBot,
} = vi.hoisted(() => ({
  applyMeetingShareRules: vi.fn(),
  deleteRecallCalendarEventBot: vi.fn(),
  deleteScheduledRecallBot: vi.fn(),
  getDatabaseClaimsJson: vi.fn(),
  getMeetingBotProfile: vi.fn(),
  cancelLocationRemindersForMeeting: vi.fn(),
  hasUndispatchedLocationReminder: vi.fn(),
  insert: vi.fn(),
  randomUUID: vi.fn(),
  retrieveRecallBot: vi.fn(),
  scheduleLocationReminder: vi.fn(),
  scheduleRecallCalendarEventBot: vi.fn(),
  scheduleRecallBot: vi.fn(),
  select: vi.fn(),
  syncMeetingParticipantAccess: vi.fn(),
  retireRecallCalendarEventBot: vi.fn(),
  retireScheduledRecallBot: vi.fn(),
  update: vi.fn(),
  updateScheduledRecallBot: vi.fn(),
}));

vi.mock("node:crypto", () => ({
  randomUUID,
}));

vi.mock("@/db/rls-context", () => ({
  getDatabaseClaimsJson,
}));

vi.mock("@/lib/meeting-share-rules", () => ({
  applyMeetingShareRules,
}));

vi.mock("@/lib/meeting-bot-retirement", () => ({
  retireRecallCalendarEventBot,
  retireScheduledRecallBot,
}));

vi.mock("@/lib/location-reminders", () => ({
  cancelLocationRemindersForMeeting,
  hasUndispatchedLocationReminder,
  scheduleLocationReminder,
}));

vi.mock("@/lib/meeting-participant-access", () => ({
  syncMeetingParticipantAccess,
}));

vi.mock("@/db/client", () => ({
  db: {
    insert,
    select,
    update,
  },
}));

vi.mock("@/lib/vendors/recall", () => ({
  deleteRecallCalendarEventBot,
  deleteScheduledRecallBot,
  retrieveRecallBot,
  scheduleRecallCalendarEventBot,
  scheduleRecallBot,
  updateScheduledRecallBot,
}));

vi.mock("@/lib/meeting-bot-profile", () => ({
  getMeetingBotProfile,
  getMeetingBotMetadata: (profile: {
    botName: string;
    avatarJpegBase64: string | null;
  }) => (profile.botName === "IOSG Old Friend" ? {} : { botName: profile.botName }),
  getMeetingBotRecallCreateInput: (profile: {
    botName: string;
    avatarJpegBase64: string | null;
  }) => ({
    botName: profile.botName,
    ...(profile.avatarJpegBase64
      ? { avatarJpegBase64: profile.avatarJpegBase64 }
      : {}),
  }),
  getMeetingBotRecallUpdateInput: (profile: {
    botName: string;
    avatarJpegBase64: string | null;
  }) => ({
    ...(profile.botName === "IOSG Old Friend"
      ? {}
      : { botName: profile.botName }),
    ...(profile.avatarJpegBase64
      ? { avatarJpegBase64: profile.avatarJpegBase64 }
      : {}),
  }),
}));

function selectRows(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    limit: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn(() => chain),
    where: vi.fn(() => chain),
  };

  return chain;
}

describe("calendar auto join", () => {
  beforeEach(() => {
    getDatabaseClaimsJson.mockReturnValue('{"app_context_trusted":true}');
    randomUUID.mockReturnValue(
      "44444444-4444-4444-8444-444444444444",
    );
    deleteRecallCalendarEventBot.mockResolvedValue({});
    deleteScheduledRecallBot.mockResolvedValue({});
    cancelLocationRemindersForMeeting.mockResolvedValue(undefined);
    hasUndispatchedLocationReminder.mockResolvedValue(false);
    scheduleLocationReminder.mockResolvedValue({
      id: "66666666-6666-4666-8666-666666666666",
    });
    applyMeetingShareRules.mockResolvedValue({ sharedCount: 0 });
    syncMeetingParticipantAccess.mockResolvedValue({
      attendeeCount: 0,
      internalParticipantCount: 0,
    });
    retireRecallCalendarEventBot.mockResolvedValue(undefined);
    retireScheduledRecallBot.mockResolvedValue(undefined);
    getMeetingBotProfile.mockResolvedValue({
      botName: "IOSG Old Friend",
      avatarJpegBase64: null,
    });
  });

  afterEach(() => {
    applyMeetingShareRules.mockReset();
    deleteRecallCalendarEventBot.mockReset();
    deleteScheduledRecallBot.mockReset();
    getDatabaseClaimsJson.mockReset();
    getMeetingBotProfile.mockReset();
    cancelLocationRemindersForMeeting.mockReset();
    hasUndispatchedLocationReminder.mockReset();
    insert.mockReset();
    randomUUID.mockReset();
    retrieveRecallBot.mockReset();
    scheduleLocationReminder.mockReset();
    scheduleRecallCalendarEventBot.mockReset();
    scheduleRecallBot.mockReset();
    select.mockReset();
    syncMeetingParticipantAccess.mockReset();
    retireRecallCalendarEventBot.mockReset();
    retireScheduledRecallBot.mockReset();
    update.mockReset();
    updateScheduledRecallBot.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("extracts a conferencing meeting link when the calendar event has no location", async () => {
    const { findCalendarMeetingUrl } = await import("@/lib/calendar-auto-join");

    expect(
      findCalendarMeetingUrl({
        externalEventId: "google_event_123",
        title: "Partner sync",
        startsAt: "2026-06-30T12:00:00.000Z",
        location: null,
        conferenceData: {
          entryPoints: [
            {
              entryPointType: "video",
              uri: "https://meet.google.com/abc-defg-hij",
            },
          ],
        },
      }),
    ).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("normalizes bare Zoom links from calendar text", async () => {
    const { findCalendarMeetingUrl } = await import("@/lib/calendar-auto-join");

    expect(
      findCalendarMeetingUrl({
        externalEventId: "google_event_123",
        title: "Partner sync",
        startsAt: "2026-06-30T12:00:00.000Z",
        description: "Join Zoom.us/j/1234567890",
      }),
    ).toBe("https://zoom.us/j/1234567890");
  });

  it("ignores physical map URLs in the calendar location", async () => {
    const { findCalendarMeetingUrl } = await import("@/lib/calendar-auto-join");

    expect(
      findCalendarMeetingUrl({
        externalEventId: "google_event_123",
        title: "Office sync",
        startsAt: "2026-06-30T12:00:00.000Z",
        location: "HQ 12F https://maps.google.com/?q=HQ",
      }),
    ).toBeNull();
  });

  it("identifies Luma and Partiful imports without using the event title", async () => {
    const { getIgnoredCalendarEventSource } = await import(
      "@/lib/calendar-auto-join"
    );
    const event = {
      externalEventId: "google_event_123",
      title: "Build Your First App with Replit Workshop",
      startsAt: "2026-08-01T16:00:00.000Z",
    };

    expect(
      getIgnoredCalendarEventSource({
        ...event,
        description:
          "For the latest information, visit: https://luma.com/event/evt-example",
      }),
    ).toBe("luma");
    expect(
      getIgnoredCalendarEventSource({
        ...event,
        location: "https://lu.ma/example",
      }),
    ).toBe("luma");
    expect(
      getIgnoredCalendarEventSource({
        ...event,
        description: "https://partiful.com/e/601HMiX2MyXcqNSetMPK",
      }),
    ).toBe("partiful");
    expect(getIgnoredCalendarEventSource(event)).toBeNull();
    expect(
      getIgnoredCalendarEventSource({
        ...event,
        description:
          "Partner meeting agenda\nDiscuss https://luma.com/event/evt-example",
      }),
    ).toBeNull();
  });

  it("cancels an active Luma bot and stale reminder when auto join is disabled", async () => {
    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([
        {
          id: "33333333-3333-4333-8333-333333333333",
          teamMeetingKey: null,
        },
      ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });
    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        ownerUserId: "55555555-5555-4555-8555-555555555555",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey: "old_location_key",
        title: "Build Your First App with Replit Workshop",
        titleSource: "calendar",
        platform: "google_meet",
        recallBotId: "active_bot",
        recallRecordingId: null,
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        startedAt: new Date("2026-08-01T16:00:00.000Z"),
        endedAt: new Date("2026-08-01T17:00:00.000Z"),
        status: "recording",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: false,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "66666666-6666-4666-8666-666666666666",
          title: "Build Your First App with Replit Workshop",
          startsAt: "2026-08-01T16:00:00.000Z",
          endsAt: "2026-08-01T17:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
          location: "Online",
          description:
            "For the latest information, visit: https://luma.com/event/evt-example",
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      reason: "ignored_event",
    });

    expect(calendarEventValues).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingUrl: null,
        teamMeetingKey: null,
      }),
    );
    const conflictUpdate =
      calendarEventOnConflictDoUpdate.mock.calls[0]?.[0] as {
        set: { teamMeetingKey: unknown };
        setWhere: Parameters<PgDialect["sqlToQuery"]>[0];
      };
    expect(conflictUpdate.set.teamMeetingKey).toBeNull();
    expect(new PgDialect().sqlToQuery(conflictUpdate.setWhere).sql).toContain(
      "is distinct from excluded.team_meeting_key",
    );
    expect(cancelLocationRemindersForMeeting).toHaveBeenCalledWith(
      "44444444-4444-4444-8444-444444444444",
    );
    expect(retireRecallCalendarEventBot).toHaveBeenCalledWith({
      botId: "active_bot",
      calendarEventId: "66666666-6666-4666-8666-666666666666",
    });
    expect(deleteRecallCalendarEventBot).not.toHaveBeenCalled();
    expect(deleteScheduledRecallBot).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "cancelled",
        teamMeetingKey: null,
      }),
    );
    expect(scheduleLocationReminder).not.toHaveBeenCalled();
    expect(scheduleRecallCalendarEventBot).not.toHaveBeenCalled();
    expect(scheduleRecallBot).not.toHaveBeenCalled();
    expect(syncMeetingParticipantAccess).not.toHaveBeenCalled();
    expect(applyMeetingShareRules).not.toHaveBeenCalled();
  });

  it("preserves completed recordings for newly ignored event imports", async () => {
    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([
        {
          id: "33333333-3333-4333-8333-333333333333",
          teamMeetingKey: null,
        },
      ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });
    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        ownerUserId: "55555555-5555-4555-8555-555555555555",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        recallBotId: "recorded_bot",
        recallRecordingId: "recording_123",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        status: "ready",
      },
    ]);

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          title: "Build Your First App with Replit Workshop",
          startsAt: "2026-07-01T16:00:00.000Z",
          endsAt: "2026-07-01T17:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
          description:
            "For the latest information, visit: https://partiful.com/e/601HMiX2MyXcqNSetMPK",
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      reason: "ignored_event",
    });

    expect(deleteRecallCalendarEventBot).not.toHaveBeenCalled();
    expect(deleteScheduledRecallBot).not.toHaveBeenCalled();
    expect(cancelLocationRemindersForMeeting).toHaveBeenCalledWith(
      "44444444-4444-4444-8444-444444444444",
    );
    expect(syncMeetingParticipantAccess).not.toHaveBeenCalled();
    expect(applyMeetingShareRules).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("schedules Recall for an auto join event with a meeting link and no location", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");

    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const meetingReturning = vi
      .fn()
      .mockResolvedValue([
        {
          id: "44444444-4444-4444-8444-444444444444",
          ownerUserId: "55555555-5555-4555-8555-555555555555",
        },
      ]);
    const meetingValues = vi.fn().mockReturnValue({ returning: meetingReturning });

    const existingLimit = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    const selectChain = {
      from: vi.fn(() => selectChain),
      innerJoin: vi.fn(() => selectChain),
      limit: existingLimit,
      orderBy: vi.fn(() => selectChain),
      where: vi.fn(() => selectChain),
    };
    select.mockReturnValue(selectChain);
    update.mockReturnValue({ set: updateSet });
    getMeetingBotProfile.mockResolvedValue({
      botName: "Deal Scribe",
      avatarJpegBase64: "custom-avatar",
    });
    scheduleRecallBot.mockResolvedValue({ id: "bot_123" });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
          workspaceDomain: "iosg.vc",
          workspaceName: "IOSG Ventures",
        },
        event: {
          externalEventId: "google_event_123",
          title: "Google Meet",
          startsAt: "2026-06-30T12:00:00.000Z",
          endsAt: null,
          attendeeEmails: [
            "founder@nascent.xyz",
            "alice@iosg.vc",
          ],
          location: null,
          conferenceData: {
            entryPoints: [
              {
                entryPointType: "video",
                uri: "https://meet.google.com/abc-defg-hij",
              },
            ],
          },
        },
      }),
    ).resolves.toEqual({
      action: "scheduled",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      platform: "google_meet",
      recallBotId: "bot_123",
    });

    expect(calendarEventValues).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "11111111-1111-4111-8111-111111111111",
        externalEventId: "google_event_123",
        location: null,
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        teamId: "22222222-2222-4222-8222-222222222222",
      }),
    );
    expect(meetingValues).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        ownerUserId: "55555555-5555-4555-8555-555555555555",
        platform: "google_meet",
        status: "scheduled",
        teamId: "22222222-2222-4222-8222-222222222222",
        title: "IOSG Ventures <> Nascent",
      }),
    );
    expect(syncMeetingParticipantAccess).toHaveBeenCalledWith({
      attendeeEmails: ["founder@nascent.xyz", "alice@iosg.vc"],
      meetingId: "44444444-4444-4444-8444-444444444444",
      ownerUserId: "55555555-5555-4555-8555-555555555555",
      teamId: "22222222-2222-4222-8222-222222222222",
    });
    expect(applyMeetingShareRules).toHaveBeenCalledWith({
      attendeeEmails: ["founder@nascent.xyz", "alice@iosg.vc"],
      meetingId: "44444444-4444-4444-8444-444444444444",
      ownerUserId: "55555555-5555-4555-8555-555555555555",
      teamId: "22222222-2222-4222-8222-222222222222",
      title: "IOSG Ventures <> Nascent",
      workspaceDomain: "iosg.vc",
    });
    expect(scheduleRecallBot).toHaveBeenCalledWith({
      botName: "Deal Scribe",
      avatarJpegBase64: "custom-avatar",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      metadata: {
        botName: "Deal Scribe",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
      startAt: "2026-06-30T12:00:00.000Z",
      webhookUrl: "https://app.example.com/api/recall/webhook",
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: "bot_123",
      }),
    );
  });

  it("creates a local recorder meeting for a past Microsoft Teams repair event", async () => {
    const teamsUrl =
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_example%40thread.v2/0";
    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });
    const meetingReturning = vi.fn().mockResolvedValue([
      {
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        endedAt: new Date("2026-06-30T12:30:00.000Z"),
        id: "44444444-4444-4444-8444-444444444444",
        meetingUrl: teamsUrl,
        ownerUserId: "55555555-5555-4555-8555-555555555555",
        platform: "microsoft_teams",
        recallBotId: null,
        recallRecordingId: null,
        startedAt: new Date("2026-06-30T12:00:00.000Z"),
        status: "missed",
        teamMeetingKey: null,
        title: "Microsoft Teams sync",
        titleSource: "calendar",
      },
    ]);
    const meetingValues = vi.fn().mockReturnValue({ returning: meetingReturning });
    const existingLimit = vi.fn().mockResolvedValue([]);

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    const teamsSelectChain = {
      from: vi.fn(() => teamsSelectChain),
      innerJoin: vi.fn(() => teamsSelectChain),
      limit: existingLimit,
      orderBy: vi.fn(() => teamsSelectChain),
      where: vi.fn(() => teamsSelectChain),
    };
    select.mockReturnValue(teamsSelectChain);

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        repairMode: true,
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_teams",
          title: "Microsoft Teams sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          endsAt: "2026-06-30T12:30:00.000Z",
          meetingUrl: teamsUrl,
        },
      }),
    ).resolves.toEqual({
      action: "scheduled",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: teamsUrl,
      platform: "microsoft_teams",
    });

    expect(meetingValues).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingUrl: teamsUrl,
        platform: "microsoft_teams",
        status: "missed",
        title: "Microsoft Teams sync",
      }),
    );
    expect(syncMeetingParticipantAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: "44444444-4444-4444-8444-444444444444",
      }),
    );
    expect(scheduleRecallBot).not.toHaveBeenCalled();
    expect(scheduleRecallCalendarEventBot).not.toHaveBeenCalled();
  });

  it("reconciles one overlapping SDK fallback recording into a past Microsoft Teams event", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T13:00:00.000Z"));
    const teamsUrl =
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_example%40thread.v2/0";
    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventValues = vi.fn(() => ({
      onConflictDoUpdate: vi.fn(() => ({
        returning: calendarEventReturning,
      })),
    }));
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const manualMeeting = {
      calendarEventId: null,
      endedAt: null,
      id: "44444444-4444-4444-8444-444444444444",
      meetingUrl: null,
      ownerUserId: "55555555-5555-4555-8555-555555555555",
      platform: "in_person",
      recallBotId: null,
      recallRecordingId: null,
      startedAt: new Date("2026-07-01T12:05:00.000Z"),
      status: "recording",
      teamMeetingKey: null,
      title: "Manual recording",
      titleSource: "calendar",
    };

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([manualMeeting]));
    update.mockReturnValue({ set: updateSet });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        repairMode: true,
        connection: {
          autoJoinEnabled: true,
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
        },
        event: {
          endsAt: "2026-07-01T12:30:00.000Z",
          externalEventId: "google_event_teams",
          meetingUrl: teamsUrl,
          startsAt: "2026-07-01T12:00:00.000Z",
          title: "Microsoft Teams sync",
        },
      }),
    ).resolves.toMatchObject({
      action: "scheduled",
      meetingId: manualMeeting.id,
      platform: "microsoft_teams",
    });

    expect(insert).toHaveBeenCalledOnce();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        platform: "microsoft_teams",
        status: "recording",
      }),
    );
  });

  it("recovers a missed Microsoft Teams meeting when the event is rescheduled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T11:00:00.000Z"));
    const teamsUrl =
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_example%40thread.v2/0";
    const calendarEventValues = vi.fn(() => ({
      onConflictDoUpdate: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([
          { id: "33333333-3333-4333-8333-333333333333" },
        ]),
      })),
    }));
    const updateSet = vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }));

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValueOnce(
      selectRows([
        {
          calendarEventId: "33333333-3333-4333-8333-333333333333",
          endedAt: new Date("2026-07-01T10:30:00.000Z"),
          id: "44444444-4444-4444-8444-444444444444",
          meetingUrl: teamsUrl,
          ownerUserId: "55555555-5555-4555-8555-555555555555",
          platform: "microsoft_teams",
          recallBotId: null,
          recallRecordingId: null,
          startedAt: new Date("2026-07-01T10:00:00.000Z"),
          status: "missed",
          teamMeetingKey: "old_key",
          title: "Microsoft Teams sync",
          titleSource: "calendar",
        },
      ]),
    );
    update.mockReturnValue({ set: updateSet });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await autoJoinCalendarEvent({
      connection: {
        autoJoinEnabled: true,
        id: "11111111-1111-4111-8111-111111111111",
        teamId: "22222222-2222-4222-8222-222222222222",
        userId: "55555555-5555-4555-8555-555555555555",
      },
      event: {
        endsAt: "2026-07-01T12:30:00.000Z",
        externalEventId: "google_event_teams",
        meetingUrl: teamsUrl,
        startsAt: "2026-07-01T12:00:00.000Z",
        title: "Microsoft Teams sync",
      },
    });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "microsoft_teams",
        status: "scheduled",
      }),
    );
  });

  it("reloads a Microsoft Teams meeting after a concurrent insert wins", async () => {
    const teamsUrl =
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_example%40thread.v2/0";
    const calendarEventValues = vi.fn(() => ({
      onConflictDoUpdate: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([
          { id: "33333333-3333-4333-8333-333333333333" },
        ]),
      })),
    }));
    const meetingValues = vi.fn().mockRejectedValue({
      code: "23505",
      constraint: "meetings_team_meeting_key_unique",
    });
    const concurrentMeeting = {
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      endedAt: new Date("2999-01-01T12:30:00.000Z"),
      id: "44444444-4444-4444-8444-444444444444",
      meetingUrl: teamsUrl,
      ownerUserId: "55555555-5555-4555-8555-555555555555",
      platform: "microsoft_teams",
      recallBotId: null,
      recallRecordingId: null,
      startedAt: new Date("2999-01-01T12:00:00.000Z"),
      status: "scheduled",
      teamMeetingKey: "concurrent_key",
      title: "Microsoft Teams sync",
      titleSource: "calendar",
    };

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    select
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([concurrentMeeting]));

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          autoJoinEnabled: true,
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
        },
        event: {
          endsAt: "2999-01-01T12:30:00.000Z",
          externalEventId: "google_event_teams",
          meetingUrl: teamsUrl,
          startsAt: "2999-01-01T12:00:00.000Z",
          title: "Microsoft Teams sync",
        },
      }),
    ).resolves.toMatchObject({
      action: "scheduled",
      meetingId: concurrentMeeting.id,
      platform: "microsoft_teams",
    });
  });

  it("accepts an unread canonical Microsoft Teams meeting conflict", async () => {
    const teamsUrl =
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_example%40thread.v2/0";
    const calendarEventValues = vi.fn(() => ({
      onConflictDoUpdate: vi.fn(() => ({
        returning: vi
          .fn()
          .mockResolvedValue([
            { id: "33333333-3333-4333-8333-333333333333" },
          ]),
      })),
    }));
    const meetingValues = vi.fn().mockRejectedValue(
      Object.assign(
        new Error(
          'duplicate key value violates unique constraint "meetings_team_meeting_key_unique"',
        ),
        { code: "23505" },
      ),
    );

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    select.mockReturnValue(selectRows([]));

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          autoJoinEnabled: true,
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
        },
        event: {
          endsAt: "2999-01-01T12:30:00.000Z",
          externalEventId: "google_event_teams",
          meetingUrl: teamsUrl,
          startsAt: "2999-01-01T12:00:00.000Z",
          title: "Microsoft Teams sync",
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingUrl: teamsUrl,
      reason: "already_scheduled",
    });
    expect(syncMeetingParticipantAccess).not.toHaveBeenCalled();
    expect(applyMeetingShareRules).not.toHaveBeenCalled();
  });

  it("does not rewrite a healthy meeting when the Recall event is unchanged", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T04:00:00.000Z"));

    const calendarEventReturning = vi.fn().mockResolvedValue([]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: calendarEventOnConflictDoUpdate,
      }),
    });
    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([
              {
                id: "33333333-3333-4333-8333-333333333333",
                teamMeetingKey:
                  "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
              },
            ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([
              {
                id: "44444444-4444-4444-8444-444444444444",
                ownerUserId: "55555555-5555-4555-8555-555555555555",
                calendarEventId: "33333333-3333-4333-8333-333333333333",
                teamMeetingKey:
                  "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
                title: "Partner sync",
                titleSource: "calendar",
                platform: "google_meet",
                recallBotId: "bot_123",
                recallRecordingId: null,
                meetingUrl: "https://meet.google.com/abc-defg-hij",
                startedAt: new Date("2026-06-30T12:00:00.000Z"),
                endedAt: new Date("2026-06-30T12:30:00.000Z"),
                status: "scheduled",
              },
            ]),
          }),
        }),
      });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
          workspaceDomain: "example.com",
        },
        event: {
          attendeeEmails: ["kemi@mpch.com", "yiping@iosg.vc"],
          externalEventId: "google_event_123",
          recallCalendarEventId: "66666666-6666-4666-8666-666666666666",
          recallCalendarEventBots: [
            {
              botId: "bot_123",
              deduplicationKey:
                "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
            },
            {
              botId: "historical_bot",
              deduplicationKey: "historical-occurrence",
            },
          ],
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          endsAt: "2026-06-30T12:30:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        },
        repairMode: true,
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      reason: "already_scheduled",
    });

    expect(calendarEventOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ setWhere: expect.anything() }),
    );
    expect(syncMeetingParticipantAccess).toHaveBeenCalledWith({
      attendeeEmails: ["kemi@mpch.com", "yiping@iosg.vc"],
      meetingId: "44444444-4444-4444-8444-444444444444",
      ownerUserId: "55555555-5555-4555-8555-555555555555",
      teamId: "22222222-2222-4222-8222-222222222222",
    });
    expect(applyMeetingShareRules).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("creates an in person meeting reminder when a calendar event has a location and no meeting link", async () => {
    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const meetingReturning = vi
      .fn()
      .mockResolvedValue([{ id: "44444444-4444-4444-8444-444444444444" }]);
    const meetingValues = vi.fn().mockReturnValue({ returning: meetingReturning });

    const existingLimit = vi.fn().mockResolvedValue([]);

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          title: "Office visit",
          startsAt: "2026-06-30T12:00:00.000Z",
          endsAt: null,
          attendeeEmails: ["founder@nascent.xyz"],
          location: "IOSG 12F",
        },
      }),
    ).resolves.toEqual({
      action: "scheduled",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      platform: "in_person",
      reminderScheduledFor: "2026-06-30T11:58:00.000Z",
    });

    expect(meetingValues).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "in_person",
        status: "scheduled",
        title: "Office visit",
      }),
    );
    expect(scheduleLocationReminder).toHaveBeenCalledWith({
      meetingId: "44444444-4444-4444-8444-444444444444",
      scheduledFor: new Date("2026-06-30T11:58:00.000Z"),
      userId: "55555555-5555-4555-8555-555555555555",
    });
  });

  it("accepts an unread canonical location meeting conflict", async () => {
    const calendarEventValues = vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: vi
          .fn()
          .mockResolvedValue([
            { id: "33333333-3333-4333-8333-333333333333" },
          ]),
      }),
    });
    const meetingValues = vi.fn().mockRejectedValue(
      Object.assign(
        new Error(
          'duplicate key value violates unique constraint "meetings_team_meeting_key_unique"',
        ),
        { code: "23505" },
      ),
    );

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    select.mockReturnValue(selectRows([]));

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_location",
          title: "Office visit",
          startsAt: "2999-06-30T12:00:00.000Z",
          attendeeEmails: ["founder@nascent.xyz"],
          location: "IOSG 12F",
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      reason: "already_scheduled",
    });
    expect(syncMeetingParticipantAccess).not.toHaveBeenCalled();
    expect(applyMeetingShareRules).not.toHaveBeenCalled();
    expect(scheduleLocationReminder).not.toHaveBeenCalled();
  });

  it("stores the nested Recall Calendar V2 bot id instead of the calendar event id", async () => {
    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const meetingReturning = vi
      .fn()
      .mockResolvedValue([{ id: "44444444-4444-4444-8444-444444444444" }]);
    const meetingValues = vi.fn().mockReturnValue({ returning: meetingReturning });

    const existingLimit = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    scheduleRecallCalendarEventBot.mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      bots: [
        {
          bot_id: "bot_123",
          deduplication_key:
            "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
        },
      ],
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          recallCalendarEventDeduplicationKey: "shared_event_123@example.com",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        action: "scheduled",
        recallBotId: "bot_123",
      }),
    );

    expect(scheduleRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "55555555-5555-4555-8555-555555555555",
      deduplicationKey:
        "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
      botName: "IOSG Old Friend",
      metadata: {
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: "bot_123",
      }),
    );
  });

  it("replaces a stale Recall Calendar V2 bot from another team before scheduling", async () => {
    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const meetingReturning = vi
      .fn()
      .mockResolvedValue([{ id: "44444444-4444-4444-8444-444444444444" }]);
    const meetingValues = vi.fn().mockReturnValue({ returning: meetingReturning });

    const existingLimit = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    deleteRecallCalendarEventBot.mockResolvedValue({});
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "iosg_bot",
          deduplication_key:
            "team:22222222-2222-4222-8222-222222222222:start:2026-07-06T01:30:00.000Z:url:https://zoom.us/j/3456789012",
        },
      ],
    });
    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "66666666-6666-4666-8666-666666666666",
          recallCalendarEventBots: [
            {
              botId: "surf_bot",
              deduplicationKey:
                "team:99999999-9999-4999-8999-999999999999:start:2026-07-06T01:30:00.000Z:url:https://zoom.us/j/3456789012",
            },
          ],
          title: "IOSG Weekly Team Meeting",
          startsAt: "2026-07-06T01:30:00.000Z",
          meetingUrl: "https://zoom.us/j/3456789012",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        action: "scheduled",
        recallBotId: "iosg_bot",
      }),
    );

    expect(deleteRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "66666666-6666-4666-8666-666666666666",
    });
    expect(scheduleRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "66666666-6666-4666-8666-666666666666",
      deduplicationKey:
        "team:22222222-2222-4222-8222-222222222222:start:2026-07-06T01:30:00.000Z:url:https://zoom.us/j/3456789012",
      botName: "IOSG Old Friend",
      metadata: {
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
    });
  });

  it("matches Recall Calendar V2 bot responses by the team dedupe key", async () => {
    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const meetingReturning = vi
      .fn()
      .mockResolvedValue([{ id: "44444444-4444-4444-8444-444444444444" }]);
    const meetingValues = vi.fn().mockReturnValue({ returning: meetingReturning });

    const existingLimit = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "wrong_bot",
          deduplication_key: "shared_event_123@example.com",
        },
        {
          bot_id: "team_bot",
          deduplication_key:
            "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
        },
      ],
    });
    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          recallCalendarEventDeduplicationKey: "shared_event_123@example.com",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        action: "scheduled",
        recallBotId: "team_bot",
      }),
    );
  });

  it("rejects unrelated Recall Calendar V2 bot responses", async () => {
    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const meetingReturning = vi
      .fn()
      .mockResolvedValue([{ id: "44444444-4444-4444-8444-444444444444" }]);
    const meetingValues = vi.fn().mockReturnValue({ returning: meetingReturning });

    const existingLimit = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "wrong_bot",
          deduplication_key: "shared_event_123@example.com",
        },
      ],
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          recallCalendarEventDeduplicationKey: "shared_event_123@example.com",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        },
      }),
    ).rejects.toThrow("Recall bot response missing id");

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        updatedAt: expect.any(Date),
      }),
    );
  });

  it("links shared Recall calendar events to one team meeting and bot", async () => {
    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        recallBotId: "bot_123",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        startedAt: new Date("2026-06-30T12:00:00.000Z"),
        status: "scheduled",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "bot_123",
          deduplication_key:
            "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
        },
      ],
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_456",
          recallCalendarEventId: "66666666-6666-4666-8666-666666666666",
          recallCalendarEventDeduplicationKey: "vendor-event-copy-key",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        },
      }),
    ).resolves.toEqual({
      action: "scheduled",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      platform: "google_meet",
      recallBotId: "bot_123",
    });

    expect(calendarEventValues).toHaveBeenCalledWith(
      expect.objectContaining({
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
      }),
    );
    expect(scheduleRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "66666666-6666-4666-8666-666666666666",
      deduplicationKey:
        "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
      botName: "IOSG Old Friend",
      metadata: {
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: "bot_123",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
      }),
    );
  });

  it("rejects a Recall Calendar V2 bot response without a nested bot id", async () => {
    vi.stubEnv("POSTHOG_API_KEY", "ph_project_key");
    vi.stubEnv("POSTHOG_HOST", "https://us.i.posthog.com");
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const meetingReturning = vi
      .fn()
      .mockResolvedValue([{ id: "44444444-4444-4444-8444-444444444444" }]);
    const meetingValues = vi.fn().mockReturnValue({ returning: meetingReturning });
    const auditValues = vi.fn().mockResolvedValue(undefined);

    const existingLimit = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues })
      .mockReturnValueOnce({ values: auditValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    scheduleRecallCalendarEventBot.mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      bots: [],
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          recallCalendarEventDeduplicationKey: "shared_event_123@example.com",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        },
      }),
    ).rejects.toThrow("Recall bot response missing id");

    expect(consoleError).toHaveBeenCalledWith(
      "calendar_auto_join_failure",
      expect.objectContaining({
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        errorMessage: "Recall bot response missing id",
        meetingId: "44444444-4444-4444-8444-444444444444",
        recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
        reason: "schedule_bot_failed",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://us.i.posthog.com/i/v0/e/",
      expect.objectContaining({
        body: expect.any(String),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const posthogBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(posthogBody).toEqual(
      expect.objectContaining({
        api_key: "ph_project_key",
        distinct_id: "55555555-5555-4555-8555-555555555555",
        event: "calendar_auto_join_failure",
        properties: expect.objectContaining({
          calendarEventId: "33333333-3333-4333-8333-333333333333",
          errorMessage: "Recall bot response missing id",
          meetingId: "44444444-4444-4444-8444-444444444444",
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          reason: "schedule_bot_failed",
          service: "meeting-note",
          teamId: "22222222-2222-4222-8222-222222222222",
        }),
      }),
    );
    expect(auditValues).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "calendar_auto_join_failure",
        actorUserId: "55555555-5555-4555-8555-555555555555",
        metadata: expect.objectContaining({
          calendarEventId: "33333333-3333-4333-8333-333333333333",
          errorMessage: "Recall bot response missing id",
          meetingId: "44444444-4444-4444-8444-444444444444",
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          reason: "schedule_bot_failed",
        }),
        targetId: "44444444-4444-4444-8444-444444444444",
        targetType: "meeting",
        teamId: "22222222-2222-4222-8222-222222222222",
      }),
    );
    consoleError.mockRestore();
  });

  it("deletes a newly scheduled bot when the meeting update fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventValues = vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: calendarEventReturning,
      }),
    });
    const meetingValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([
        {
          id: "44444444-4444-4444-8444-444444444444",
          ownerUserId: "55555555-5555-4555-8555-555555555555",
        },
      ]),
    });
    const auditValues = vi.fn().mockResolvedValue(undefined);
    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues })
      .mockReturnValueOnce({ values: auditValues });
    select.mockReturnValue(selectRows([]));
    update
      .mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({ rowCount: 0 }),
        }),
      })
      .mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });
    scheduleRecallBot.mockResolvedValue({ id: "orphan_candidate" });
    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        },
      }),
    ).rejects.toThrow("Calendar meeting update failed");
    expect(retireScheduledRecallBot).toHaveBeenCalledWith("orphan_candidate");
  });

  it("retries Recall scheduling for an existing calendar meeting without a bot", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");

    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        recallBotId: null,
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    scheduleRecallBot.mockResolvedValue({ id: "bot_123" });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          location: null,
          conferenceData: {
            entryPoints: [
              {
                entryPointType: "video",
                uri: "https://meet.google.com/abc-defg-hij",
              },
            ],
          },
        },
      }),
    ).resolves.toEqual({
      action: "scheduled",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      platform: "google_meet",
      recallBotId: "bot_123",
    });

    expect(scheduleRecallBot).toHaveBeenCalledWith({
      botName: "IOSG Old Friend",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      metadata: {
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
      startAt: "2026-06-30T12:00:00.000Z",
      webhookUrl: "https://app.example.com/api/recall/webhook",
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: "bot_123",
        status: "scheduled",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        startedAt: new Date("2026-06-30T12:00:00.000Z"),
      }),
    );
  });

  it("recovers when a concurrent shared event creates the team meeting first", async () => {
    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const duplicateError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "meetings_team_meeting_key_unique"',
      ),
      { code: "23505" },
    );
    const meetingValues = vi.fn().mockRejectedValue(duplicateError);

    const initialExistingLimit = vi.fn().mockResolvedValue([]);
    const retryExistingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        calendarEventId: "99999999-9999-4999-8999-999999999999",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
        recallBotId: "bot_123",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        startedAt: new Date("2026-06-30T12:00:00.000Z"),
        status: "scheduled",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: initialExistingLimit,
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: retryExistingLimit,
          }),
        }),
      });
    update.mockReturnValue({ set: updateSet });
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "bot_123",
          deduplication_key:
            "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
        },
      ],
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_456",
          recallCalendarEventId: "66666666-6666-4666-8666-666666666666",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        },
      }),
    ).resolves.toEqual({
      action: "scheduled",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      platform: "google_meet",
      recallBotId: "bot_123",
    });
    expect(scheduleRecallCalendarEventBot).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarEventId: "66666666-6666-4666-8666-666666666666",
      }),
    );
  });

  it("accepts a canonical meeting conflict that is not readable by the invitee", async () => {
    const calendarEventValues = vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: vi
          .fn()
          .mockResolvedValue([
            { id: "33333333-3333-4333-8333-333333333333" },
          ]),
      }),
    });
    const duplicateError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "meetings_team_meeting_key_unique"',
      ),
      { code: "23505" },
    );
    const meetingValues = vi.fn().mockRejectedValue(duplicateError);

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    select.mockReturnValue(selectRows([]));

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_456",
          title: "Partner sync",
          startsAt: "2099-06-30T12:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      reason: "already_scheduled",
    });
    expect(syncMeetingParticipantAccess).not.toHaveBeenCalled();
    expect(applyMeetingShareRules).not.toHaveBeenCalled();
    expect(scheduleRecallCalendarEventBot).not.toHaveBeenCalled();
    expect(scheduleRecallBot).not.toHaveBeenCalled();
  });

  it("updates an existing scheduled Recall bot when the calendar link and time change", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");

    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        recallBotId: "bot_123",
        meetingUrl: "https://meet.google.com/old-link",
        startedAt: new Date("2026-06-30T12:00:00.000Z"),
        status: "scheduled",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    updateScheduledRecallBot.mockResolvedValue({ id: "bot_123" });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          title: "Partner sync moved",
          startsAt: "2026-06-30T13:00:00.000Z",
          endsAt: null,
          location: "New room https://meet.google.com/new-link",
        },
      }),
    ).resolves.toEqual({
      action: "updated",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://meet.google.com/new-link",
      platform: "google_meet",
      recallBotId: "bot_123",
    });

    expect(updateScheduledRecallBot).toHaveBeenCalledWith({
      botId: "bot_123",
      meetingUrl: "https://meet.google.com/new-link",
      startAt: "2026-06-30T13:00:00.000Z",
      metadata: {
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingUrl: "https://meet.google.com/new-link",
        recallRecordingId: null,
        startedAt: new Date("2026-06-30T13:00:00.000Z"),
        title: "Partner sync moved",
        updatedAt: expect.any(Date),
      }),
    );
  });

  it("refreshes an unchanged scheduled bot when its vendor config is stale", async () => {
    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        recallBotId: "bot_123",
        meetingUrl: "https://zoom.us/j/6898482622",
        startedAt: new Date("2099-07-17T06:00:00.000Z"),
        status: "scheduled",
        title: "IOSG Ventures - IC Meeting",
        titleSource: "calendar",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "bot_123",
          deduplication_key:
            "team:22222222-2222-4222-8222-222222222222:start:2099-07-17T06:00:00.000Z:url:https://zoom.us/j/6898482622",
        },
      ],
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "66666666-6666-4666-8666-666666666666",
          recallCalendarEventBots: [
            {
              botId: "bot_123",
              deduplicationKey:
                "team:22222222-2222-4222-8222-222222222222:start:2099-07-17T06:00:00.000Z:url:https://zoom.us/j/6898482622",
            },
          ],
          title: "IOSG Ventures - IC Meeting",
          startsAt: "2099-07-17T06:00:00.000Z",
          meetingUrl: "https://zoom.us/j/6898482622",
        },
        ...({ forceBotConfigRefresh: true } as Record<string, unknown>),
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        action: "scheduled",
        recallBotId: "bot_123",
      }),
    );

    expect(scheduleRecallCalendarEventBot).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarEventId: "66666666-6666-4666-8666-666666666666",
      }),
    );
  });

  it("reschedules a failed future meeting when the stored direct bot was deleted", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");

    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        recallBotId: "deleted_bot",
        meetingUrl: "https://zoom.us/j/1234567890",
        startedAt: new Date("2099-07-08T17:00:00.000Z"),
        status: "failed",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    updateScheduledRecallBot.mockRejectedValue(
      new Error("Recall bot update failed with 404 Not Found"),
    );
    scheduleRecallBot.mockResolvedValue({ id: "replacement_bot" });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          title: "Anchorage <> IOSG",
          startsAt: "2099-07-08T17:00:00.000Z",
          endsAt: "2099-07-08T17:30:00.000Z",
          meetingUrl: "https://zoom.us/j/1234567890",
        },
      }),
    ).resolves.toEqual({
      action: "scheduled",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://zoom.us/j/1234567890",
      platform: "zoom",
      recallBotId: "replacement_bot",
    });

    expect(scheduleRecallBot).toHaveBeenCalledWith({
      botName: "IOSG Old Friend",
      meetingUrl: "https://zoom.us/j/1234567890",
      metadata: {
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
      startAt: "2099-07-08T17:00:00.000Z",
      webhookUrl: "https://app.example.com/api/recall/webhook",
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: "replacement_bot",
        recallRecordingId: null,
        status: "scheduled",
      }),
    );
  });

  it("resets a failed future meeting when replacement bot scheduling fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");

    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        title: "Anchorage <> IOSG",
        titleSource: "calendar",
        recallBotId: "deleted_bot",
        meetingUrl: "https://zoom.us/j/1234567890",
        startedAt: new Date("2099-07-08T17:00:00.000Z"),
        status: "failed",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    updateScheduledRecallBot.mockRejectedValue(
      new Error("Recall bot update failed with 404 Not Found"),
    );
    scheduleRecallBot.mockRejectedValue(
      new Error("Recall bot scheduling failed with 402 Payment Required"),
    );

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          title: "Anchorage <> IOSG",
          startsAt: "2099-07-08T17:00:00.000Z",
          endsAt: "2099-07-08T17:30:00.000Z",
          meetingUrl: "https://zoom.us/j/1234567890",
        },
      }),
    ).rejects.toThrow("Recall bot scheduling failed with 402 Payment Required");

    expect(updateSet).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recallBotId: null,
        recallRecordingId: null,
        status: "scheduled",
      }),
    );
  });

  it("keeps a manually renamed meeting title when the calendar event changes", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");

    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        title: "Custom diligence call",
        titleSource: "manual",
        recallBotId: "bot_123",
        meetingUrl: "https://meet.google.com/old-link",
        startedAt: new Date("2026-06-30T12:00:00.000Z"),
        status: "scheduled",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    updateScheduledRecallBot.mockResolvedValue({ id: "bot_123" });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          title: "Calendar renamed title",
          startsAt: "2026-06-30T13:00:00.000Z",
          endsAt: null,
          location: "New room https://meet.google.com/new-link",
        },
      }),
    ).resolves.toEqual({
      action: "updated",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://meet.google.com/new-link",
      platform: "google_meet",
      recallBotId: "bot_123",
    });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingUrl: "https://meet.google.com/new-link",
        startedAt: new Date("2026-06-30T13:00:00.000Z"),
        title: "Custom diligence call",
      }),
    );
  });

  it("replaces an existing Recall Calendar V2 bot when the event time changes", async () => {
    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:00:00.000Z:url:https://zoom.us/j/2345678901",
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:30:00.000Z:url:https://zoom.us/j/2345678901",
        recallBotId: "old_bot",
        meetingUrl: "https://zoom.us/j/2345678901",
        startedAt: new Date("2026-06-30T13:30:00.000Z"),
        status: "scheduled",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    deleteRecallCalendarEventBot.mockResolvedValue({});
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "new_bot",
          deduplication_key:
            "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:00:00.000Z:url:https://zoom.us/j/2345678901",
        },
      ],
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          title: "Investment strategy moved",
          startsAt: "2026-06-30T13:00:00.000Z",
          endsAt: null,
          meetingUrl: "https://zoom.us/j/2345678901",
        },
      }),
    ).resolves.toEqual({
      action: "updated",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://zoom.us/j/2345678901",
      platform: "zoom",
      recallBotId: "new_bot",
    });

    expect(deleteRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "55555555-5555-4555-8555-555555555555",
    });
    expect(scheduleRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "55555555-5555-4555-8555-555555555555",
      deduplicationKey:
        "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:00:00.000Z:url:https://zoom.us/j/2345678901",
      botName: "IOSG Old Friend",
      metadata: {
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: "new_bot",
        startedAt: new Date("2026-06-30T13:00:00.000Z"),
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:00:00.000Z:url:https://zoom.us/j/2345678901",
      }),
    );
  });

  it("deletes a direct scheduled bot before replacing it with a Recall Calendar V2 bot", async () => {
    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:00:00.000Z:url:https://zoom.us/j/2345678901",
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:00:00.000Z:url:https://zoom.us/j/2345678901",
        recallBotId: "direct_bot",
        meetingUrl: "https://zoom.us/j/2345678901",
        startedAt: new Date("2026-06-30T13:00:00.000Z"),
        status: "scheduled",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    deleteScheduledRecallBot.mockResolvedValue({});
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "calendar_bot",
          deduplication_key:
            "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:00:00.000Z:url:https://zoom.us/j/2345678901",
        },
      ],
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await autoJoinCalendarEvent({
      connection: {
        id: "11111111-1111-4111-8111-111111111111",
        teamId: "22222222-2222-4222-8222-222222222222",
        userId: "55555555-5555-4555-8555-555555555555",
        autoJoinEnabled: true,
      },
      event: {
        externalEventId: "google_event_123",
        recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
        recallCalendarEventBots: [],
        title: "Investment strategy",
        startsAt: "2026-06-30T13:00:00.000Z",
        endsAt: null,
        meetingUrl: "https://zoom.us/j/2345678901",
      },
    });

    expect(deleteScheduledRecallBot).toHaveBeenCalledWith({
      botId: "direct_bot",
    });
    expect(deleteRecallCalendarEventBot).not.toHaveBeenCalled();
  });

  it.each(["missed", "recording"] as const)(
    "reschedules a %s Recall Calendar V2 meeting when the event moves to the future",
    async (status) => {
    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2099-07-02T01:15:00.000Z:url:https://meet.google.com/abc-defg-hij",
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2099-06-30T01:15:00.000Z:url:https://meet.google.com/abc-defg-hij",
        recallBotId: "old_bot",
        recallRecordingId: null,
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        startedAt: new Date("2099-06-30T01:15:00.000Z"),
        status,
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    deleteRecallCalendarEventBot.mockResolvedValue({});
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "new_bot",
          deduplication_key:
            "team:22222222-2222-4222-8222-222222222222:start:2099-07-02T01:15:00.000Z:url:https://meet.google.com/abc-defg-hij",
        },
      ],
    });
    retrieveRecallBot.mockResolvedValue({
      recordings: [],
      status_changes: [{ code: "in_waiting_room" }],
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          title: "IOSG <> Eggs",
          startsAt: "2099-07-02T01:15:00.000Z",
          endsAt: "2099-07-02T02:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        },
      }),
    ).resolves.toEqual({
      action: "updated",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      platform: "google_meet",
      recallBotId: "new_bot",
    });

    expect(deleteRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "55555555-5555-4555-8555-555555555555",
    });
    expect(scheduleRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "55555555-5555-4555-8555-555555555555",
      deduplicationKey:
        "team:22222222-2222-4222-8222-222222222222:start:2099-07-02T01:15:00.000Z:url:https://meet.google.com/abc-defg-hij",
      botName: "IOSG Old Friend",
      metadata: {
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: "new_bot",
        startedAt: new Date("2099-07-02T01:15:00.000Z"),
        status: "scheduled",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2099-07-02T01:15:00.000Z:url:https://meet.google.com/abc-defg-hij",
      }),
    );
    if (status === "recording") {
      expect(retrieveRecallBot).toHaveBeenCalledWith("old_bot");
      expect(retireScheduledRecallBot).toHaveBeenCalledWith("old_bot");
    } else {
      expect(retrieveRecallBot).not.toHaveBeenCalled();
      expect(retireScheduledRecallBot).not.toHaveBeenCalled();
    }
    },
  );

  it("does not replace a bot that has entered an active recording", async () => {
    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2099-07-02T01:15:00.000Z:url:https://meet.google.com/abc-defg-hij",
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });
    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        ownerUserId: "55555555-5555-4555-8555-555555555555",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2099-06-30T01:15:00.000Z:url:https://meet.google.com/abc-defg-hij",
        title: "Partner sync",
        titleSource: "calendar",
        platform: "google_meet",
        recallBotId: "recording_bot",
        recallRecordingId: null,
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        startedAt: new Date("2099-06-30T01:15:00.000Z"),
        endedAt: new Date("2099-06-30T02:00:00.000Z"),
        status: "recording",
      },
    ]);

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    retrieveRecallBot.mockResolvedValue({
      recordings: [],
      status_changes: [
        { code: "joining_call" },
        { code: "in_call_recording" },
      ],
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          title: "Partner sync",
          startsAt: "2099-07-02T01:15:00.000Z",
          endsAt: "2099-07-02T02:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      reason: "already_scheduled",
    });

    expect(retrieveRecallBot).toHaveBeenCalledWith("recording_bot");
    expect(deleteRecallCalendarEventBot).not.toHaveBeenCalled();
    expect(scheduleRecallCalendarEventBot).not.toHaveBeenCalled();
    expect(retireScheduledRecallBot).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps a recorded meeting and creates a new occurrence when its calendar event moves", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T17:05:00.000Z"));
    randomUUID.mockReturnValue(
      "77777777-7777-4777-8777-777777777777",
    );

    const calendarEventReturning = vi.fn().mockResolvedValue([]);
    const calendarEventLimit = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-07-22T17:00:00.000Z:url:https://zoom.us/j/2345678901",
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });
    const meetingReturning = vi.fn().mockResolvedValue([
      {
        id: "77777777-7777-4777-8777-777777777777",
        ownerUserId: "55555555-5555-4555-8555-555555555555",
      },
    ]);
    const meetingValues = vi.fn().mockReturnValue({ returning: meetingReturning });
    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        ownerUserId: "55555555-5555-4555-8555-555555555555",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-07-15T19:15:00.000Z:url:https://zoom.us/j/2345678901",
        title: "Partner sync Pending",
        titleSource: "calendar",
        platform: "zoom",
        recallBotId: "old_bot",
        recallRecordingId: "old_recording",
        meetingUrl: "https://zoom.us/j/2345678901",
        startedAt: new Date("2026-07-15T19:15:00.000Z"),
        endedAt: new Date("2026-07-15T20:00:00.000Z"),
        status: "ready",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: calendarEventLimit,
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: existingLimit,
          }),
        }),
      });
    update.mockReturnValue({ set: updateSet });
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "new_bot",
          deduplication_key:
            "team:22222222-2222-4222-8222-222222222222:start:2026-07-22T17:00:00.000Z:url:https://zoom.us/j/2345678901",
        },
      ],
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
          workspaceDomain: "iosg.vc",
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "66666666-6666-4666-8666-666666666666",
          recallCalendarEventBots: [],
          title: "Partner sync",
          startsAt: "2026-07-22T17:00:00.000Z",
          endsAt: "2026-07-22T17:45:00.000Z",
          meetingUrl: "https://zoom.us/j/2345678901",
          attendeeEmails: ["guest@example.com", "owner@iosg.vc"],
        },
      }),
    ).resolves.toEqual({
      action: "scheduled",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "77777777-7777-4777-8777-777777777777",
      meetingUrl: "https://zoom.us/j/2345678901",
      platform: "zoom",
      recallBotId: "new_bot",
    });

    expect(meetingValues).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        startedAt: new Date("2026-07-22T17:00:00.000Z"),
        status: "scheduled",
        title: "Partner sync",
      }),
    );
    expect(updateSet).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        recallBotId: "new_bot",
        startedAt: new Date("2026-07-22T17:00:00.000Z"),
        status: "scheduled",
      }),
    );
    expect(updateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ calendarEventId: null }),
    );
    expect(scheduleRecallCalendarEventBot).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarEventId: "66666666-6666-4666-8666-666666666666",
        metadata: {
          calendarEventId: "33333333-3333-4333-8333-333333333333",
          meetingId: "77777777-7777-4777-8777-777777777777",
        },
      }),
    );
    expect(syncMeetingParticipantAccess).toHaveBeenCalledWith({
      attendeeEmails: ["guest@example.com", "owner@iosg.vc"],
      meetingId: "77777777-7777-4777-8777-777777777777",
      ownerUserId: "55555555-5555-4555-8555-555555555555",
      teamId: "22222222-2222-4222-8222-222222222222",
    });
    expect(applyMeetingShareRules).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: "77777777-7777-4777-8777-777777777777",
        title: "Partner sync",
      }),
    );
    expect(deleteRecallCalendarEventBot).not.toHaveBeenCalled();
    expect(deleteScheduledRecallBot).not.toHaveBeenCalled();
  });

  it("leaves the recorded meeting linked when replacement creation fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T17:05:00.000Z"));

    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-07-22T17:00:00.000Z:url:https://zoom.us/j/2345678901",
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });
    const meetingValues = vi.fn().mockRejectedValue(
      new Error("database unavailable"),
    );
    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        ownerUserId: "55555555-5555-4555-8555-555555555555",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-07-15T19:15:00.000Z:url:https://zoom.us/j/2345678901",
        title: "Partner sync Pending",
        titleSource: "calendar",
        platform: "zoom",
        recallBotId: "old_bot",
        recallRecordingId: "old_recording",
        meetingUrl: "https://zoom.us/j/2345678901",
        startedAt: new Date("2026-07-15T19:15:00.000Z"),
        endedAt: new Date("2026-07-15T20:00:00.000Z"),
        status: "ready",
      },
    ]);

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({ limit: existingLimit }),
      }),
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          title: "Partner sync",
          startsAt: "2026-07-22T17:00:00.000Z",
          endsAt: "2026-07-22T17:45:00.000Z",
          meetingUrl: "https://zoom.us/j/2345678901",
        },
      }),
    ).rejects.toThrow("database unavailable");

    expect(update).not.toHaveBeenCalled();
    expect(scheduleRecallBot).not.toHaveBeenCalled();
    expect(scheduleRecallCalendarEventBot).not.toHaveBeenCalled();
  });

  it("selects the current occurrence when one calendar event has meeting history", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T16:00:00.000Z"));

    const currentTeamMeetingKey =
      "team:22222222-2222-4222-8222-222222222222:start:2026-07-22T17:00:00.000Z:url:https://zoom.us/j/2345678901";
    const calendarEventReturning = vi.fn().mockResolvedValue([]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });
    const calendarEventLimit = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey: currentTeamMeetingKey,
      },
    ]);
    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        ownerUserId: "55555555-5555-4555-8555-555555555555",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-07-15T19:15:00.000Z:url:https://zoom.us/j/2345678901",
        title: "Partner sync Pending",
        titleSource: "calendar",
        platform: "zoom",
        recallBotId: "old_bot",
        recallRecordingId: "old_recording",
        meetingUrl: "https://zoom.us/j/2345678901",
        startedAt: new Date("2026-07-15T19:15:00.000Z"),
        endedAt: new Date("2026-07-15T20:00:00.000Z"),
        status: "ready",
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        ownerUserId: "55555555-5555-4555-8555-555555555555",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey: currentTeamMeetingKey,
        title: "Partner sync",
        titleSource: "calendar",
        platform: "zoom",
        recallBotId: "new_bot",
        recallRecordingId: null,
        meetingUrl: "https://zoom.us/j/2345678901",
        startedAt: new Date("2026-07-22T17:00:00.000Z"),
        endedAt: new Date("2026-07-22T17:45:00.000Z"),
        status: "scheduled",
      },
    ]);

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({ limit: calendarEventLimit }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({ limit: existingLimit }),
        }),
      });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          title: "Partner sync",
          startsAt: "2026-07-22T17:00:00.000Z",
          endsAt: "2026-07-22T17:45:00.000Z",
          meetingUrl: "https://zoom.us/j/2345678901",
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "77777777-7777-4777-8777-777777777777",
      meetingUrl: "https://zoom.us/j/2345678901",
      reason: "already_scheduled",
    });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(scheduleRecallBot).not.toHaveBeenCalled();
  });

  it("updates one meeting when another invitee calendar syncs the same rescheduled event", async () => {
    const currentTeamMeetingKey =
      "team:22222222-2222-4222-8222-222222222222:start:2099-07-30T15:30:00.000Z:url:https://zoom.us/j/2345678901";
    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey: currentTeamMeetingKey,
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });
    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        ownerUserId: "55555555-5555-4555-8555-555555555555",
        calendarEventId: "77777777-7777-4777-8777-777777777777",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2099-07-29T17:00:00.000Z:url:https://zoom.us/j/2345678901",
        title: "Partner sync",
        titleSource: "calendar",
        platform: "zoom",
        recallBotId: "old_bot",
        recallRecordingId: null,
        meetingUrl: "https://zoom.us/j/2345678901",
        startedAt: new Date("2099-07-29T17:00:00.000Z"),
        endedAt: new Date("2099-07-29T17:30:00.000Z"),
        status: "scheduled",
      },
    ]);
    const existingWhere = vi.fn().mockReturnValue({
      limit: existingLimit,
    });
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: existingWhere,
      }),
    });
    update.mockReturnValue({ set: updateSet });
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "new_bot",
          deduplication_key: currentTeamMeetingKey,
        },
      ],
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "66666666-6666-4666-8666-666666666666",
          recallCalendarEventBots: [],
          title: "Partner sync",
          startsAt: "2099-07-30T15:30:00.000Z",
          endsAt: "2099-07-30T16:00:00.000Z",
          meetingUrl: "https://zoom.us/j/2345678901",
        },
      }),
    ).resolves.toEqual({
      action: "updated",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://zoom.us/j/2345678901",
      platform: "zoom",
      recallBotId: "new_bot",
    });

    const whereQuery = new PgDialect().sqlToQuery(
      existingWhere.mock.calls[0]?.[0],
    );
    expect(whereQuery.sql).toContain(
      "sibling_calendar_event.external_event_id",
    );
    expect(whereQuery.params).toContain("google_event_123");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        recallBotId: "new_bot",
        startedAt: new Date("2099-07-30T15:30:00.000Z"),
        teamMeetingKey: currentTeamMeetingKey,
      }),
    );
  });

  it("keeps one bot owner when another invitee calendar syncs the current event", async () => {
    const currentTeamMeetingKey =
      "team:22222222-2222-4222-8222-222222222222:start:2099-07-30T15:30:00.000Z:url:https://zoom.us/j/2345678901";
    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey: currentTeamMeetingKey,
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });
    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        ownerUserId: "55555555-5555-4555-8555-555555555555",
        calendarEventId: "77777777-7777-4777-8777-777777777777",
        linkedCalendarEventMeetingUrl: "https://zoom.us/j/2345678901",
        linkedCalendarEventTeamMeetingKey: currentTeamMeetingKey,
        teamMeetingKey: currentTeamMeetingKey,
        title: "Partner sync",
        titleSource: "calendar",
        platform: "zoom",
        recallBotId: "canonical_bot",
        recallRecordingId: null,
        meetingUrl: "https://zoom.us/j/2345678901",
        startedAt: new Date("2099-07-30T15:30:00.000Z"),
        endedAt: new Date("2099-07-30T16:00:00.000Z"),
        status: "scheduled",
      },
    ]);

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "66666666-6666-4666-8666-666666666666",
          recallCalendarEventBots: [],
          title: "Partner sync",
          startsAt: "2099-07-30T15:30:00.000Z",
          endsAt: "2099-07-30T16:00:00.000Z",
          meetingUrl: "https://zoom.us/j/2345678901",
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://zoom.us/j/2345678901",
      reason: "already_scheduled",
    });

    expect(deleteScheduledRecallBot).not.toHaveBeenCalled();
    expect(deleteRecallCalendarEventBot).not.toHaveBeenCalled();
    expect(scheduleRecallCalendarEventBot).not.toHaveBeenCalled();
    expect(syncMeetingParticipantAccess).not.toHaveBeenCalled();
    expect(applyMeetingShareRules).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();

    getDatabaseClaimsJson.mockReturnValue(null);
    insert.mockReturnValueOnce({ values: calendarEventValues });

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "66666666-6666-4666-8666-666666666666",
          recallCalendarEventBots: [],
          title: "Partner sync",
          startsAt: "2099-07-30T15:30:00.000Z",
          endsAt: "2099-07-30T16:00:00.000Z",
          meetingUrl: "https://zoom.us/j/2345678901",
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://zoom.us/j/2345678901",
      reason: "already_scheduled",
    });
    expect(syncMeetingParticipantAccess).toHaveBeenCalledWith({
      attendeeEmails: [],
      meetingId: "44444444-4444-4444-8444-444444444444",
      ownerUserId: "55555555-5555-4555-8555-555555555555",
      teamId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("retries a failed active Recall Calendar V2 meeting on repair sync", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-07-02T01:30:00.000Z"));

    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2099-07-02T01:15:00.000Z:url:https://meet.google.com/abc-defg-hij",
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2099-07-02T01:15:00.000Z:url:https://meet.google.com/abc-defg-hij",
        recallBotId: "old_deleted_bot",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        startedAt: new Date("2099-07-02T01:15:00.000Z"),
        status: "failed",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    deleteScheduledRecallBot.mockResolvedValue({});
    deleteRecallCalendarEventBot.mockResolvedValue({});
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "new_bot",
          deduplication_key:
            "team:22222222-2222-4222-8222-222222222222:start:2099-07-02T01:15:00.000Z:url:https://meet.google.com/abc-defg-hij",
        },
      ],
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          recallCalendarEventBots: [
            {
              botId: "other_workspace_bot",
              deduplicationKey: "other-workspace-key",
            },
          ],
          title: "IOSG <> Eggs",
          startsAt: "2099-07-02T01:15:00.000Z",
          endsAt: "2099-07-02T02:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        },
      }),
    ).resolves.toEqual({
      action: "scheduled",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      platform: "google_meet",
      recallBotId: "new_bot",
    });

    expect(deleteScheduledRecallBot).toHaveBeenCalledWith({
      botId: "old_deleted_bot",
    });
    expect(deleteRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "55555555-5555-4555-8555-555555555555",
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: "new_bot",
        recallRecordingId: null,
        status: "scheduled",
      }),
    );
  });

  it("marks an external-declined calendar meeting as cancelled", async () => {
    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey: null,
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey: null,
        recallBotId: "stale_bot",
        meetingUrl: "https://zoom.us/j/2345678901",
        startedAt: new Date("2026-07-01T20:00:00.000Z"),
        status: "failed",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    deleteRecallCalendarEventBot.mockResolvedValue({});

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
          workspaceDomain: "iosg.vc",
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          title: "Salt <> IOSG",
          startsAt: "2026-07-01T20:00:00.000Z",
          endsAt: "2026-07-01T20:30:00.000Z",
          meetingUrl: "https://zoom.us/j/2345678901",
          attendees: [
            {
              email: "partner.test@thesaltfund.com",
              responseStatus: "declined",
            },
            {
              email: "test@iosg.vc",
              responseStatus: "accepted",
            },
          ],
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      reason: "missing_meeting_link",
    });

    expect(deleteRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "55555555-5555-4555-8555-555555555555",
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingUrl: null,
        recallBotId: null,
        status: "cancelled",
        teamMeetingKey: null,
        title: "Salt <> IOSG",
      }),
    );
    expect(scheduleRecallCalendarEventBot).not.toHaveBeenCalled();
    expect(scheduleRecallBot).not.toHaveBeenCalled();
  });

  it("marks a past failed calendar meeting as missed during repair", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T01:00:00.000Z"));

    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-07-01T20:30:00.000Z:url:https://meet.google.com/abc-defg-hij",
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        ownerUserId: "55555555-5555-4555-8555-555555555555",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-07-01T20:30:00.000Z:url:https://meet.google.com/abc-defg-hij",
        recallBotId: "stale_bot",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        startedAt: new Date("2026-07-01T20:30:00.000Z"),
        status: "failed",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        repairMode: true,
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
          workspaceDomain: "iosg.vc",
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          title: "Test User and External Guest",
          startsAt: "2026-07-01T20:30:00.000Z",
          endsAt: "2026-07-01T21:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
          attendees: [
            {
              email: "guest.test@gmail.com",
              responseStatus: "accepted",
            },
            {
              email: "test@iosg.vc",
              responseStatus: "accepted",
            },
          ],
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      reason: "already_scheduled",
    });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: "stale_bot",
        status: "missed",
        title: "Test User and External Guest",
      }),
    );
    expect(applyMeetingShareRules).toHaveBeenCalledWith({
      attendeeEmails: ["guest.test@gmail.com", "test@iosg.vc"],
      meetingId: "44444444-4444-4444-8444-444444444444",
      ownerUserId: "55555555-5555-4555-8555-555555555555",
      teamId: "22222222-2222-4222-8222-222222222222",
      title: "Test User and External Guest",
      workspaceDomain: "iosg.vc",
    });
    expect(scheduleRecallCalendarEventBot).not.toHaveBeenCalled();
    expect(scheduleRecallBot).not.toHaveBeenCalled();
  });

  it("does not reschedule or fail an existing past meeting that already has transcript work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T21:12:00.000Z"));

    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-07-06T17:00:00.000Z:url:https://zoom.us/j/85921730294",
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-07-06T17:00:00.000Z:url:https://zoom.us/j/85921730294",
        recallBotId: null,
        meetingUrl: "https://zoom.us/j/85921730294",
        startedAt: new Date("2026-07-06T17:00:00.000Z"),
        status: "ready",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    scheduleRecallBot.mockRejectedValue(
      new Error("Recall bot scheduling failed with 400 Bad Request"),
    );

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        repairMode: true,
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
          workspaceDomain: "iosg.vc",
        },
        event: {
          externalEventId: "google_event_123",
          title: "IOSG <> Ninemind",
          startsAt: "2026-07-06T17:00:00.000Z",
          endsAt: "2026-07-06T17:30:00.000Z",
          meetingUrl: "https://zoom.us/j/85921730294",
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://zoom.us/j/85921730294",
      reason: "already_scheduled",
    });

    expect(scheduleRecallBot).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
      }),
    );
  });

  it("does not create a new meeting for a past repair event", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T01:00:00.000Z"));

    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-07-01T20:30:00.000Z:url:https://meet.google.com/abc-defg-hij",
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });
    const existingLimit = vi.fn().mockResolvedValue([]);

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        repairMode: true,
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
          workspaceDomain: "iosg.vc",
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          title: "Past partner call",
          startsAt: "2026-07-01T20:30:00.000Z",
          endsAt: "2026-07-01T21:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      reason: "already_scheduled",
    });

    expect(scheduleRecallCalendarEventBot).not.toHaveBeenCalled();
    expect(scheduleRecallBot).not.toHaveBeenCalled();
  });

  it("rejects a Recall Calendar V2 replacement response without the new bot id", async () => {
    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:00:00.000Z:url:https://zoom.us/j/2345678901",
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:30:00.000Z:url:https://zoom.us/j/2345678901",
        recallBotId: "old_bot",
        meetingUrl: "https://zoom.us/j/2345678901",
        startedAt: new Date("2026-06-30T13:30:00.000Z"),
        status: "scheduled",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    deleteRecallCalendarEventBot.mockResolvedValue({});
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "old_bot",
          deduplication_key:
            "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:30:00.000Z:url:https://zoom.us/j/2345678901",
        },
      ],
    });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          title: "Investment strategy moved",
          startsAt: "2026-06-30T13:00:00.000Z",
          endsAt: null,
          meetingUrl: "https://zoom.us/j/2345678901",
        },
      }),
    ).rejects.toThrow("Recall bot response missing id");

    expect(deleteRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "55555555-5555-4555-8555-555555555555",
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        updatedAt: expect.any(Date),
      }),
    );
  });

  it("cancels an existing scheduled Recall bot when the calendar event loses its meeting link", async () => {
    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        recallBotId: "bot_123",
        meetingUrl: "https://meet.google.com/old-link",
        startedAt: new Date("2026-06-30T12:00:00.000Z"),
        status: "scheduled",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    deleteScheduledRecallBot.mockResolvedValue({});

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          title: "Partner sync",
          startsAt: "2026-06-30T13:00:00.000Z",
          endsAt: null,
          location: null,
          description: null,
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      reason: "missing_meeting_link",
    });

    expect(deleteScheduledRecallBot).toHaveBeenCalledWith({ botId: "bot_123" });
    expect(scheduleRecallBot).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: null,
        meetingUrl: null,
        startedAt: new Date("2026-06-30T13:00:00.000Z"),
        status: "failed",
        title: "Partner sync",
        updatedAt: expect.any(Date),
      }),
    );
  });

  it("marks a deleted scheduled calendar meeting as cancelled", async () => {
    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        recallBotId: null,
        meetingUrl: "https://meet.google.com/old-link",
        startedAt: new Date("2026-06-30T12:00:00.000Z"),
        status: "scheduled",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          title: "Partner sync",
          startsAt: "2026-06-30T13:00:00.000Z",
          endsAt: null,
          isDeleted: true,
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      reason: "missing_meeting_link",
    });

    expect(deleteRecallCalendarEventBot).not.toHaveBeenCalled();
    expect(deleteScheduledRecallBot).not.toHaveBeenCalled();
    expect(calendarEventValues).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingUrl: null,
        teamMeetingKey: null,
      }),
    );
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: null,
        meetingUrl: null,
        teamMeetingKey: null,
        status: "cancelled",
        title: "Partner sync",
        updatedAt: expect.any(Date),
      }),
    );
  });

  it("cancels a deleted scheduled calendar meeting even when the deleted event still has a location", async () => {
    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "44444444-4444-4444-8444-444444444444",
          recallBotId: "bot_123",
          meetingUrl: "https://zoom.us/j/2345678901",
          startedAt: new Date("2026-06-30T12:00:00.000Z"),
          status: "scheduled",
        },
      ])
      .mockResolvedValueOnce([]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          title: "Test",
          startsAt: "2026-06-30T13:00:00.000Z",
          endsAt: null,
          isDeleted: true,
          location: "https://zoom.us/j/2345678901",
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      reason: "missing_meeting_link",
    });

    expect(deleteRecallCalendarEventBot).not.toHaveBeenCalled();
    expect(deleteScheduledRecallBot).not.toHaveBeenCalled();
    expect(calendarEventValues).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingUrl: null,
        teamMeetingKey: null,
      }),
    );
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: null,
        meetingUrl: null,
        teamMeetingKey: null,
        status: "cancelled",
        title: "Test",
        updatedAt: expect.any(Date),
      }),
    );
  });

  it("keeps a shared team meeting scheduled when one Recall calendar event is deleted", async () => {
    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
        recallBotId: "bot_123",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        startedAt: new Date("2026-06-30T12:00:00.000Z"),
        status: "scheduled",
      },
    ]);
    const activeSiblingLimit = vi.fn().mockResolvedValue([
      {
        id: "77777777-7777-4777-8777-777777777777",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
      },
    ]);

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: existingLimit,
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: activeSiblingLimit,
          }),
        }),
      });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          isDeleted: true,
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      reason: "shared_meeting_still_scheduled",
    });

    expect(deleteRecallCalendarEventBot).not.toHaveBeenCalled();
    expect(deleteScheduledRecallBot).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("cancels a shared team meeting when remaining sibling events are unsupported", async () => {
    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
        recallBotId: "bot_123",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        startedAt: new Date("2026-06-30T12:00:00.000Z"),
        status: "scheduled",
      },
    ]);
    const unsupportedSiblingLimit = vi.fn().mockResolvedValue([
      {
        id: "77777777-7777-4777-8777-777777777777",
        meetingUrl: "https://example.com/not-a-supported-meeting",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: existingLimit,
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: unsupportedSiblingLimit,
          }),
        }),
      });
    update.mockReturnValue({ set: updateSet });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          meetingUrl: "https://example.com/not-a-supported-meeting",
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://example.com/not-a-supported-meeting",
      reason: "unsupported_meeting_link",
    });

    expect(deleteRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "55555555-5555-4555-8555-555555555555",
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: null,
        teamMeetingKey: null,
        status: "failed",
      }),
    );
  });
});
