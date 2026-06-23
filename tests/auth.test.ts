import { afterEach, describe, expect, it, vi } from "vitest";

const getCookie = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: getCookie,
  })),
}));

describe("getCurrentUser", () => {
  afterEach(() => {
    getCookie.mockReset();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns null without requiring env when no session cookie exists", async () => {
    getCookie.mockReturnValue(undefined);
    vi.stubEnv("NEON_AUTH_JWKS_URL", "");
    vi.stubEnv("NEON_AUTH_ISSUER", "");

    const { getCurrentUser } = await import("@/lib/auth");

    await expect(getCurrentUser()).resolves.toBeNull();
  });
});
