import { afterEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const {
  getCurrentUser,
  getWorkspace,
  limit,
  reconcileMeetingSharingForMeeting,
  revokeMeetingSharesSeededByMeeting,
  deleteMeeting,
  selectWhere,
  updateMeeting,
  where,
} =
  vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    getWorkspace: vi.fn(),
    limit: vi.fn(),
    reconcileMeetingSharingForMeeting: vi.fn(),
    revokeMeetingSharesSeededByMeeting: vi.fn(),
    deleteMeeting: vi.fn(),
    selectWhere: vi.fn(),
    updateMeeting: vi.fn(),
    where: vi.fn(),
  }));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

vi.mock("@/lib/meeting-share-rules", () => ({
  reconcileMeetingSharingForMeeting,
}));

vi.mock("@/lib/meeting-share-service", () => ({
  revokeMeetingSharesSeededByMeeting,
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: selectWhere.mockImplementation(() => ({
          limit,
        })),
      }),
    }),
    delete: deleteMeeting,
    update: updateMeeting,
  },
}));

const dialect = new PgDialect();

function toQuery(condition: SQL) {
  return dialect.sqlToQuery(condition);
}

async function deleteMeetingRequest() {
  const { DELETE } = await import("@/app/api/meetings/[meetingId]/route");

  return DELETE(
    new Request(
      "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111",
      { method: "DELETE" },
    ),
    {
      params: Promise.resolve({
        meetingId: "11111111-1111-4111-8111-111111111111",
      }),
    },
  );
}

async function patchMeetingRequest(body: unknown) {
  const route = await import("@/app/api/meetings/[meetingId]/route");
  const patch = (route as Record<string, unknown>).PATCH;

  expect(patch).toBeTypeOf("function");

  if (typeof patch !== "function") {
    throw new Error("PATCH handler missing");
  }

  return patch(
    new Request(
      "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111",
      {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
        },
      },
    ),
    {
      params: Promise.resolve({
        meetingId: "11111111-1111-4111-8111-111111111111",
      }),
    },
  ) as Promise<Response>;
}

describe("DELETE /api/meetings/[meetingId]", () => {
  afterEach(() => {
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    limit.mockReset();
    deleteMeeting.mockReset();
    selectWhere.mockReset();
    updateMeeting.mockReset();
    where.mockReset();
    vi.resetModules();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await deleteMeetingRequest();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(deleteMeeting).not.toHaveBeenCalled();
  });

  it("deletes an authenticated workspace meeting", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111" }]);
    deleteMeeting.mockReturnValue({ where });
    where.mockResolvedValue(undefined);

    const response = await deleteMeetingRequest();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true });
    expect(revokeMeetingSharesSeededByMeeting).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(deleteMeeting).toHaveBeenCalled();
    expect(where).toHaveBeenCalled();
    const query = toQuery(selectWhere.mock.calls[0][0]);
    expect(query.sql).toContain('"meetings"."owner_user_id"');
    expect(query.sql).toContain('"team_memberships"');
  });
});

describe("PATCH /api/meetings/[meetingId]", () => {
  afterEach(() => {
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    limit.mockReset();
    selectWhere.mockReset();
    updateMeeting.mockReset();
    where.mockReset();
    vi.resetModules();
  });

  it("renames an authenticated workspace meeting", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111" }]);
    const updateSet = vi.fn().mockReturnValue({ where });
    updateMeeting.mockReturnValue({
      set: updateSet,
    });
    where.mockResolvedValue(undefined);

    const response = await patchMeetingRequest({ title: "New weekly sync" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      meetingId: "11111111-1111-4111-8111-111111111111",
      title: "New weekly sync",
    });
    expect(reconcileMeetingSharingForMeeting).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(updateMeeting).toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New weekly sync",
        titleSource: "manual",
      }),
    );
    expect(where).toHaveBeenCalled();
    const query = toQuery(selectWhere.mock.calls[0][0]);
    expect(query.sql).toContain('"meetings"."owner_user_id"');
    expect(query.sql).toContain('"team_memberships"');
  });
});
