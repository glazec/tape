import { afterEach, describe, expect, it, vi } from "vitest";

const { cookies, getSession, select } = vi.hoisted(() => ({
  cookies: vi.fn(),
  getSession: vi.fn(),
  select: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies,
}));

vi.mock("@/lib/auth/server", () => ({
  auth: {
    getSession,
  },
}));

vi.mock("@/db/client", () => ({
  db: {
    select,
  },
}));

function mockTargetUser(
  rows: Array<{ authUserId: string; email: string; name: string | null }>,
) {
  select.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

describe("admin impersonation", () => {
  afterEach(() => {
    cookies.mockReset();
    getSession.mockReset();
    select.mockReset();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns the selected user as the effective session for a configured admin", async () => {
    vi.stubEnv("APP_ADMIN_EMAILS", "owner@example.com");
    getSession.mockResolvedValue({
      data: {
        user: {
          id: "auth_owner",
          email: "owner@example.com",
          name: "Owner",
        },
      },
      error: null,
    });
    cookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "target_user_id" }),
    });
    mockTargetUser([
      {
        authUserId: "auth_target",
        email: "target@example.com",
        name: "Target",
      },
    ]);

    const { getCurrentUser } = await import("@/lib/auth");

    await expect(getCurrentUser()).resolves.toEqual({
      id: "auth_target",
      email: "target@example.com",
      name: "Target",
    });
  });

  it("ignores an impersonation cookie when the signed in user is not an admin", async () => {
    vi.stubEnv("APP_ADMIN_EMAILS", "owner@example.com");
    getSession.mockResolvedValue({
      data: {
        user: {
          id: "auth_member",
          email: "member@example.com",
          name: "Member",
        },
      },
      error: null,
    });
    cookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "target_user_id" }),
    });

    const { getCurrentUser } = await import("@/lib/auth");

    await expect(getCurrentUser()).resolves.toEqual({
      id: "auth_member",
      email: "member@example.com",
      name: "Member",
    });
    expect(select).not.toHaveBeenCalled();
  });

  it("keeps administrator database claims when an impersonation target is stale", async () => {
    vi.stubEnv("APP_ADMIN_EMAILS", "owner@example.com");
    getSession.mockResolvedValue({
      data: {
        user: {
          id: "auth_owner",
          email: "owner@example.com",
          name: "Owner",
        },
      },
      error: null,
    });
    cookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "missing_user_id" }),
    });
    mockTargetUser([]);

    const { getDatabaseClaimsJson } = await import("@/db/rls-context");
    const { getCurrentUser } = await import("@/lib/auth");

    await expect(getCurrentUser()).resolves.toEqual({
      id: "auth_owner",
      email: "owner@example.com",
      name: "Owner",
    });
    expect(JSON.parse(getDatabaseClaimsJson() ?? "{}")).toMatchObject({
      app_global_admin: true,
      sub: "auth_owner",
    });
  });
});
