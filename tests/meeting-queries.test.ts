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
    getWorkspace.mockResolvedValue({ teamId: "team_123", userId: "user_123" });
    select
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            leftJoin: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: vi.fn().mockResolvedValue([
                    {
                      id: "11111111-1111-4111-8111-111111111111",
                      teamId: "team_123",
                      title: "Customer sync",
                      platform: "google_meet",
                      status: "processing",
                      transcriptJobStatus: "running",
                      audioObjectKey: null,
                      calendarAttendeeEmails: [
                        "alice@example.com",
                        "updated.guest@nascent.xyz",
                      ],
                      recallRecordingId: "recording_123",
                    },
                  ]),
                }),
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
      })
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              orderBy: () => ({
                limit: vi.fn().mockResolvedValue([
                  {
                    email: "alice@example.com",
                    name: "Alice Chen",
                  },
                  {
                    email: "jane.doe@nascent.xyz",
                    name: null,
                  },
                ]),
              }),
            }),
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
      accessScope: "workspace",
      audioUrl:
        "/api/meetings/11111111-1111-4111-8111-111111111111/audio",
      speakerSuggestions: [
        {
          email: "alice@example.com",
          name: "Alice Chen",
        },
        {
          email: "jane.doe@nascent.xyz",
          name: "Jane Doe",
        },
        {
          email: "updated.guest@nascent.xyz",
          name: "Updated Guest",
        },
      ],
      transcriptJobStatus: "running",
    });
  });

  it("hides audio for transcripts shared from another workspace", async () => {
    getWorkspace.mockResolvedValue({ teamId: "team_123", userId: "user_123" });
    select
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            leftJoin: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: vi.fn().mockResolvedValue([
                    {
                      id: "11111111-1111-4111-8111-111111111111",
                      teamId: "team_other",
                      title: "Partner sync",
                      platform: "google_meet",
                      status: "ready",
                      transcriptJobStatus: null,
                      audioObjectKey: "audio.mp3",
                      calendarAttendeeEmails: ["guest@partner.com"],
                      recallRecordingId: "recording_123",
                    },
                  ]),
                }),
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
      })
      .mockReturnValueOnce({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              orderBy: () => ({
                limit: vi.fn().mockResolvedValue([
                  {
                    email: "user@example.com",
                    name: "Shared User",
                  },
                ]),
              }),
            }),
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
      accessScope: "shared",
      accessPeople: [
        {
          email: "user@example.com",
          name: "Shared User",
        },
      ],
      audioUrl: null,
    });
  });
});

