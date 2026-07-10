import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
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

const dialect = new PgDialect();

function toQuery(condition: SQL) {
  return dialect.sqlToQuery(condition);
}

function expectUsesCurrentTranscriptJob(condition: SQL) {
  const query = toQuery(condition);

  expect(query.sql).toContain('"transcript_segments"."job_id"');
  expect(query.sql).toContain('"transcript_jobs"');
  expect(query.sql).toContain('"transcript_jobs"."status" = \'completed\'');
}

describe("getWorkspaceMeetingTranscript", () => {
  afterEach(() => {
    getWorkspace.mockReset();
    select.mockReset();
    vi.resetModules();
  });

  it("loads cancelled meetings by direct id", async () => {
    const meetingWhere = vi.fn((condition: SQL) => {
      void condition;

      return {
        orderBy: () => ({
          limit: vi.fn().mockResolvedValue([
            {
              id: "11111111-1111-4111-8111-111111111111",
              teamId: "team_123",
              title: "Cancelled partner sync",
              platform: "zoom",
              status: "cancelled",
              transcriptJobStatus: null,
              audioObjectKey: null,
              calendarAttendeeEmails: [],
              recallRecordingId: null,
              translationErrorMessage: null,
              translationStatus: null,
            },
          ]),
        }),
      };
    });

    getWorkspace.mockResolvedValue({ teamId: "team_123", userId: "user_123" });
    select
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            leftJoin: () => ({
              where: meetingWhere,
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
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: vi.fn().mockResolvedValue([]),
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
          where: () => ({
            orderBy: vi.fn().mockResolvedValue([]),
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
      id: "11111111-1111-4111-8111-111111111111",
      status: "cancelled",
      title: "Cancelled partner sync",
    });

    const query = toQuery(meetingWhere.mock.calls[0][0]);
    expect(query.sql).not.toContain('"meetings"."status" <>');
    expect(query.params).not.toContain("cancelled");
  });

  it("renames default meeting titles on the detail page", async () => {
    getWorkspace.mockResolvedValue({
      teamId: "team_123",
      userId: "user_123",
      domain: "iosg.vc",
    });
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
                      title: "meeting with IOSG",
                      platform: "google_meet",
                      status: "ready",
                      transcriptJobStatus: null,
                      audioObjectKey: null,
                      calendarAttendeeEmails: [
                        "alice@iosg.vc",
                        "founder@nascent.xyz",
                      ],
                      recallRecordingId: null,
                      translationErrorMessage: null,
                      translationStatus: null,
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
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: vi.fn().mockResolvedValue([]),
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
          where: () => ({
            orderBy: vi.fn().mockResolvedValue([]),
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
      title: "IOSG <> Nascent",
    });
  });

  it("exposes the audio route for Recall recordings without an R2 asset", async () => {
    const segmentWhere = vi.fn((condition: SQL) => {
      void condition;

      return {
        orderBy: vi.fn().mockResolvedValue([]),
      };
    });

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
                        "participant@iosg.vc",
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
          where: segmentWhere,
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
                  {
                    email: "participant@iosg.vc",
                    name: null,
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
            orderBy: () => ({
              limit: vi.fn().mockResolvedValue([
                {
                  email: null,
                  name: "Participant",
                },
              ]),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: vi.fn().mockResolvedValue([
              {
                aliases: ["nascent.xyz"],
                normalizedValue: "nascent",
                type: "organization",
                value: "Nascent",
              },
              {
                aliases: [],
                normalizedValue: "darko",
                type: "name",
                value: "Darko",
              },
              {
                aliases: [],
                normalizedValue: "20 million",
                type: "money",
                value: "20 million",
              },
              {
                aliases: [],
                normalizedValue: "solana",
                type: "product",
                value: "Solana",
              },
            ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: vi.fn().mockResolvedValue([
              {
                id: "55555555-5555-4555-8555-555555555555",
                capturedAt: new Date("2026-06-29T14:01:05.000Z"),
                timestampMs: 65000,
              },
            ]),
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
          email: "participant@iosg.vc",
          name: "Participant",
        },
        {
          email: "updated.guest@nascent.xyz",
          name: "Updated Guest",
        },
      ],
      entities: [
        {
          aliases: ["nascent.xyz"],
          normalizedValue: "nascent",
          type: "organization",
          value: "Nascent",
        },
        {
          normalizedValue: "darko",
          type: "name",
          value: "Darko",
        },
        {
          normalizedValue: "20 million",
          type: "money",
          value: "20 million",
        },
      ],
      visualAssets: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          capturedAt: "2026-06-29T14:01:05.000Z",
          timestampMs: 65000,
          url: "/api/meetings/11111111-1111-4111-8111-111111111111/images/55555555-5555-4555-8555-555555555555",
        },
      ],
      transcriptJobStatus: "running",
    });

    expectUsesCurrentTranscriptJob(segmentWhere.mock.calls[0][0]);
  });

  it("checks synthesized local recorder audio when deciding if the player is available", async () => {
    const mediaLeftJoin = vi.fn((_table: unknown, condition: SQL) => {
      void condition;

      return {
        leftJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      };
    });

    getWorkspace.mockResolvedValue({ teamId: "team_123", userId: "user_123" });
    select.mockReturnValueOnce({
      from: () => ({
        leftJoin: mediaLeftJoin,
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
    ).resolves.toBeNull();

    const query = toQuery(mediaLeftJoin.mock.calls[0][1]);
    expect(query.params).toEqual(
      expect.arrayContaining(["synthesized_audio", "audio"]),
    );
  });

  it("exposes audio for transcripts shared from another workspace", async () => {
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
      accessScope: "shared",
      accessPeople: [
        {
          email: "user@example.com",
          name: "Shared User",
        },
      ],
      audioUrl:
        "/api/meetings/11111111-1111-4111-8111-111111111111/audio",
    });
  });
});

describe("listMeetingDetailRelatedMeetingsForWorkspace", () => {
  afterEach(() => {
    getWorkspace.mockReset();
    select.mockReset();
    vi.resetModules();
  });

  it("lists readable related meetings with transcript previews", async () => {
    const meetingWhere = vi.fn((condition: SQL) => {
      void condition;

      return {
        orderBy: vi.fn().mockResolvedValue([
          {
            id: "22222222-2222-4222-8222-222222222222",
            title: "Nascent follow up",
            startedAt: new Date("2026-06-27T12:00:00.000Z"),
            createdAt: new Date("2026-06-27T11:59:00.000Z"),
            calendarAttendeeEmails: [
              "alice@iosg.vc",
              "founder@nascent.xyz",
            ],
          },
          {
            id: "11111111-1111-4111-8111-111111111111",
            title: "Nascent intro",
            startedAt: new Date("2026-06-20T12:00:00.000Z"),
            createdAt: new Date("2026-06-20T11:59:00.000Z"),
            calendarAttendeeEmails: [
              "bob@iosg.vc",
              "founder@nascent.xyz",
            ],
          },
          {
            id: "33333333-3333-4333-8333-333333333333",
            title: "Internal review",
            startedAt: new Date("2026-06-19T12:00:00.000Z"),
            createdAt: new Date("2026-06-19T11:59:00.000Z"),
            calendarAttendeeEmails: ["bob@iosg.vc"],
          },
        ]),
      };
    });
    const previewWhere = vi.fn((condition: SQL) => {
      void condition;

      return {
        orderBy: () => ({
          limit: vi.fn().mockResolvedValue([
            {
              id: "segment_1",
              speaker: "Founder",
              startMs: 42_000,
              text: "We discussed the next product milestone.",
            },
          ]),
        }),
      };
    });

    select
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            where: meetingWhere,
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: previewWhere,
        }),
      });
    const { listMeetingDetailRelatedMeetingsForWorkspace } = await import(
      "@/lib/meeting-queries"
    );

    await expect(
      listMeetingDetailRelatedMeetingsForWorkspace(
        {
          teamId: "team_123",
          userId: "user_123",
          domain: "iosg.vc",
          canCreateMeetings: false,
        },
        "22222222-2222-4222-8222-222222222222",
      ),
    ).resolves.toEqual([
      {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Nascent intro",
        startedAt: "2026-06-20T12:00:00.000Z",
        hasMoreTranscriptSegments: false,
        transcriptPreview: [
          {
            id: "segment_1",
            speaker: "Founder",
            startMs: 42_000,
            text: "We discussed the next product milestone.",
          },
        ],
      },
    ]);

    const meetingQuery = toQuery(meetingWhere.mock.calls[0][0]);
    expect(meetingQuery.sql).toContain('"meeting_access"');
    expect(meetingQuery.params).toContain("cancelled");
    expectUsesCurrentTranscriptJob(previewWhere.mock.calls[0][0]);
  });

  it("renames default titles in detail related meetings", async () => {
    select
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              orderBy: vi.fn().mockResolvedValue([
                {
                  id: "22222222-2222-4222-8222-222222222222",
                  title: "Custom partner follow up",
                  startedAt: new Date("2026-06-27T12:00:00.000Z"),
                  createdAt: new Date("2026-06-27T11:59:00.000Z"),
                  calendarAttendeeEmails: [
                    "alice@iosg.vc",
                    "founder@nascent.xyz",
                  ],
                },
                {
                  id: "11111111-1111-4111-8111-111111111111",
                  title: "meeting with IOSG",
                  startedAt: new Date("2026-06-20T12:00:00.000Z"),
                  createdAt: new Date("2026-06-20T11:59:00.000Z"),
                  calendarAttendeeEmails: [
                    "bob@iosg.vc",
                    "founder@nascent.xyz",
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
            orderBy: () => ({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });
    const { listMeetingDetailRelatedMeetingsForWorkspace } = await import(
      "@/lib/meeting-queries"
    );

    await expect(
      listMeetingDetailRelatedMeetingsForWorkspace(
        {
          teamId: "team_123",
          userId: "user_123",
          domain: "iosg.vc",
          canCreateMeetings: false,
        },
        "22222222-2222-4222-8222-222222222222",
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        title: "IOSG <> Nascent",
      }),
    ]);
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
        participantNames: ["Alice", "Founder"],
        accessScope: "workspace",
        relatedMeetings: [],
      },
    ]);
  });

  it("uses recognized transcript speakers as ready meeting participants", async () => {
    select
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              orderBy: vi.fn().mockResolvedValue([
                {
                  id: "44444444-4444-4444-8444-444444444444",
                  teamId: "team_123",
                  title: "Uploaded audio",
                  platform: "upload",
                  status: "ready",
                  transcriptJobStatus: null,
                  recallBotId: null,
                  startedAt: new Date("2026-06-27T12:00:00.000Z"),
                  endedAt: new Date("2026-06-27T12:45:00.000Z"),
                  createdAt: new Date("2026-06-27T11:59:00.000Z"),
                  calendarAttendeeEmails: null,
                  recognizedSpeakerCount: 2,
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
    ).resolves.toMatchObject([
      {
        id: "44444444-4444-4444-8444-444444444444",
        participantCount: 2,
      },
    ]);

    const projection = select.mock.calls[0][0] as {
      recognizedSpeakerCount: SQL;
      transcriptDurationMs: SQL;
      transcriptSegmentCount: SQL;
    };
    expectUsesCurrentTranscriptJob(projection.recognizedSpeakerCount);
    expectUsesCurrentTranscriptJob(projection.transcriptSegmentCount);
    expectUsesCurrentTranscriptJob(projection.transcriptDurationMs);
  });

  it("prefers current transcript speakers over calendar attendees for ready meetings", async () => {
    select
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              orderBy: vi.fn().mockResolvedValue([
                {
                  id: "2702fadb-cdf7-4d99-89ca-416eaa5bf640",
                  teamId: "team_123",
                  title: "Internal Meeting - Investment Strategy",
                  platform: "zoom",
                  status: "ready",
                  transcriptJobStatus: null,
                  recallBotId: "bot_123",
                  startedAt: new Date("2026-06-30T02:00:00.000Z"),
                  endedAt: new Date("2026-06-30T02:31:00.000Z"),
                  createdAt: new Date("2026-06-27T05:28:53.945Z"),
                  calendarAttendeeEmails: [
                    "member@iosg.vc",
                    "teammate@iosg.vc",
                    "participant@iosg.vc",
                    "test@iosg.vc",
                    "reviewer@iosg.vc",
                  ],
                  recognizedSpeakerCount: 4,
                  transcriptSegmentCount: 259,
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
    ).resolves.toMatchObject([
      {
        id: "2702fadb-cdf7-4d99-89ca-416eaa5bf640",
        participantCount: 4,
      },
    ]);
  });

  it("searches only the current transcript job text", async () => {
    const meetingWhere = vi.fn((condition: SQL) => {
      void condition;

      return {
        orderBy: vi.fn().mockResolvedValue([]),
      };
    });

    select.mockReturnValueOnce({
      from: () => ({
        leftJoin: () => ({
          where: meetingWhere,
        }),
      }),
    });
    const { listMeetingsForWorkspace } = await import("@/lib/meeting-queries");

    await listMeetingsForWorkspace(
      {
        teamId: "team_123",
        userId: "user_123",
        domain: "iosg.vc",
        canCreateMeetings: true,
      },
      "hello",
      { searchScope: "transcript" },
    );

    expectUsesCurrentTranscriptJob(meetingWhere.mock.calls[0][0]);
  });

  it("counts an unlabeled ready transcript as one participant", async () => {
    select
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              orderBy: vi.fn().mockResolvedValue([
                {
                  id: "55555555-5555-4555-8555-555555555555",
                  teamId: "team_123",
                  title: "Uploaded audio",
                  platform: "upload",
                  status: "ready",
                  transcriptJobStatus: null,
                  recallBotId: null,
                  startedAt: new Date("2026-06-24T06:13:00.000Z"),
                  endedAt: null,
                  createdAt: new Date("2026-06-24T06:13:00.000Z"),
                  calendarAttendeeEmails: null,
                  recognizedSpeakerCount: 0,
                  transcriptSegmentCount: 1,
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
    ).resolves.toMatchObject([
      {
        id: "55555555-5555-4555-8555-555555555555",
        participantCount: 1,
      },
    ]);
  });

  it("uses transcript segment timing as upload duration", async () => {
    select
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              orderBy: vi.fn().mockResolvedValue([
                {
                  id: "66666666-6666-4666-8666-666666666666",
                  teamId: "team_123",
                  title: "Uploaded audio",
                  platform: "upload",
                  status: "ready",
                  transcriptJobStatus: null,
                  recallBotId: null,
                  startedAt: new Date("2026-06-27T23:10:00.000Z"),
                  endedAt: null,
                  createdAt: new Date("2026-06-27T23:10:00.000Z"),
                  calendarAttendeeEmails: null,
                  recognizedSpeakerCount: 2,
                  transcriptSegmentCount: 237,
                  transcriptDurationMs: 1478342,
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
    ).resolves.toMatchObject([
      {
        id: "66666666-6666-4666-8666-666666666666",
        durationMs: 1478342,
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
    ).resolves.toMatchObject([
      expect.objectContaining({
        id: "22222222-2222-4222-8222-222222222222",
        relatedMeetings: [
          expect.objectContaining({
            id: "11111111-1111-4111-8111-111111111111",
            title: "Founder intro",
            platform: "google_meet",
            participantCount: 2,
            startedAt: "2026-06-20T10:00:00.000Z",
            status: "ready",
          }),
        ],
      }),
    ]);
  });

  it("renames workspace default titles from external attendee domains in the library", async () => {
    select
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              orderBy: vi.fn().mockResolvedValue([
                {
                  id: "11111111-1111-4111-8111-111111111111",
                  teamId: "team_123",
                  title: "meeting with IOSG",
                  platform: "google_meet",
                  status: "ready",
                  transcriptJobStatus: null,
                  recallBotId: null,
                  startedAt: new Date("2026-06-27T10:00:00.000Z"),
                  createdAt: new Date("2026-06-27T09:00:00.000Z"),
                  calendarAttendeeEmails: [
                    "alice@iosg.vc",
                    "founder@nascent.xyz",
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
    ).resolves.toMatchObject([
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        title: "IOSG <> Nascent",
      }),
    ]);
  });

  it("surfaces detected entities without grouping by entity alone", async () => {
    select
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              orderBy: vi.fn().mockResolvedValue([
                {
                  id: "11111111-1111-4111-8111-111111111111",
                  teamId: "team_123",
                  title: "Nascent intro",
                  platform: "google_meet",
                  status: "ready",
                  transcriptJobStatus: null,
                  recallBotId: null,
                  startedAt: new Date("2026-06-20T10:00:00.000Z"),
                  createdAt: new Date("2026-06-20T09:00:00.000Z"),
                  calendarAttendeeEmails: [],
                },
                {
                  id: "22222222-2222-4222-8222-222222222222",
                  teamId: "team_123",
                  title: "Nascent follow up",
                  platform: "google_meet",
                  status: "ready",
                  transcriptJobStatus: null,
                  recallBotId: null,
                  startedAt: new Date("2026-06-27T10:00:00.000Z"),
                  createdAt: new Date("2026-06-27T09:00:00.000Z"),
                  calendarAttendeeEmails: [],
                },
              ]),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: vi.fn().mockResolvedValue([
              {
                meetingId: "11111111-1111-4111-8111-111111111111",
                type: "name",
                normalizedValue: "darko",
              },
              {
                meetingId: "11111111-1111-4111-8111-111111111111",
                type: "money",
                normalizedValue: "20 million",
              },
              {
                meetingId: "11111111-1111-4111-8111-111111111111",
                type: "organization",
                normalizedValue: "iosg",
              },
              {
                meetingId: "11111111-1111-4111-8111-111111111111",
                type: "organization",
                normalizedValue: "nascent",
              },
              {
                meetingId: "22222222-2222-4222-8222-222222222222",
                type: "name",
                normalizedValue: "reviewer",
              },
              {
                meetingId: "22222222-2222-4222-8222-222222222222",
                type: "organization",
                normalizedValue: "iosg",
              },
              {
                meetingId: "22222222-2222-4222-8222-222222222222",
                type: "meeting_link",
                normalizedValue: "zoom.us/j/1234567890",
              },
              {
                meetingId: "22222222-2222-4222-8222-222222222222",
                type: "organization",
                normalizedValue: "nascent",
              },
            ]),
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
    ).resolves.toMatchObject([
      expect.objectContaining({
        id: "22222222-2222-4222-8222-222222222222",
        primaryEntity: "nascent",
        relatedMeetings: [],
      }),
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        primaryEntity: "nascent",
        relatedMeetings: [],
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

  it("hides cancelled meetings from the library", async () => {
    const { buildMeetingLibraryPage } = await import("@/lib/meeting-queries");

    const page = buildMeetingLibraryPage(
      [
        libraryMeeting({
          id: "11111111-1111-4111-8111-111111111111",
          title: "Cancelled partner sync",
          platform: "google_meet",
          startedAt: "2026-06-27T12:00:00.000Z",
          status: "cancelled",
        }),
        libraryMeeting({
          id: "22222222-2222-4222-8222-222222222222",
          title: "Ready founder call",
          platform: "zoom",
          startedAt: "2026-06-27T11:00:00.000Z",
        }),
      ],
      { now: new Date("2026-06-28T12:00:00.000Z") },
    );

    expect(page.meetings.map((meeting) => meeting.title)).toEqual([
      "Ready founder call",
    ]);
    expect(page.hasOlderMeetings).toBe(false);
  });

  it("shows the last six months by default and reports older history", async () => {
    const { buildMeetingLibraryPage } = await import("@/lib/meeting-queries");

    const page = buildMeetingLibraryPage(
      [
        libraryMeeting({
          id: "11111111-1111-4111-8111-111111111111",
          title: "Recent founder call",
          platform: "google_meet",
          startedAt: "2026-06-27T12:00:00.000Z",
        }),
        libraryMeeting({
          id: "22222222-2222-4222-8222-222222222222",
          title: "Older board prep",
          platform: "zoom",
          startedAt: "2025-11-27T12:00:00.000Z",
        }),
      ],
      { now: new Date("2026-06-28T12:00:00.000Z") },
    );

    expect(page.historyMonths).toBe(6);
    expect(page.hasOlderMeetings).toBe(true);
    expect(page.meetings.map((meeting) => meeting.title)).toEqual([
      "Recent founder call",
    ]);
  });

  it("loads older meetings when the history window expands", async () => {
    const { buildMeetingLibraryPage } = await import("@/lib/meeting-queries");

    const page = buildMeetingLibraryPage(
      [
        libraryMeeting({
          id: "11111111-1111-4111-8111-111111111111",
          title: "Recent founder call",
          platform: "google_meet",
          startedAt: "2026-06-27T12:00:00.000Z",
        }),
        libraryMeeting({
          id: "22222222-2222-4222-8222-222222222222",
          title: "Older board prep",
          platform: "zoom",
          startedAt: "2025-11-27T12:00:00.000Z",
        }),
      ],
      {
        historyMonths: 12,
        now: new Date("2026-06-28T12:00:00.000Z"),
      },
    );

    expect(page.historyMonths).toBe(12);
    expect(page.meetings.map((meeting) => meeting.title)).toEqual([
      "Recent founder call",
      "Older board prep",
    ]);
  });

  it("shows two months of related meetings by default without shrinking the library", async () => {
    const { buildMeetingLibraryPage } = await import("@/lib/meeting-queries");

    const page = buildMeetingLibraryPage(
      [
        libraryMeeting({
          id: "11111111-1111-4111-8111-111111111111",
          title: "Nascent follow up",
          platform: "google_meet",
          externalParticipantKeys: ["email:founder@nascent.xyz"],
          startedAt: "2026-06-27T12:00:00.000Z",
        }),
        libraryMeeting({
          id: "22222222-2222-4222-8222-222222222222",
          title: "Nascent monthly check in",
          platform: "google_meet",
          externalParticipantKeys: ["email:founder@nascent.xyz"],
          startedAt: "2026-05-27T12:00:00.000Z",
        }),
        libraryMeeting({
          id: "33333333-3333-4333-8333-333333333333",
          title: "Nascent old intro",
          platform: "google_meet",
          externalParticipantKeys: ["email:founder@nascent.xyz"],
          startedAt: "2026-03-27T12:00:00.000Z",
        }),
        libraryMeeting({
          id: "44444444-4444-4444-8444-444444444444",
          title: "Standalone quarterly review",
          platform: "zoom",
          startedAt: "2026-03-27T12:00:00.000Z",
        }),
      ],
      { now: new Date("2026-06-28T12:00:00.000Z") },
    );

    expect(page.historyMonths).toBe(6);
    expect(page.relatedHistoryMonths).toBe(2);
    expect(page.meetings.map((meeting) => meeting.title)).toEqual([
      "Nascent follow up",
      "Standalone quarterly review",
    ]);
    expect(page.meetings[0]).toMatchObject({
      title: "Nascent follow up",
      hasMoreRelatedMeetings: true,
      relatedMeetings: [
        expect.objectContaining({ title: "Nascent monthly check in" }),
      ],
    });
    expect(
      page.meetings[0]?.relatedMeetings?.map((meeting) => meeting.title),
    ).toEqual(["Nascent monthly check in"]);
    expect(page.meetings[1]?.relatedMeetings).toEqual([]);
  });

  it("keeps older related meetings hidden until the related window expands", async () => {
    const { buildMeetingLibraryPage } = await import("@/lib/meeting-queries");
    const meetings = [
      libraryMeeting({
        id: "11111111-1111-4111-8111-111111111111",
        title: "Nascent follow up",
        platform: "google_meet",
        externalParticipantKeys: ["email:founder@nascent.xyz"],
        startedAt: "2026-06-27T12:00:00.000Z",
      }),
      libraryMeeting({
        id: "22222222-2222-4222-8222-222222222222",
        title: "Nascent intro",
        platform: "google_meet",
        externalParticipantKeys: ["email:founder@nascent.xyz"],
        startedAt: "2025-11-27T12:00:00.000Z",
      }),
      libraryMeeting({
        id: "33333333-3333-4333-8333-333333333333",
        title: "Old unrelated call",
        platform: "zoom",
        startedAt: "2025-11-27T12:00:00.000Z",
      }),
    ];

    const page = buildMeetingLibraryPage(meetings, {
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    expect(page.meetings).toHaveLength(1);
    expect(page.meetings[0]).toMatchObject({
      title: "Nascent follow up",
      hasMoreRelatedMeetings: true,
      relatedMeetings: [],
    });

    const expandedPage = buildMeetingLibraryPage(meetings, {
      now: new Date("2026-06-28T12:00:00.000Z"),
      relatedHistoryMonths: 12,
    });

    expect(expandedPage.meetings).toHaveLength(1);
    expect(expandedPage.meetings[0]).toMatchObject({
      title: "Nascent follow up",
      relatedMeetings: [expect.objectContaining({ title: "Nascent intro" })],
    });
  });

  it("uses stable meeting titles when searching older related meetings", async () => {
    const { buildMeetingLibraryPage } = await import("@/lib/meeting-queries");
    const meetings = [
      libraryMeeting({
        id: "11111111-1111-4111-8111-111111111111",
        title: "David <> YP",
        platform: "zoom",
        startedAt: "2026-06-27T12:00:00.000Z",
      }),
      libraryMeeting({
        id: "22222222-2222-4222-8222-222222222222",
        title: "David <> YP",
        platform: "zoom",
        startedAt: "2025-11-27T12:00:00.000Z",
      }),
    ];

    const page = buildMeetingLibraryPage(meetings, {
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    expect(page.meetings[0]).toMatchObject({
      title: "David <> YP",
      hasMoreRelatedMeetings: true,
      relatedMeetings: [],
    });

    const expandedPage = buildMeetingLibraryPage(meetings, {
      now: new Date("2026-06-28T12:00:00.000Z"),
      relatedHistoryMonths: 12,
    });

    expect(expandedPage.meetings[0]).toMatchObject({
      title: "David <> YP",
      relatedMeetings: [expect.objectContaining({ title: "David <> YP" })],
    });
  });

  it("folds duplicate meeting titles into one tree in smart order", async () => {
    const { buildMeetingLibraryPage } = await import("@/lib/meeting-queries");

    const page = buildMeetingLibraryPage(
      [
        {
          ...libraryMeeting({
            id: "11111111-1111-4111-8111-111111111111",
            title: "David <> YP",
            platform: "zoom",
            startedAt: "2026-06-27T10:00:00.000Z",
          }),
          status: "ready" as const,
        },
        {
          ...libraryMeeting({
            id: "22222222-2222-4222-8222-222222222222",
            title: "David <> YP",
            platform: "zoom",
            startedAt: "2999-06-29T15:00:00.000Z",
          }),
          hasRecallBot: true,
          status: "scheduled" as const,
        },
        libraryMeeting({
          id: "33333333-3333-4333-8333-333333333333",
          title: "Weekly working report",
          platform: "zoom",
          startedAt: "2026-06-28T10:00:00.000Z",
        }),
      ],
      {
        now: new Date("2026-06-28T12:00:00.000Z"),
        sort: "smart",
      },
    );

    expect(page.meetings.map((meeting) => meeting.title)).toEqual([
      "David <> YP",
      "Weekly working report",
    ]);
    expect(page.meetings[0]).toMatchObject({
      id: "22222222-2222-4222-8222-222222222222",
      status: "scheduled",
      relatedMeetings: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          title: "David <> YP",
          startedAt: "2026-06-27T10:00:00.000Z",
          status: "ready",
        },
      ],
    });
  });

  it("keeps a ready transcript visible when a newer related scheduled meeting is capped", async () => {
    const { buildMeetingLibraryPage } = await import("@/lib/meeting-queries");

    const page = buildMeetingLibraryPage(
      [
        {
          ...libraryMeeting({
            id: "11111111-1111-4111-8111-111111111111",
            title: "Test",
            platform: "zoom",
            startedAt: "2026-07-01T01:00:00.000Z",
          }),
          hasRecallBot: true,
          status: "scheduled" as const,
        },
        {
          ...libraryMeeting({
            id: "22222222-2222-4222-8222-222222222222",
            title: "Bingx - IOSG Biweekly catch-up",
            platform: "zoom",
            startedAt: "2026-07-01T01:30:00.000Z",
          }),
          hasRecallBot: true,
          status: "scheduled" as const,
        },
        {
          ...libraryMeeting({
            id: "33333333-3333-4333-8333-333333333333",
            title: "Test",
            platform: "zoom",
            startedAt: "2026-07-01T01:30:00.000Z",
          }),
          hasRecallBot: true,
          status: "scheduled" as const,
        },
        {
          ...libraryMeeting({
            id: "44444444-4444-4444-8444-444444444444",
            title: "Internal Meeting - Investment Strategy",
            platform: "zoom",
            startedAt: "2026-07-21T02:00:00.000Z",
          }),
          hasRecallBot: true,
          status: "scheduled" as const,
        },
        {
          ...libraryMeeting({
            id: "55555555-5555-4555-8555-555555555555",
            title: "Internal Meeting - Investment Strategy",
            platform: "zoom",
            startedAt: "2026-06-30T02:00:00.000Z",
          }),
          status: "ready" as const,
          transcriptJobStatus: "completed" as const,
        },
      ],
      {
        now: new Date("2026-06-30T03:00:00.000Z"),
        sort: "smart",
      },
    );

    expect(page.meetings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "55555555-5555-4555-8555-555555555555",
          title: "Internal Meeting - Investment Strategy",
          status: "ready",
        }),
      ]),
    );
  });

  it("keeps duplicate meeting titles flat for explicit time sorting", async () => {
    const { buildMeetingLibraryPage } = await import("@/lib/meeting-queries");

    const page = buildMeetingLibraryPage(
      [
        libraryMeeting({
          id: "11111111-1111-4111-8111-111111111111",
          title: "David <> YP",
          platform: "zoom",
          startedAt: "2026-06-27T10:00:00.000Z",
        }),
        libraryMeeting({
          id: "22222222-2222-4222-8222-222222222222",
          title: "David <> YP",
          platform: "zoom",
          startedAt: "2026-06-28T10:00:00.000Z",
        }),
      ],
      {
        now: new Date("2026-06-28T12:00:00.000Z"),
        sort: "time_desc",
      },
    );

    expect(page.meetings).toHaveLength(2);
    expect(page.meetings[0]?.relatedMeetings).toEqual([]);
    expect(page.meetings[1]?.relatedMeetings).toEqual([]);
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
        libraryMeeting({
          id: "33333333-3333-4333-8333-333333333333",
          title: "Transcript only upload",
          platform: "upload",
          startedAt: "2026-06-27T11:00:00.000Z",
          durationMs: 120 * 60 * 1000,
        }),
      ],
      {
        now: new Date("2026-06-28T12:00:00.000Z"),
        sort: "duration_desc",
      },
    );

    expect(page.meetings.map((meeting) => meeting.title)).toEqual([
      "Transcript only upload",
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

  it("filters visible library meetings by missed bot joins", async () => {
    const { buildMeetingLibraryPage } = await import("@/lib/meeting-queries");

    const page = buildMeetingLibraryPage(
      [
        {
          ...libraryMeeting({
            id: "11111111-1111-4111-8111-111111111111",
            title: "Missed bot join",
            platform: "zoom",
            startedAt: "2026-06-27T12:00:00.000Z",
          }),
          status: "missed" as const,
        },
        libraryMeeting({
          id: "22222222-2222-4222-8222-222222222222",
          title: "Ready transcript",
          platform: "google_meet",
          startedAt: "2026-06-27T11:00:00.000Z",
        }),
      ],
      {
        now: new Date("2026-06-28T12:00:00.000Z"),
        status: "missed",
      },
    );

    expect(page.meetings.map((meeting) => meeting.title)).toEqual([
      "Missed bot join",
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
    const segmentWhere = vi.fn().mockResolvedValue([]);

    select
      .mockReturnValueOnce({
        from: () => ({
          where: vi.fn().mockResolvedValue([
          {
            id: "11111111-1111-4111-8111-111111111111",
            title: "Founder intro",
            status: "scheduled",
            transcriptJobStatus: null,
            recallBotId: "bot_123",
            startedAt: new Date("2999-01-01T14:00:00.000Z"),
            createdAt: new Date("2026-06-27T10:00:00.000Z"),
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            title: "Uncovered partner sync",
            status: "scheduled",
            transcriptJobStatus: null,
            recallBotId: null,
            startedAt: new Date("2999-01-01T15:00:00.000Z"),
            createdAt: new Date("2026-06-27T10:00:00.000Z"),
          },
          {
            id: "33333333-3333-4333-8333-333333333333",
            title: "Ready transcript",
            status: "ready",
            transcriptJobStatus: null,
            recallBotId: "bot_456",
            startedAt: new Date("2026-06-27T10:00:00.000Z"),
            createdAt: new Date("2026-06-27T10:00:00.000Z"),
          },
          {
            id: "44444444-4444-4444-8444-444444444444",
            title: "Failed recording",
            status: "failed",
            transcriptJobStatus: null,
            recallBotId: "bot_789",
            startedAt: new Date("2026-06-27T09:00:00.000Z"),
            createdAt: new Date("2026-06-27T09:00:00.000Z"),
          },
          {
            id: "55555555-5555-4555-8555-555555555555",
            title: "Cancelled partner sync",
            status: "cancelled",
            transcriptJobStatus: null,
            recallBotId: null,
            startedAt: new Date("2026-06-27T08:00:00.000Z"),
            createdAt: new Date("2026-06-27T08:00:00.000Z"),
          },
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          innerJoin: () => ({
            where: segmentWhere,
          }),
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

    expectUsesCurrentTranscriptJob(segmentWhere.mock.calls[0][0]);
  });

  it("builds user stats from transcript segments", async () => {
    select
      .mockReturnValueOnce({
        from: () => ({
          where: vi.fn().mockResolvedValue([
            {
              id: "11111111-1111-4111-8111-111111111111",
              title: "Current founder call",
              status: "ready",
              transcriptJobStatus: null,
              recallBotId: null,
              startedAt: new Date("2026-06-27T10:00:00.000Z"),
              createdAt: new Date("2026-06-27T10:00:00.000Z"),
            },
            {
              id: "22222222-2222-4222-8222-222222222222",
              title: "Previous review",
              status: "ready",
              transcriptJobStatus: null,
              recallBotId: null,
              startedAt: new Date("2026-06-18T10:00:00.000Z"),
              createdAt: new Date("2026-06-18T10:00:00.000Z"),
            },
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          innerJoin: () => ({
            where: vi.fn().mockResolvedValue([
              {
                meetingId: "11111111-1111-4111-8111-111111111111",
                speaker: "Test",
                startMs: 0,
                endMs: 10000,
                text: "one two three four",
                emotionLabel: "chill",
              },
              {
                meetingId: "11111111-1111-4111-8111-111111111111",
                speaker: "Founder",
                startMs: 10000,
                endMs: 30000,
                text: "one two three four five six",
                emotionLabel: "hard",
              },
              {
                meetingId: "22222222-2222-4222-8222-222222222222",
                speaker: "Test",
                startMs: 0,
                endMs: 8000,
                text: "one two",
                emotionLabel: "neutral",
              },
            ]),
          }),
        }),
      });
    const { getMeetingDashboardSummaryForWorkspace } = await import(
      "@/lib/meeting-queries"
    );

    await expect(
      getMeetingDashboardSummaryForWorkspace(
        {
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "11111111-1111-4111-8111-111111111111",
          domain: "example.com",
        },
        {
          now: new Date("2026-06-28T12:00:00.000Z"),
          userEmail: "test@iosg.vc",
          userName: "Test",
        },
      ),
    ).resolves.toMatchObject({
      userStats: {
        last7DaysMeetings: 1,
        previous7DaysMeetings: 1,
        meetingChangePercent: 0,
        meetingHours: 0,
        spokenWords: 4,
        talkSharePercent: 33,
        dominantEmotion: "hard",
      },
    });
  });
});

function meetingRow(overrides: {
  id: string;
  title: string;
  status:
    | "scheduled"
    | "recording"
    | "processing"
    | "ready"
    | "failed"
    | "missed";
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
  durationMs?: number;
  externalParticipantKeys?: string[];
  participantCount?: number;
  primaryEntity?: string;
  status?:
    | "scheduled"
    | "recording"
    | "processing"
    | "ready"
    | "failed"
    | "missed"
    | "cancelled";
}) {
  return {
    id: overrides.id,
    title: overrides.title,
    platform: overrides.platform,
    status: overrides.status ?? "ready",
    transcriptJobStatus: null,
    hasRecallBot: false,
    startedAt: overrides.startedAt,
    endedAt: overrides.endedAt ?? null,
    durationMs: overrides.durationMs,
    externalParticipantKeys: overrides.externalParticipantKeys ?? [],
    participantCount: overrides.participantCount,
    primaryEntity: overrides.primaryEntity ?? null,
    accessScope: "workspace" as const,
    relatedMeetings: [],
  };
}
