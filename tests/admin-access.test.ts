import { afterEach, describe, expect, it, vi } from "vitest";

const { cookies, limit, orderBy, select } = vi.hoisted(() => ({
  cookies: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  select: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/db/client", () => ({
  privilegedDb: {
    select,
  },
}));

import {
  getAdminImpersonatedUserId,
  getAdminImpersonationCookieOptions,
  isAdminSessionUser,
} from "@/lib/admin-access";

describe("admin access cookies", () => {
  afterEach(() => {
    cookies.mockReset();
    limit.mockReset();
    orderBy.mockReset();
    select.mockReset();
    vi.unstubAllEnvs();
  });

  it("ignores invalid and unavailable impersonation cookies", async () => {
    cookies.mockResolvedValueOnce({
      get: () => ({ value: "invalid user id" }),
    });
    await expect(getAdminImpersonatedUserId()).resolves.toBeNull();

    cookies.mockRejectedValueOnce(new Error("headers unavailable"));
    await expect(getAdminImpersonatedUserId()).resolves.toBeNull();
  });

  it("uses secure production cookie options", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(getAdminImpersonationCookieOptions()).toEqual({
      httpOnly: true,
      maxAge: 28_800,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });

  it("uses YiPing as the hosted default administrator", async () => {
    await expect(
      isAdminSessionUser({
        email: "yiping@iosg.vc",
        id: "auth_yiping",
        name: "YiPing",
      }),
    ).resolves.toBe(true);
    await expect(
      isAdminSessionUser({
        email: "member@iosg.vc",
        id: "auth_member",
        name: "Member",
      }),
    ).resolves.toBe(false);
  });

  it("uses the first registered user for a self hosted deployment", async () => {
    vi.stubEnv("APP_SELF_HOSTED", "true");
    select.mockReturnValue({
      from: () => ({ orderBy }),
    });
    orderBy.mockReturnValue({ limit });
    limit.mockResolvedValue([{ authUserId: "auth_first" }]);

    await expect(
      isAdminSessionUser({
        email: "owner@example.com",
        id: "auth_first",
        name: "Owner",
      }),
    ).resolves.toBe(true);
    await expect(
      isAdminSessionUser({
        email: "member@example.com",
        id: "auth_member",
        name: "Member",
      }),
    ).resolves.toBe(false);
  });
});
