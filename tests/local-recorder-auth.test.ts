import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const deviceIdHash = createHash("sha256")
  .update("mac_123")
  .digest("base64url");

const {
  assertCanCreateMeetings,
  getCurrentUser,
  getWorkspace,
  innerJoin,
  limit,
  select,
  where,
} =
  vi.hoisted(() => ({
    assertCanCreateMeetings: vi.fn(),
    getCurrentUser: vi.fn(),
    getWorkspace: vi.fn(),
    innerJoin: vi.fn(),
    limit: vi.fn(),
    select: vi.fn(),
    where: vi.fn(),
  }));

vi.mock("@/db/client", () => ({
  db: {
    select,
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

describe("local recorder auth", () => {
  afterEach(() => {
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    assertCanCreateMeetings.mockReset();
    innerJoin.mockReset();
    limit.mockReset();
    select.mockReset();
    where.mockReset();
    vi.resetModules();
  });

  it("does not allow browser session auth for device API routes", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      teamId: "team_123",
      userId: "user_123",
    });

    const { getLocalRecorderWorkspace } = await import(
      "@/lib/local-recorder-auth"
    );
    const workspace = await getLocalRecorderWorkspace(
      new Request("https://app.example.com/api/local-recorder/missed-meetings"),
      "mac_123",
    );

    expect(workspace).toBeNull();
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(getWorkspace).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it("allows valid bearer device sessions for device API routes", async () => {
    select.mockReturnValue({
      from: () => ({
        innerJoin,
      }),
    });
    innerJoin.mockReturnValue({ where });
    where.mockReturnValue({ limit });
    limit.mockResolvedValue([
      {
        deviceIdHash,
        role: "member",
        teamId: "team_123",
        userId: "user_123",
      },
    ]);

    const { getLocalRecorderWorkspace } = await import(
      "@/lib/local-recorder-auth"
    );
    const workspace = await getLocalRecorderWorkspace(
      new Request("https://app.example.com/api/local-recorder/missed-meetings", {
        headers: {
          authorization: "Bearer token_123",
        },
      }),
      "mac_123",
    );

    expect(workspace).toEqual({
      canCreateMeetings: true,
      domain: "",
      teamId: "team_123",
      userId: "user_123",
    });
  });

  it("parses recorder version and permission readiness from device headers", async () => {
    select.mockReturnValue({
      from: () => ({
        innerJoin,
      }),
    });
    innerJoin.mockReturnValue({ where });
    where.mockReturnValue({ limit });
    limit.mockResolvedValue([
      {
        deviceIdHash,
        role: "member",
        teamId: "team_123",
        userId: "user_123",
      },
    ]);

    const { getLocalRecorderDeviceRequestContext } = await import(
      "@/lib/local-recorder-auth"
    );
    const context = await getLocalRecorderDeviceRequestContext(
      new Request("https://app.example.com/api/local-recorder/monitoring", {
        headers: {
          authorization: "Bearer token_123",
          "x-local-recorder-app-version": "0.2.0+abc123",
          "x-local-recorder-device-id": "mac_123",
          "x-local-recorder-permission-readiness": JSON.stringify({
            accessibility: "granted",
            ignored: "value",
            microphone: "granted",
            notifications: "denied",
            screenCapture: "granted",
            startAtLogin: "unknown",
          }),
        },
      }),
    );

    expect(context).toEqual({
      appVersion: "0.2.0+abc123",
      deviceId: "mac_123",
      ok: true,
      permissionReadiness: {
        accessibility: "granted",
        microphone: "granted",
        notifications: "denied",
        screenCapture: "granted",
        startAtLogin: "unknown",
      },
      workspace: {
        canCreateMeetings: true,
        domain: "",
        teamId: "team_123",
        userId: "user_123",
      },
    });
  });

  it("rejects a valid token presented by another recorder device", async () => {
    select.mockReturnValue({
      from: () => ({
        innerJoin,
      }),
    });
    innerJoin.mockReturnValue({ where });
    where.mockReturnValue({ limit });
    limit.mockResolvedValue([
      {
        deviceIdHash,
        role: "member",
        teamId: "team_123",
        userId: "user_123",
      },
    ]);

    const { getLocalRecorderDeviceRequestContext } = await import(
      "@/lib/local-recorder-auth"
    );
    const context = await getLocalRecorderDeviceRequestContext(
      new Request("https://app.example.com/api/local-recorder/monitoring", {
        headers: {
          authorization: "Bearer token_123",
          "x-local-recorder-device-id": "mac_stolen",
        },
      }),
    );

    expect(context).toEqual({
      error: "Unauthorized",
      ok: false,
      status: 401,
    });
  });

  it("rejects bearer device sessions after a user loses creator access", async () => {
    select.mockReturnValue({
      from: () => ({
        innerJoin,
      }),
    });
    innerJoin.mockReturnValue({ where });
    where.mockReturnValue({ limit });
    limit.mockResolvedValue([
      {
        deviceIdHash,
        role: "external",
        teamId: "team_123",
        userId: "user_123",
      },
    ]);

    const { getLocalRecorderWorkspace } = await import(
      "@/lib/local-recorder-auth"
    );
    const workspace = await getLocalRecorderWorkspace(
      new Request("https://app.example.com/api/local-recorder/missed-meetings", {
        headers: {
          authorization: "Bearer token_123",
        },
      }),
      "mac_123",
    );

    expect(workspace).toBeNull();
  });

  it("returns a controlled error for malformed device login callbacks", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });

    const { createLocalRecorderDeviceSession } = await import(
      "@/lib/local-recorder-auth"
    );

    await expect(
      createLocalRecorderDeviceSession({
        callbackUrl: "not a url",
        deviceId: "mac_123",
        requestUrl: "https://app.example.com/api/local-recorder/device-login",
      }),
    ).resolves.toEqual({ error: "Invalid callback" });
  });

  it("only redirects device login tokens to the Mac app login callback", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });

    const { createLocalRecorderDeviceSession } = await import(
      "@/lib/local-recorder-auth"
    );

    await expect(
      createLocalRecorderDeviceSession({
        callbackUrl: "meetingnote-local-recorder://settings",
        deviceId: "mac_123",
        requestUrl: "https://app.example.com/api/local-recorder/device-login",
      }),
    ).resolves.toEqual({ error: "Invalid callback" });
  });

  it("rejects shared only users before creating a device session", async () => {
    const { SharedOnlyAccessError } = await import("@/lib/access-errors");

    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "reader@partner.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      canCreateMeetings: false,
      domain: "partner.com",
      teamId: "team_123",
      userId: "user_123",
    });
    assertCanCreateMeetings.mockRejectedValue(new SharedOnlyAccessError());

    const { createLocalRecorderDeviceSession } = await import(
      "@/lib/local-recorder-auth"
    );

    await expect(
      createLocalRecorderDeviceSession({
        callbackUrl: "meetingnote-local-recorder://login",
        deviceId: "mac_123",
        requestUrl: "https://app.example.com/api/local-recorder/device-login",
      }),
    ).resolves.toEqual({
      error: "Shared users cannot add meetings",
      status: 403,
    });
  });
});
