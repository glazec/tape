import { afterEach, describe, expect, it, vi } from "vitest";

const { getWorkspace, select } = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

vi.mock("@/db/client", () => ({
  db: {
    select,
  },
}));

describe("getWorkspaceMeetingTranscript", () => {
  afterEach(() => {
    getWorkspace.mockReset();
    select.mockReset();
    vi.resetModules();
  });

  it("exposes the audio route for Recall recordings without an R2 asset", async () => {
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    select
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              orderBy: () => ({
                limit: vi.fn().mockResolvedValue([
                  {
                    id: "11111111-1111-4111-8111-111111111111",
                    title: "Customer sync",
                    platform: "google_meet",
                    status: "processing",
                    transcriptJobStatus: "running",
                    audioObjectKey: null,
                    recallRecordingId: "recording_123",
                  },
                ]),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      });
    const { getWorkspaceMeetingTranscript } = await import(
      "@/lib/meeting-queries"
    );

    await expect(
      getWorkspaceMeetingTranscript(
        {
          id: "user_123",
          email: "user@example.com",
          name: null,
        },
        "11111111-1111-4111-8111-111111111111",
      ),
    ).resolves.toMatchObject({
      audioUrl:
        "/api/meetings/11111111-1111-4111-8111-111111111111/audio",
      transcriptJobStatus: "running",
    });
  });
});

describe("getMeetingDashboardSummaryForWorkspace", () => {
  afterEach(() => {
    getWorkspace.mockReset();
    select.mockReset();
    vi.resetModules();
  });

  it("builds global dashboard counts from Neon rows instead of the visible table", async () => {
    select.mockReturnValue({
      from: () => ({
        where: vi.fn().mockResolvedValue([
          {
            title: "Founder intro",
            status: "scheduled",
            transcriptJobStatus: null,
            recallBotId: "bot_123",
            startedAt: new Date("2999-01-01T14:00:00.000Z"),
            createdAt: new Date("2026-06-27T10:00:00.000Z"),
          },
          {
            title: "Uncovered partner sync",
            status: "scheduled",
            transcriptJobStatus: null,
            recallBotId: null,
            startedAt: new Date("2999-01-01T15:00:00.000Z"),
            createdAt: new Date("2026-06-27T10:00:00.000Z"),
          },
          {
            title: "Ready transcript",
            status: "ready",
            transcriptJobStatus: null,
            recallBotId: "bot_456",
            startedAt: new Date("2026-06-27T10:00:00.000Z"),
            createdAt: new Date("2026-06-27T10:00:00.000Z"),
          },
          {
            title: "Failed recording",
            status: "failed",
            transcriptJobStatus: null,
            recallBotId: "bot_789",
            startedAt: new Date("2026-06-27T09:00:00.000Z"),
            createdAt: new Date("2026-06-27T09:00:00.000Z"),
          },
        ]),
      }),
    });
    const { getMeetingDashboardSummaryForWorkspace } = await import(
      "@/lib/meeting-queries"
    );

    await expect(
      getMeetingDashboardSummaryForWorkspace({
        teamId: "22222222-2222-4222-8222-222222222222",
        userId: "11111111-1111-4111-8111-111111111111",
        domain: "example.com",
      }),
    ).resolves.toMatchObject({
      upcomingBotJoins: 1,
      readyTranscripts: 1,
      failedMeetings: 1,
      scheduledWithoutBot: 1,
      needsAttention: 2,
      nextBotJoin: {
        title: "Founder intro",
        startedAt: "2999-01-01T14:00:00.000Z",
      },
    });
  });
});
