import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, getWorkspace, select } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
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

async function getMeetingExport(
  url = "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111/export",
) {
  const { GET } = await import("@/app/api/meetings/[meetingId]/export/route");

  return GET(
    new Request(url),
    {
      params: Promise.resolve({
        meetingId: "11111111-1111-4111-8111-111111111111",
      }),
    },
  );
}

describe("GET /api/meetings/[meetingId]/export", () => {
  afterEach(() => {
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    select.mockReset();
    vi.resetModules();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await getMeetingExport();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(select).not.toHaveBeenCalled();
  });

  it("exports transcript text for an authenticated workspace meeting", async () => {
    const segmentWhere = vi.fn((condition: SQL) => {
      void condition;

      return {
        orderBy: vi.fn().mockResolvedValue([
          {
            speaker: "Speaker 1",
            startMs: 20000,
            endMs: 23000,
            text: "We should ship this update now.",
            emotionLabel: "hard",
          },
          {
            speaker: null,
            startMs: 80500,
            endMs: null,
            text: "Second line.",
            emotionLabel: null,
          },
        ]),
      };
    });

    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });

    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([
              {
                id: "11111111-1111-4111-8111-111111111111",
                title: "Nascent Sync",
              },
            ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: segmentWhere,
        }),
      });

    const response = await getMeetingExport();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("content-disposition")).toContain(
      "Nascent Sync transcript.txt",
    );
    const body = await response.text();

    expect(body).toContain(
      "[0:20] Speaker 1 | emotion: Hard | wpm: 120: We should ship this update now.",
    );
    expect(body).toContain(
      "[1:20] Unknown speaker | emotion: unknown | wpm: unknown: Second line.",
    );
    expect(select).toHaveBeenCalledTimes(2);
    const segmentQuery = toQuery(segmentWhere.mock.calls[0][0]);
    expect(segmentQuery.sql).toContain('"transcript_segments"."job_id"');
    expect(segmentQuery.sql).toContain('"transcript_jobs"');
    expect(segmentQuery.sql).toContain('"transcript_jobs"."status" = \'completed\'');
  });

  it("exports Chinese transcript text when requested", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });

    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([
              {
                id: "11111111-1111-4111-8111-111111111111",
                title: "Nascent Sync",
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
                speaker: "Speaker 1",
                startMs: 20000,
                endMs: 23000,
                text: "First line.",
                translatedText: "第一句。",
                emotionLabel: "neutral",
              },
              {
                speaker: null,
                startMs: 80500,
                endMs: null,
                text: "Second line.",
                translatedText: null,
                emotionLabel: null,
              },
            ]),
          }),
        }),
      });

    const response = await getMeetingExport(
      "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111/export?format=text&language=zh",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      "Nascent Sync Chinese transcript.txt",
    );
    await expect(response.text()).resolves.toContain(
      "[0:20] Speaker 1 | emotion: Neutral | wpm: 40: 第一句。",
    );
  });

  it("uses the next segment timestamp for wpm when segment end time is missing", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });

    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([
              {
                id: "11111111-1111-4111-8111-111111111111",
                title: "Nascent Sync",
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
                speaker: "Speaker 1",
                startMs: 20000,
                endMs: null,
                text: "Follow up now.",
                translatedText: null,
                emotionLabel: "neutral",
              },
              {
                speaker: "Speaker 2",
                startMs: 26000,
                endMs: null,
                text: "Done.",
                translatedText: null,
                emotionLabel: "chill",
              },
            ]),
          }),
        }),
      });

    const response = await getMeetingExport();

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain(
      "[0:20] Speaker 1 | emotion: Neutral | wpm: 30: Follow up now.",
    );
  });

  it("uses explicit share access for shared only text exports", async () => {
    const where = vi.fn((condition: SQL) => {
      void condition;

      return {
        limit: vi.fn().mockResolvedValue([]),
      };
    });

    getCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "reader@partner.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      teamId: "guest_team_123",
      userId: "user_123",
      domain: "partner.com",
      canCreateMeetings: false,
    });
    select.mockReturnValueOnce({
      from: () => ({
        where,
      }),
    });

    const response = await getMeetingExport();

    expect(response.status).toBe(404);
    const query = toQuery(where.mock.calls[0][0]);
    expect(query.sql).not.toContain('"meetings"."team_id" =');
    expect(query.sql).toContain('"meeting_access"');
    expect(query.params).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "user_123",
    ]);
  });

  it("redirects MP3 exports to the authenticated meeting audio route", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });

    const response = await getMeetingExport(
      "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111/export?format=mp3",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111/audio?download=1",
    );
    expect(select).not.toHaveBeenCalled();
  });
});
