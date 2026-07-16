import { afterEach, describe, expect, it, vi } from "vitest";

const {
  assertCanCreateMeetings,
  disconnectGoogleCalendarForWorkspace,
  getCurrentUser,
  getWorkspace,
} = vi.hoisted(() => ({
  assertCanCreateMeetings: vi.fn(),
  disconnectGoogleCalendarForWorkspace: vi.fn(),
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/google-calendar-oauth", () => ({
  disconnectGoogleCalendarForWorkspace,
}));

vi.mock("@/lib/workspace", () => ({
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

async function disconnectCalendar() {
  const { POST } = await import("@/app/api/calendar/disconnect/route");

  return POST();
}

describe("POST /api/calendar/disconnect", () => {
  afterEach(() => {
    assertCanCreateMeetings.mockReset();
    disconnectGoogleCalendarForWorkspace.mockReset();
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    vi.resetModules();
  });

  it("returns 401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await disconnectCalendar();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(disconnectGoogleCalendarForWorkspace).not.toHaveBeenCalled();
  });

  it("disconnects the authenticated user's calendar", async () => {
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
    disconnectGoogleCalendarForWorkspace.mockResolvedValue(true);

    const response = await disconnectCalendar();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ disconnected: true });
    expect(disconnectGoogleCalendarForWorkspace).toHaveBeenCalledWith(workspace);
  });

  it("rejects shared only users", async () => {
    const { SharedOnlyAccessError } = await import("@/lib/access-errors");

    getCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "reader@partner.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      userId: "11111111-1111-4111-8111-111111111111",
      teamId: "22222222-2222-4222-8222-222222222222",
      domain: "partner.com",
      canCreateMeetings: false,
    });
    assertCanCreateMeetings.mockRejectedValue(new SharedOnlyAccessError());

    const response = await disconnectCalendar();

    expect(response.status).toBe(403);
    expect(disconnectGoogleCalendarForWorkspace).not.toHaveBeenCalled();
  });

  it("reports provider failures without clearing the connection", async () => {
    getCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "alice@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      userId: "11111111-1111-4111-8111-111111111111",
      teamId: "22222222-2222-4222-8222-222222222222",
      domain: "example.com",
    });
    assertCanCreateMeetings.mockResolvedValue(undefined);
    disconnectGoogleCalendarForWorkspace.mockRejectedValue(
      new Error("Recall calendar deletion failed with 502 Bad Gateway"),
    );

    const response = await disconnectCalendar();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Calendar disconnect unavailable",
    });
  });
});