describe("listMeetingsForWorkspace", () => {
  afterEach(() => {
    getWorkspace.mockReset();
    select.mockReset();
    vi.resetModules();
  });

  it("keeps newly uploaded MP3 meetings in the library even without calendar attendees", async () => {
    select
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              orderBy: vi.fn().mockResolvedValue([
                {
                  id: "33333333-3333-4333-8333-333333333333",
                  teamId: "team_123",
                  title: "Investment review",
                  platform: "upload",
                  status: "processing",
                  transcriptJobStatus: "queued",
                  recallBotId: null,
                  startedAt: new Date("2026-06-27T12:00:00.000Z"),
                  endedAt: new Date("2026-06-27T12:45:00.000Z"),
                  createdAt: new Date("2026-06-27T11:59:00.000Z"),
                  calendarAttendeeEmails: ["alice@iosg.vc", "founder@example.com"],
                },
              ]),
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
    const { listMeetingsForWorkspace } = await import("@/lib/meeting-queries");

    await expect(
      listMeetingsForWorkspace({
        teamId: "team_123",
        userId: "user_123",
        domain: "iosg.vc",
        canCreateMeetings: true,
      }),
    ).resolves.toEqual([
      {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Investment review",
        platform: "upload",
        status: "processing",
        transcriptJobStatus: "queued",
        hasRecallBot: false,
        startedAt: "2026-06-27T12:00:00.000Z",
        endedAt: "2026-06-27T12:45:00.000Z",
        participantCount: 2,
        accessScope: "workspace",
        relatedMeetings: [],
      },
    ]);
  });

  it("prioritizes active work before paging the meeting library", async () => {
    const orderBy = vi.fn().mockResolvedValue([]);

    select
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              orderBy,
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
    const { listMeetingsForWorkspace } = await import("@/lib/meeting-queries");

    await listMeetingsForWorkspace({
      teamId: "team_123",
      userId: "user_123",
      domain: "iosg.vc",
      canCreateMeetings: true,
    });

    expect(orderBy.mock.calls[0]).toHaveLength(3);
  });

  it("shows only the next 3 scheduled meetings that have a bot", async () => {
    select
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              orderBy: vi.fn().mockResolvedValue([
                meetingRow({
                  id: "11111111-1111-4111-8111-111111111111",
                  title: "Ready transcript",
                  status: "ready",
                  startedAt: "2026-06-26T12:00:00.000Z",
                }),
                meetingRow({
                  id: "22222222-2222-4222-8222-222222222222",
                  title: "Next bot join",
                  status: "scheduled",
                  recallBotId: "bot_1",
                  startedAt: "2026-06-28T14:00:00.000Z",
                }),
                meetingRow({
                  id: "33333333-3333-4333-8333-333333333333",
                  title: "Second bot join",
                  status: "scheduled",
                  recallBotId: "bot_2",
                  startedAt: "2026-06-28T15:00:00.000Z",
                }),
                meetingRow({
                  id: "44444444-4444-4444-8444-444444444444",
                  title: "Third bot join",
                  status: "scheduled",
                  recallBotId: "bot_3",
                  startedAt: "2026-06-28T16:00:00.000Z",
                }),
                meetingRow({
                  id: "55555555-5555-4555-8555-555555555555",
                  title: "Fourth bot join",
                  status: "scheduled",
                  recallBotId: "bot_4",
                  startedAt: "2026-06-28T17:00:00.000Z",
                }),
                meetingRow({
                  id: "66666666-6666-4666-8666-666666666666",
                  title: "No bot scheduled",
                  status: "scheduled",
                  recallBotId: null,
                  startedAt: "2026-06-28T13:00:00.000Z",
                }),
              ]),
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
    const { listMeetingsForWorkspace } = await import("@/lib/meeting-queries");

    await expect(
      listMeetingsForWorkspace(
        {
          teamId: "team_123",
          userId: "user_123",
          domain: "iosg.vc",
          canCreateMeetings: true,
        },
        undefined,
        { now: new Date("2026-06-28T12:00:00.000Z") },
      ),
    ).resolves.toEqual([
      expect.objectContaining({ title: "Next bot join" }),
      expect.objectContaining({ title: "Second bot join" }),
      expect.objectContaining({ title: "Third bot join" }),
      expect.objectContaining({ title: "Ready transcript" }),
    ]);
  });

  it("groups related meetings by shared external calendar attendees", async () => {
    select
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              orderBy: vi.fn().mockResolvedValue([
                {
                  id: "11111111-1111-4111-8111-111111111111",
                  teamId: "team_123",
                  title: "Founder intro",
                  platform: "google_meet",
                  status: "ready",
                  transcriptJobStatus: null,
                  recallBotId: null,
                  startedAt: new Date("2026-06-20T10:00:00.000Z"),
                  createdAt: new Date("2026-06-20T09:00:00.000Z"),
                  calendarAttendeeEmails: [
                    "alice@iosg.vc",
                    "founder@nascent.xyz",
                  ],
                },
                {
                  id: "22222222-2222-4222-8222-222222222222",
                  teamId: "team_123",
                  title: "Founder follow up",
                  platform: "google_meet",
                  status: "ready",
                  transcriptJobStatus: null,
                  recallBotId: null,
                  startedAt: new Date("2026-06-27T10:00:00.000Z"),
                  createdAt: new Date("2026-06-27T09:00:00.000Z"),
                  calendarAttendeeEmails: [
                    "bob@iosg.vc",
                    "partner@nascent.xyz",
                  ],
                },
              ]),
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
    const { listMeetingsForWorkspace } = await import("@/lib/meeting-queries");

    await expect(
      listMeetingsForWorkspace({
        teamId: "team_123",
        userId: "user_123",
        domain: "iosg.vc",
        canCreateMeetings: true,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "22222222-2222-4222-8222-222222222222",
        relatedMeetings: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            title: "Founder intro",
            startedAt: "2026-06-20T10:00:00.000Z",
          },
        ],
      }),
    ]);
  });
});

