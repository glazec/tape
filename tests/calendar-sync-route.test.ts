import { afterEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, getWorkspace, syncGooglePrimaryCalendarEvents } =
  vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    getWorkspace: vi.fn(),
    syncGooglePrimaryCalendarEvents: vi.fn(),
  }));

class GoogleCalendarAccessTokenError extends Error {}
class GoogleCalendarFetchError extends Error {
  constructor(readonly status: number) {
    super("Google Calendar fetch failed");
  }
}

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

vi.mock("@/lib/google-calendar", () => ({
  GoogleCalendarAccessTokenError,
  GoogleCalendarFetchError,
  syncGooglePrimaryCalendarEvents,
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
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    syncGooglePrimaryCalendarEvents.mockReset();
    vi.resetModules();
  });

  it("returns 401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await postCalendarSync();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(syncGooglePrimaryCalendarEvents).not.toHaveBeenCalled();
  });

  it("captures upcoming Google Calendar events for the authenticated user", async () => {
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
    syncGooglePrimaryCalendarEvents.mockResolvedValue({
      connectionId: "33333333-3333-4333-8333-333333333333",
      syncedEventCount: 2,
    });

    const response = await postCalendarSync({ autoJoinEnabled: true });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      connectionId: "33333333-3333-4333-8333-333333333333",
      syncedEventCount: 2,
    });
    expect(syncGooglePrimaryCalendarEvents).toHaveBeenCalledWith({
      sessionUser,
      workspace,
      autoJoinEnabled: true,
    });
  });

  it("returns a reconnect signal when Google Calendar access is missing", async () => {
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
    syncGooglePrimaryCalendarEvents.mockRejectedValue(
      new GoogleCalendarAccessTokenError(),
    );

    const response = await postCalendarSync({ autoJoinEnabled: true });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Google Calendar access is not connected",
      reconnect: true,
    });
  });

  it("returns a reconnect signal when Google rejects calendar permission", async () => {
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
    syncGooglePrimaryCalendarEvents.mockRejectedValue(
      new GoogleCalendarFetchError(403),
    );

    const response = await postCalendarSync({ autoJoinEnabled: true });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Google Calendar access is not connected",
      reconnect: true,
    });
  });
});
