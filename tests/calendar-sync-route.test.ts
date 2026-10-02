import { afterEach, describe, expect, it, vi } from "vitest";

const {
  send,
  assertCanCreateMeetings,
  getCurrentUser,
  getWorkspace,
  syncRecallCalendarEventsForWorkspace,
} =
  vi.hoisted(() => ({
    send: vi.fn(),
    assertCanCreateMeetings: vi.fn(),
    getCurrentUser: vi.fn(),
    getWorkspace: vi.fn(),
    syncRecallCalendarEventsForWorkspace: vi.fn(),
  }));

vi.mock("@/inngest/client", () => ({ inngest: { send } }));

class RecallCalendarConnectionError extends Error {}

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

vi.mock("@/lib/recall-calendar", () => ({
  RecallCalendarConnectionError,
  syncRecallCalendarEventsForWorkspace,
}));

async function postCalendarSync(body: unknown = { autoJoinEnabled: true }) {
  const { POST } = await import("@/app/api/calendar/sync/route");

  return POST(
    new Request("https://app.example.com/api/calendar/sync", {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
      },
    }),
  );
}

describe("POST /api/calendar/sync", () => {
  afterEach(() => {
    send.mockReset();
    assertCanCreateMeetings.mockReset();
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    syncRecallCalendarEventsForWorkspace.mockReset();
    vi.resetModules();
  });

  it("returns 401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await postCalendarSync();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(syncRecallCalendarEventsForWorkspace).not.toHaveBeenCalled();
  });

  it("captures upcoming Recall Calendar events for the authenticated user", async () => {
    const sessionUser = {
      id: "auth_user_123",
      email: "alice@example.com",
      name: null,
    };
    const workspace = {
      userId: "11111111-1111-4111-8111-111111111111",
      teamId: "22222222-2222-4222-8222-222222222222",
      domain: "example.com",
    };

    getCurrentUser.mockResolvedValue(sessionUser);
    getWorkspace.mockResolvedValue(workspace);
    assertCanCreateMeetings.mockResolvedValue(undefined);
    syncRecallCalendarEventsForWorkspace.mockResolvedValue({
      connectionId: "33333333-3333-4333-8333-333333333333",
      syncedEventCount: 2,
    });

    const response = await postCalendarSync({ autoJoinEnabled: true });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      historyRepairQueued: true,
      connectionId: "33333333-3333-4333-8333-333333333333",
      syncedEventCount: 2,
    });
    expect(send).toHaveBeenCalledWith({ name: "calendar/history.repair", data: {
      connectionId: "33333333-3333-4333-8333-333333333333",
      teamId: workspace.teamId, userId: workspace.userId, requestedAt: expect.any(String),
    } });
    expect(syncRecallCalendarEventsForWorkspace).toHaveBeenCalledWith({
      workspace,
      autoJoinEnabled: true,
    });
  });

  it("does not claim history is queued when the job dispatch fails", async () => {
    getCurrentUser.mockResolvedValue({ id: "auth-user", email: "alice@example.com" });
    getWorkspace.mockResolvedValue({ userId: "11111111-1111-4111-8111-111111111111", teamId: "22222222-2222-4222-8222-222222222222" });
    syncRecallCalendarEventsForWorkspace.mockResolvedValue({ connectionId: "33333333-3333-4333-8333-333333333333", syncedEventCount: 2 });
    send.mockRejectedValue(new Error("Queue unavailable"));
    const response = await postCalendarSync();
    expect(response.status).toBe(502);
    expect(await response.json()).not.toHaveProperty("historyRepairQueued");
  });

  it("returns a reconnect signal when calendar access is missing", async () => {
    const sessionUser = {
      id: "auth_user_123",
      email: "alice@example.com",
      name: null,
    };
    const workspace = {
      userId: "11111111-1111-4111-8111-111111111111",
      teamId: "22222222-2222-4222-8222-222222222222",
      domain: "example.com",
    };

    getCurrentUser.mockResolvedValue(sessionUser);
    getWorkspace.mockResolvedValue(workspace);
    assertCanCreateMeetings.mockResolvedValue(undefined);
    syncRecallCalendarEventsForWorkspace.mockRejectedValue(
      new RecallCalendarConnectionError(),
    );

    const response = await postCalendarSync({ autoJoinEnabled: true });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Calendar is not connected",
      reconnect: true,
    });
  });

  it("rejects shared only users before syncing Recall Calendar", async () => {
    const { SharedOnlyAccessError } = await import("@/lib/access-errors");
    const sessionUser = {
      id: "auth_user_123",
      email: "reader@partner.com",
      name: null,
    };
    const workspace = {
      userId: "11111111-1111-4111-8111-111111111111",
      teamId: "22222222-2222-4222-8222-222222222222",
      domain: "partner.com",
      canCreateMeetings: false,
    };

    getCurrentUser.mockResolvedValue(sessionUser);
    getWorkspace.mockResolvedValue(workspace);
    assertCanCreateMeetings.mockRejectedValue(new SharedOnlyAccessError());

    const response = await postCalendarSync({ autoJoinEnabled: true });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Shared users cannot add meetings",
    });
    expect(syncRecallCalendarEventsForWorkspace).not.toHaveBeenCalled();
  });
});