describe("buildMeetingLibraryPage", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("sorts visible library meetings by newest started time across platforms", async () => {
    const { buildMeetingLibraryPage } = await import("@/lib/meeting-queries");

    const page = buildMeetingLibraryPage(
      [
        libraryMeeting({
          id: "11111111-1111-4111-8111-111111111111",
          title: "Older upload",
          platform: "upload",
          startedAt: "2026-06-27T10:00:00.000Z",
        }),
        libraryMeeting({
          id: "22222222-2222-4222-8222-222222222222",
          title: "Newest meet",
          platform: "google_meet",
          startedAt: "2026-06-27T12:00:00.000Z",
        }),
        libraryMeeting({
          id: "33333333-3333-4333-8333-333333333333",
          title: "Middle zoom",
          platform: "zoom",
          startedAt: "2026-06-27T11:00:00.000Z",
        }),
      ],
      { now: new Date("2026-06-28T12:00:00.000Z") },
    );

    expect(page.meetings.map((meeting) => meeting.title)).toEqual([
      "Newest meet",
      "Middle zoom",
      "Older upload",
    ]);
  });

  it("sorts visible library meetings by duration when requested", async () => {
    const { buildMeetingLibraryPage } = await import("@/lib/meeting-queries");

    const page = buildMeetingLibraryPage(
      [
        libraryMeeting({
          id: "11111111-1111-4111-8111-111111111111",
          title: "Short sync",
          platform: "zoom",
          startedAt: "2026-06-27T10:00:00.000Z",
          endedAt: "2026-06-27T10:20:00.000Z",
        }),
        libraryMeeting({
          id: "22222222-2222-4222-8222-222222222222",
          title: "Deep diligence",
          platform: "google_meet",
          startedAt: "2026-06-27T09:00:00.000Z",
          endedAt: "2026-06-27T10:30:00.000Z",
        }),
      ],
      {
        now: new Date("2026-06-28T12:00:00.000Z"),
        sort: "duration_desc",
      },
    );

    expect(page.meetings.map((meeting) => meeting.title)).toEqual([
      "Deep diligence",
      "Short sync",
    ]);
  });

  it("sorts visible library meetings by participant count when requested", async () => {
    const { buildMeetingLibraryPage } = await import("@/lib/meeting-queries");

    const page = buildMeetingLibraryPage(
      [
        libraryMeeting({
          id: "11111111-1111-4111-8111-111111111111",
          title: "Small sync",
          platform: "zoom",
          startedAt: "2026-06-27T12:00:00.000Z",
          participantCount: 2,
        }),
        libraryMeeting({
          id: "22222222-2222-4222-8222-222222222222",
          title: "Large review",
          platform: "google_meet",
          startedAt: "2026-06-27T11:00:00.000Z",
          participantCount: 8,
        }),
      ],
      {
        now: new Date("2026-06-28T12:00:00.000Z"),
        sort: "participants_desc",
      },
    );

    expect(page.meetings.map((meeting) => meeting.title)).toEqual([
      "Large review",
      "Small sync",
    ]);
  });

  it("filters visible library meetings by review status", async () => {
    const { buildMeetingLibraryPage } = await import("@/lib/meeting-queries");

    const page = buildMeetingLibraryPage(
      [
        libraryMeeting({
          id: "11111111-1111-4111-8111-111111111111",
          title: "Ready transcript",
          platform: "google_meet",
          startedAt: "2026-06-27T12:00:00.000Z",
        }),
        {
          ...libraryMeeting({
            id: "22222222-2222-4222-8222-222222222222",
            title: "Failed recording",
            platform: "zoom",
            startedAt: "2026-06-27T11:00:00.000Z",
          }),
          status: "failed" as const,
        },
      ],
      {
        now: new Date("2026-06-28T12:00:00.000Z"),
        status: "failed",
      },
    );

    expect(page.meetings.map((meeting) => meeting.title)).toEqual([
      "Failed recording",
    ]);
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

function meetingRow(overrides: {
  id: string;
  title: string;
  status: "scheduled" | "recording" | "processing" | "ready" | "failed";
  recallBotId?: string | null;
  startedAt: string;
}) {
  return {
    id: overrides.id,
    teamId: "team_123",
    title: overrides.title,
    platform: "google_meet",
    status: overrides.status,
    transcriptJobStatus: null,
    recallBotId: overrides.recallBotId ?? null,
    startedAt: new Date(overrides.startedAt),
    createdAt: new Date(overrides.startedAt),
    calendarAttendeeEmails: null,
  };
}

function libraryMeeting(overrides: {
  id: string;
  title: string;
  platform: "google_meet" | "in_person" | "zoom" | "upload";
  startedAt: string;
  endedAt?: string;
  participantCount?: number;
}) {
  return {
    id: overrides.id,
    title: overrides.title,
    platform: overrides.platform,
    status: "ready" as const,
    transcriptJobStatus: null,
    hasRecallBot: false,
    startedAt: overrides.startedAt,
    endedAt: overrides.endedAt ?? null,
    participantCount: overrides.participantCount,
    accessScope: "workspace" as const,
    relatedMeetings: [],
  };
}
