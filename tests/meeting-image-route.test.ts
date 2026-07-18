import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  createReadUrl,
  getCurrentUser,
  getWorkspace,
  limit,
  where,
} = vi.hoisted(() => ({
  createReadUrl: vi.fn(),
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
  limit: vi.fn(),
  where: vi.fn(),
}));

where.mockImplementation(() => ({
  orderBy: () => ({
    limit,
  }),
}));

const dialect = new PgDialect();

function toQuery(condition: SQL) {
  return dialect.sqlToQuery(condition);
}

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

vi.mock("@/lib/r2", () => ({
  createReadUrl,
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where,
        }),
      }),
    }),
  },
}));

async function getMeetingImage(
  meetingId = "11111111-1111-4111-8111-111111111111",
  assetId = "22222222-2222-4222-8222-222222222222",
) {
  const { GET } = await import(
    "@/app/api/meetings/[meetingId]/images/[assetId]/route"
  );

  return GET(new Request(`https://app.example.com/api/meetings/${meetingId}/images/${assetId}`), {
    params: Promise.resolve({
      assetId,
      meetingId,
    }),
  });
}

describe("GET /api/meetings/[meetingId]/images/[assetId]", () => {
  afterEach(() => {
    createReadUrl.mockReset();
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    limit.mockReset();
    where.mockReset();
    where.mockImplementation(() => ({
      orderBy: () => ({
        limit,
      }),
    }));
    vi.resetModules();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await getMeetingImage();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(createReadUrl).not.toHaveBeenCalled();
  });

  it("redirects authenticated readers to a signed image URL", async () => {
    getCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      teamId: "team_123",
      userId: "user_123",
      domain: "example.com",
    });
    limit.mockResolvedValue([
      {
        objectKey:
          "teams/team_123/meetings/11111111-1111-4111-8111-111111111111/assets/screenshot_123.jpg",
      },
    ]);
    createReadUrl.mockResolvedValue("https://r2.example.com/screenshot.jpg");

    const response = await getMeetingImage();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://r2.example.com/screenshot.jpg",
    );
    expect(createReadUrl).toHaveBeenCalledWith({
      key: "teams/team_123/meetings/11111111-1111-4111-8111-111111111111/assets/screenshot_123.jpg",
    });
  });

  it("uses explicit share access for shared only users", async () => {
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
    limit.mockResolvedValue([]);

    const response = await getMeetingImage();

    expect(response.status).toBe(404);
    const query = toQuery(where.mock.calls[0][0] as SQL);
    expect(query.sql).not.toContain('"meetings"."team_id" =');
    expect(query.sql).toContain('"meeting_access"');
    expect(query.params).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "screenshot",
      "video_frame",
      "user_123",
      "user_123",
      "admin",
      "owner",
      true,
      "user_123",
      "external",
      "user_123",
    ]);
  });
});
