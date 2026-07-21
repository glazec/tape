import { afterEach, describe, expect, it, vi } from "vitest";

const { cookies } = vi.hoisted(() => ({ cookies: vi.fn() }));

vi.mock("next/headers", () => ({ cookies }));

import {
  getAdminImpersonatedUserId,
  getAdminImpersonationCookieOptions,
} from "@/lib/admin-access";

describe("admin access cookies", () => {
  afterEach(() => {
    cookies.mockReset();
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
});
