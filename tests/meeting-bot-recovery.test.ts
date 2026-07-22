import { afterEach, describe, expect, it, vi } from "vitest";

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

import { isMeetingBotRecoveryEligible } from "@/lib/meeting-bot-recovery-policy";

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

  it("does not offer recovery after fifteen minutes or with a transcript", () => {
    expect(
      isMeetingBotRecoveryEligible({
        canManage: true,
        now,
        platform: "zoom",
        segmentCount: 0,
        startedAt: "2026-07-22T11:54:59.000Z",
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
    const { findMeetingBotRecoveryCandidate } = await import(
      "@/lib/meeting-bot-recovery"
    );

    await expect(
      findMeetingBotRecoveryCandidate({
        now: new Date("2026-07-22T12:10:00.000Z"),
        sessionUser: sessionUser(),
      }),
    ).resolves.toEqual({
      id: "11111111-1111-4111-8111-111111111111",
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

  it("updates the existing meeting before scheduling its replacement bot", async () => {
    mockWorkspace();
    mockRecoverableMeeting();
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    update.mockReturnValue({ set: updateSet });
    const { prepareMeetingBotRecovery } = await import(
      "@/lib/meeting-bot-recovery"
    );

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
  const limit = vi.fn().mockResolvedValue([
    {
      id: "11111111-1111-4111-8111-111111111111",
      startedAt: new Date("2026-07-22T12:00:00.000Z"),
      title: "Founder call",
    },
  ]);
  select.mockReturnValue({
    from: () => ({
      where: () => ({
        orderBy: () => ({ limit }),
      }),
    }),
  });
}

function sessionUser() {
  return { email: "user@example.com", id: "user_123", name: null };
}
