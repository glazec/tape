import { afterEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedUser, getCurrentUser, isAdminSessionUser, redirect } =
  vi.hoisted(() => ({
    getAuthenticatedUser: vi.fn(),
    getCurrentUser: vi.fn(),
    isAdminSessionUser: vi.fn(),
    redirect: vi.fn((path: string) => {
      throw new Error(`redirect:${path}`);
    }),
  }));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser, getCurrentUser }));
vi.mock("@/lib/admin-access", () => ({ isAdminSessionUser }));

describe("auth guards", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns the signed in user", async () => {
    const user = { id: "user_123", email: "user@example.com" };
    getCurrentUser.mockResolvedValue(user);
    const { requireCurrentUser } = await import("@/lib/auth-guards");

    await expect(requireCurrentUser()).resolves.toBe(user);
  });

  it("redirects anonymous users to sign in", async () => {
    getCurrentUser.mockResolvedValue(null);
    const { requireCurrentUser } = await import("@/lib/auth-guards");

    await expect(requireCurrentUser()).rejects.toThrow(
      "redirect:/auth/sign-in",
    );
  });

  it("redirects signed in non admins to the dashboard", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "user_123" });
    isAdminSessionUser.mockResolvedValue(false);
    const { requireAdminUser } = await import("@/lib/auth-guards");

    await expect(requireAdminUser()).rejects.toThrow("redirect:/dashboard");
  });

  it("returns an authenticated admin", async () => {
    const user = { id: "admin_123" };
    getAuthenticatedUser.mockResolvedValue(user);
    isAdminSessionUser.mockResolvedValue(true);
    const { requireAdminUser } = await import("@/lib/auth-guards");

    await expect(requireAdminUser()).resolves.toBe(user);
  });
});
