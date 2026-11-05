import { afterEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const {
  getCurrentUser,
  getWorkspace,
  deleteMeetingMediaObjects,
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
    deleteMeetingMediaObjects: vi.fn(),
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

vi.mock("@/lib/meeting-media-cleanup", () => ({
  deleteMeetingMediaObjects,
}));

const { getComposedMeetingForFollowup } = vi.hoisted(() => ({
  getComposedMeetingForFollowup: vi.fn(),
}));

vi.mock("@/lib/meeting-composition", () => ({
  getComposedMeetingForFollowup,
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
    getComposedMeetingForFollowup.mockReset();
    getWorkspace.mockReset();
    deleteMeetingMediaObjects.mockReset();
    limit.mockReset();
    reconcileMeetingSharingForMeeting.mockReset();
    revokeMeetingSharesSeededByMeeting.mockReset();
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
    expect(deleteMeetingMediaObjects).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(deleteMeeting).toHaveBeenCalled();
    expect(where).toHaveBeenCalled();
    const query = toQuery(selectWhere.mock.calls[0][0]);
    expect(query.sql).toContain('"meetings"."owner_user_id"');
    expect(query.sql).not.toContain('"team_memberships"');
  });

  it("keeps the meeting when stored media cleanup fails", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111" }]);
    deleteMeetingMediaObjects.mockRejectedValue(new Error("R2 unavailable"));

    const response = await deleteMeetingRequest();

    expect(response.status).toBe(503);
    expect(deleteMeeting).not.toHaveBeenCalled();
    expect(revokeMeetingSharesSeededByMeeting).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/meetings/[meetingId]", () => {
  afterEach(() => {
    getCurrentUser.mockReset();
    getComposedMeetingForFollowup.mockReset();
    getWorkspace.mockReset();
    limit.mockReset();
    reconcileMeetingSharingForMeeting.mockReset();
    revokeMeetingSharesSeededByMeeting.mockReset();
    selectWhere.mockReset();
    updateMeeting.mockReset();
    where.mockReset();
    vi.resetModules();
  });

  it("carries a followup saved with the old title over to the new title", async () => {
    const { createHash } = await import("node:crypto");
    const { FOLLOWUP_PROMPT_VERSION } = await import("@/lib/meeting-followup");
    const { getCurrentMeetingFollowup, getFollowupSourceHash } = await import("@/lib/meeting-followup-source");
    const source = {
      title: "Old title",
      startedAt: "2026-10-22T14:00:00Z",
      segments: [{ id: "one", speaker: "Ada", startMs: 0, text: "We will ship it." }],
    };
    const result = { todos: [], dynamics: [], research: [] };
    const aiFollowup = {
      sourceHash: createHash("sha256").update(JSON.stringify([FOLLOWUP_PROMPT_VERSION, source])).digest("hex"),
      result,
    };
    getComposedMeetingForFollowup.mockResolvedValue({
      ...source, status: "ready", transcriptJobStatus: "completed", aiFollowup,
    });
    getCurrentUser.mockResolvedValue({ id: "user_123", email: "user@example.com", name: null });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111" }]);
    const updateSet = vi.fn().mockReturnValue({ where });
    updateMeeting.mockReturnValue({ set: updateSet });
    where.mockResolvedValue(undefined);

    const response = await patchMeetingRequest({ title: "New title" });

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ title: "New title" }));
    const upgraded = updateSet.mock.calls.find(([values]) => "aiFollowup" in values)?.[0].aiFollowup;
    expect(upgraded.sourceHash).toBe(getFollowupSourceHash(source));
    expect(getCurrentMeetingFollowup({
      ...source, title: "New title", status: "ready", transcriptJobStatus: "completed", aiFollowup: upgraded,
    })).toEqual(result);
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
