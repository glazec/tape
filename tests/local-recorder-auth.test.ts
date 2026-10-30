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
  insert,
  values,
  limit,
  select,
  where,
} =
  vi.hoisted(() => ({
    assertCanCreateMeetings: vi.fn(),
    getCurrentUser: vi.fn(),
    getWorkspace: vi.fn(),
    innerJoin: vi.fn(),
    insert: vi.fn(),
    values: vi.fn(),
    limit: vi.fn(),
    select: vi.fn(),
    where: vi.fn(),
  }));

vi.mock("@/db/client", () => ({
  db: {
    select,
    insert,
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

const { listOrganizationWorkspaces, selectOrganizationWorkspace } = vi.hoisted(() => ({
  listOrganizationWorkspaces: vi.fn(async () => []), selectOrganizationWorkspace: vi.fn(),
}));
vi.mock("@/lib/organization-workspaces", () => ({ listOrganizationWorkspaces, selectOrganizationWorkspace }));

describe("local recorder auth", () => {
  afterEach(() => {
    listOrganizationWorkspaces.mockReset().mockResolvedValue([]);
    selectOrganizationWorkspace.mockReset();
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    assertCanCreateMeetings.mockReset();
    innerJoin.mockReset();
    insert.mockReset();
    values.mockReset();
    vi.useRealTimers();
    limit.mockReset();
    select.mockReset();
    where.mockReset();
    vi.resetModules();
  });

  it("issues a device bound credential lasting 180 days from login", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-30T19:00:00Z");
    vi.setSystemTime(now);
    getCurrentUser.mockResolvedValue({ id: "auth", email: "person@example.com" });
    getWorkspace.mockResolvedValue({ teamId: "team", userId: "user", canCreateMeetings: true });
    insert.mockReturnValue({ values });
    values.mockResolvedValue(undefined);
    const { createLocalRecorderDeviceSession } = await import("@/lib/local-recorder-auth");
    const result = await createLocalRecorderDeviceSession({
      callbackUrl: "meetingnote-local-recorder://login", deviceId: "mac_123",
      requestUrl: "https://app.example.com/api/local-recorder/device-login",
    });
    expect("redirectUrl" in result).toBe(true);
    if (!("redirectUrl" in result)) throw new Error("Missing device callback");
    const callback = new URL(result.redirectUrl);
    const token = callback.searchParams.get("token")!;
    expect(token).toBeTruthy();
    expect(values).toHaveBeenCalledWith({
      deviceIdHash, teamId: "team", userId: "user",
      tokenHash: createHash("sha256").update(token).digest("base64url"),
      expiresAt: new Date(now.getTime() + 180 * 86400_000),
    });
  });

  it("asks which organization to pair before issuing a recorder credential", async () => {
    getCurrentUser.mockResolvedValue({ id: "auth", email: "person@example.com" });
    getWorkspace.mockResolvedValue({ teamId: "first", userId: "user" });
    const organizations = [{ teamId: "first", teamName: "First" }, { teamId: "second", teamName: "Second" }];
    listOrganizationWorkspaces.mockResolvedValueOnce(organizations as never);
    const { createLocalRecorderDeviceSession } = await import("@/lib/local-recorder-auth");
    expect(await createLocalRecorderDeviceSession({ callbackUrl: "meetingnote-local-recorder://login", deviceId: "mac", requestUrl: "https://app.example.com" })).toEqual({ organizations });
    expect(selectOrganizationWorkspace).not.toHaveBeenCalled();
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
