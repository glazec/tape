import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/provider-credit", () => ({
  assertWorkspaceHasProviderCredit: vi.fn(),
}));

const {
  assertCanCreateMeetings,
  getMeetingManagerCondition,
  getWorkspace,
  select,
  update,
} = vi.hoisted(() => ({
  assertCanCreateMeetings: vi.fn(),
  getMeetingManagerCondition: vi.fn(() => ({ queryChunks: [] })),
  getWorkspace: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/db/client", () => ({ db: { select, update } }));
vi.mock("@/lib/workspace", () => ({
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));
vi.mock("@/lib/meeting-write-policy", () => ({ getMeetingManagerCondition }));

import {
  isMeetingBotRecoveryEligible,
  isMeetingRecordingResumeEligible,
  isRecentFailedMeetingBotRecoveryEligible,
} from "@/lib/meeting-bot-recovery-policy";

describe("meeting bot recovery policy", () => {
  const now = new Date("2026-07-22T12:10:00.000Z");

  it("offers recovery for a recent empty remote meeting", () => {
    expect(
      isMeetingBotRecoveryEligible({
        canManage: true,
        endedAt: "2026-07-22T12:08:00.000Z",
        now,
        platform: "google_meet",
        segmentCount: 0,
        startedAt: "2026-07-22T11:00:00.000Z",
        status: "missed",
      }),
    ).toBe(true);
  });

  it("does not offer recovery after one hour or with a transcript", () => {
    expect(
      isMeetingBotRecoveryEligible({
        canManage: true,
        now,
        platform: "zoom",
        segmentCount: 0,
        startedAt: "2026-07-22T11:09:59.000Z",
        status: "failed",
      }),
    ).toBe(false);
    expect(
      isMeetingBotRecoveryEligible({
        canManage: true,
        now,
        platform: "zoom",
        segmentCount: 1,
        startedAt: "2026-07-22T12:00:00.000Z",
        status: "failed",
      }),
    ).toBe(false);
  });

  it("keeps the missed meeting recovery window at fifteen minutes", () => {
    expect(
      isMeetingBotRecoveryEligible({
        canManage: true,
        now,
        platform: "zoom",
        segmentCount: 0,
        startedAt: "2026-07-22T11:54:59.999Z",
        status: "missed",
      }),
    ).toBe(false);
  });

  it("limits the failed row action to manageable empty remote meetings from the last hour", () => {
    const eligible = {
      canManage: true,
      now,
      platform: "zoom",
      segmentCount: 0,
      status: "failed",
      updatedAt: "2026-07-22T11:10:00.000Z",
    };

    expect(isRecentFailedMeetingBotRecoveryEligible(eligible)).toBe(true);
    expect(
      isRecentFailedMeetingBotRecoveryEligible({
        ...eligible,
        updatedAt: "2026-07-22T11:09:59.999Z",
      }),
    ).toBe(false);

    for (const ineligible of [
      { ...eligible, canManage: false },
      { ...eligible, platform: "microsoft_teams" },
      { ...eligible, segmentCount: 1 },
      { ...eligible, status: "missed" },
      { ...eligible, updatedAt: "2026-07-22T12:10:00.001Z" },
    ]) {
      expect(isRecentFailedMeetingBotRecoveryEligible(ineligible)).toBe(false);
    }
  });

  it("uses the meeting end time for a long meeting", () => {
    expect(
      isMeetingBotRecoveryEligible({
        canManage: true,
        endedAt: "2026-07-22T12:05:00.000Z",
        now,
        platform: "zoom",
        segmentCount: 0,
        startedAt: "2026-07-22T11:05:00.000Z",
        status: "failed",
      }),
    ).toBe(true);
  });

  it("keeps recovery open when a meeting runs past its scheduled end", () => {
    expect(
      isMeetingBotRecoveryEligible({
        canManage: true,
        endedAt: "2026-07-22T11:55:00.000Z",
        now,
        platform: "zoom",
        segmentCount: 0,
        startedAt: "2026-07-22T11:25:00.000Z",
        status: "missed",
        updatedAt: "2026-07-22T12:08:00.000Z",
      }),
    ).toBe(true);
  });

  it("keeps an early missed call recoverable during its scheduled window", () => {
    expect(
      isMeetingBotRecoveryEligible({
        canManage: true,
        endedAt: "2026-07-22T12:45:00.000Z",
        now,
        platform: "zoom",
        segmentCount: 0,
        startedAt: "2026-07-22T12:00:00.000Z",
        status: "missed",
        updatedAt: "2026-07-22T12:07:00.000Z",
      }),
    ).toBe(true);
  });
});

describe("meeting recording resume policy", () => {
  const now = new Date("2026-07-22T17:20:00.000Z");

  it("offers resume when recording ended but the scheduled meeting is active", () => {
    expect(
      isMeetingRecordingResumeEligible({
        canManage: true,
        lastRecordingEndedAt: "2026-07-22T17:07:23.000Z",
        now,
        platform: "zoom",
        scheduledEndedAt: "2026-07-22T17:45:00.000Z",
        scheduledStartedAt: "2026-07-22T17:00:00.000Z",
        status: "ready",
      }),
    ).toBe(true);
  });

  it("does not offer resume after the scheduled meeting window", () => {
    expect(
      isMeetingRecordingResumeEligible({
        canManage: true,
        lastRecordingEndedAt: "2026-07-22T17:07:23.000Z",
        now: new Date("2026-07-22T17:45:00.000Z"),
        platform: "zoom",
        scheduledEndedAt: "2026-07-22T17:45:00.000Z",
        scheduledStartedAt: "2026-07-22T17:00:00.000Z",
        status: "ready",
      }),
    ).toBe(false);
  });
});

describe("meeting bot recovery records", () => {
  afterEach(() => {
    assertCanCreateMeetings.mockReset();
    getWorkspace.mockReset();
    select.mockReset();
    update.mockReset();
    vi.resetModules();
  });

  it("finds a recent eligible meeting for confirmation", async () => {
    mockWorkspace();
    mockRecoverableMeeting();
    const { findMeetingBotRecoveryCandidate } =
      await import("@/lib/meeting-bot-recovery");

    await expect(
      findMeetingBotRecoveryCandidate({
        now: new Date("2026-07-22T12:10:00.000Z"),
        sessionUser: sessionUser(),
      }),
    ).resolves.toEqual({
      calendarEventId: null,
      endedAt: null,
      id: "11111111-1111-4111-8111-111111111111",
      mode: "recover",
      startedAt: "2026-07-22T12:00:00.000Z",
      title: "Founder call",
    });
    expect(assertCanCreateMeetings).toHaveBeenCalled();
    expect(getMeetingManagerCondition).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "22222222-2222-4222-8222-222222222222",
        userId: "33333333-3333-4333-8333-333333333333",
      }),
    );
  });

  it("lists recent meetings so the user can choose the correct call", async () => {
    mockWorkspace();
    mockRecoverableMeetings([
      {
        calendarEventId: null,
        endedAt: null,
        id: "11111111-1111-4111-8111-111111111111",
        startedAt: new Date("2026-07-22T15:00:00.000Z"),
        title: "IOSG <> Greenfield Capital",
      },
      {
        calendarEventId: null,
        endedAt: null,
        id: "44444444-4444-4444-8444-444444444444",
        startedAt: new Date("2026-07-22T14:55:00.000Z"),
        title: "Partner call",
      },
    ]);
    const { findMeetingBotRecoveryCandidates } =
      await import("@/lib/meeting-bot-recovery");

    await expect(
      findMeetingBotRecoveryCandidates({
        now: new Date("2026-07-22T15:04:00.000Z"),
        sessionUser: sessionUser(),
      }),
    ).resolves.toEqual([
      {
        calendarEventId: null,
        endedAt: null,
        id: "11111111-1111-4111-8111-111111111111",
        mode: "recover",
        startedAt: "2026-07-22T15:00:00.000Z",
        title: "IOSG <> Greenfield Capital",
      },
      {
        calendarEventId: null,
        endedAt: null,
        id: "44444444-4444-4444-8444-444444444444",
        mode: "recover",
        startedAt: "2026-07-22T14:55:00.000Z",
        title: "Partner call",
      },
    ]);
  });

  it("updates the existing meeting before scheduling its replacement bot", async () => {
    mockWorkspace();
    mockRecoverableMeeting();
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    update.mockReturnValue({ set: updateSet });
    const { prepareMeetingBotRecovery } =
      await import("@/lib/meeting-bot-recovery");

    await expect(
      prepareMeetingBotRecovery({
        meetingId: "11111111-1111-4111-8111-111111111111",
        meetingUrl: "https://zoom.us/j/123456789",
        now: new Date("2026-07-22T12:10:00.000Z"),
        platform: "zoom",
        sessionUser: sessionUser(),
      }),
    ).resolves.toEqual({
      meetingId: "11111111-1111-4111-8111-111111111111",
      resumeRecording: false,
      teamId: "22222222-2222-4222-8222-222222222222",
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingUrl: "https://zoom.us/j/123456789",
        platform: "zoom",
        recallBotId: null,
        status: "scheduled",
      }),
    );
  });
});

function mockWorkspace() {
  getWorkspace.mockResolvedValue({
    canCreateMeetings: true,
    teamId: "22222222-2222-4222-8222-222222222222",
    userId: "33333333-3333-4333-8333-333333333333",
  });
  assertCanCreateMeetings.mockResolvedValue(undefined);
}

function mockRecoverableMeeting() {
  mockRecoverableMeetings([
    {
      id: "11111111-1111-4111-8111-111111111111",
      startedAt: new Date("2026-07-22T12:00:00.000Z"),
      title: "Founder call",
    },
  ]);
}

function mockRecoverableMeetings(
  meetings: Array<{
    calendarEventId?: string | null;
    endedAt?: Date | null;
    id: string;
    startedAt: Date;
    title: string;
  }>,
) {
  select
    .mockReturnValueOnce(buildMeetingSelect([]))
    .mockReturnValueOnce(
      buildMeetingSelect(
        meetings.map((meeting) => ({ calendarEventId: null, ...meeting })),
      ),
    );
}

function buildMeetingSelect(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);

  return {
    from: () => ({
      where: () => ({
        orderBy: () => ({ limit }),
      }),
    }),
  };
}

function sessionUser() {
  return { email: "user@example.com", id: "user_123", name: null };
}
