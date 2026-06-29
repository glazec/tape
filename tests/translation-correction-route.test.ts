import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, getWorkspace, select, update } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { select, update },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

const dialect = new PgDialect();

function toQuery(condition: SQL) {
  return dialect.sqlToQuery(condition);
}

describe("PATCH /api/meetings/[meetingId]/segments/[segmentId]/translation", () => {
  afterEach(() => {
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    select.mockReset();
    update.mockReset();
    vi.resetModules();
  });

  it("updates a translated segment for a workspace meeting", async () => {
    getCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "member@iosg.vc",
      name: "Member",
    });
    getWorkspace.mockResolvedValue({
      userId: "user_123",
      teamId: "22222222-2222-4222-8222-222222222222",
      domain: "iosg.vc",
    });
    const segmentWhere = vi.fn((condition: SQL) => {
      void condition;

      return {
        limit: vi.fn().mockResolvedValue([{ id: "segment_123" }]),
      };
    });

    select.mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          where: segmentWhere,
        }),
      }),
    });
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    update.mockReturnValue({ set });

    const { PATCH } = await import(
      "@/app/api/meetings/[meetingId]/segments/[segmentId]/translation/route"
    );

    const response = await PATCH(
      new Request("https://app.example.com", {
        method: "PATCH",
        body: JSON.stringify({ translatedText: "修正后的翻译" }),
      }),
      {
        params: Promise.resolve({
          meetingId: "11111111-1111-4111-8111-111111111111",
          segmentId: "33333333-3333-4333-8333-333333333333",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        translatedText: "修正后的翻译",
        translationEditedAt: expect.any(Date),
      }),
    );

    const segmentQuery = toQuery(segmentWhere.mock.calls[0][0]);
    expect(segmentQuery.sql).toContain('"transcript_segments"."job_id"');
    expect(segmentQuery.sql).toContain('"transcript_jobs"');
    expect(segmentQuery.sql).toContain('"transcript_jobs"."status" = \'completed\'');
  });
});
