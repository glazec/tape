import { afterEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  auth: {
    getSession,
  },
}));

describe("getCurrentUser", () => {
  afterEach(() => {
    getSession.mockReset();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns null when Neon Auth has no session user", async () => {
    getSession.mockResolvedValue({ data: null, error: null });

    const { getCurrentUser } = await import("@/lib/auth");

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("returns null when Neon Auth session lookup fails", async () => {
    getSession.mockRejectedValue(new Error("auth unavailable"));

    const { getCurrentUser } = await import("@/lib/auth");

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("maps Neon Auth session users to application session users", async () => {
    const { sessionUserFromAuthUser } = await import("@/lib/auth");

    expect(
      sessionUserFromAuthUser({
        id: "user-1",
        email: "alice@example.com",
        name: "Alice",
      }),
    ).toEqual({
      id: "user-1",
      email: "alice@example.com",
      name: "Alice",
    });
  });

  it("returns null when Neon Auth users lack id or email", async () => {
    const { sessionUserFromAuthUser } = await import("@/lib/auth");

    expect(sessionUserFromAuthUser({ id: "user-1" })).toBeNull();
    expect(sessionUserFromAuthUser({ email: "alice@example.com" })).toBeNull();
  });

  it("returns the current Neon Auth session user", async () => {
    getSession.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "alice@example.com",
          name: "Alice",
        },
      },
      error: null,
    });

    const { getCurrentUser } = await import("@/lib/auth");

    await expect(getCurrentUser()).resolves.toEqual({
      id: "user-1",
      email: "alice@example.com",
      name: "Alice",
    });
  });
});

describe("Neon Auth configuration", () => {
  it("derives the Auth base URL from the configured JWKS URL", async () => {
    const { getNeonAuthBaseUrl } = await import("@/lib/auth-config");

    expect(
      getNeonAuthBaseUrl({
        NEON_AUTH_JWKS_URL:
          "https://ep-example.neonauth.us-east-1.aws.neon.tech/neondb/auth/.well-known/jwks.json",
      }),
    ).toBe("https://ep-example.neonauth.us-east-1.aws.neon.tech/neondb/auth");
  });

  it("prefers an explicit Auth base URL when one is configured", async () => {
    const { getNeonAuthBaseUrl } = await import("@/lib/auth-config");

    expect(
      getNeonAuthBaseUrl({
        NEON_AUTH_BASE_URL: "https://auth.example.com/custom/auth",
        NEON_AUTH_JWKS_URL:
          "https://ep-example.neonauth.us-east-1.aws.neon.tech/neondb/auth/.well-known/jwks.json",
      }),
    ).toBe("https://auth.example.com/custom/auth");
  });

  it("rejects incomplete Auth configuration", async () => {
    const { getNeonAuthBaseUrl, getNeonAuthCookieSecret } = await import(
      "@/lib/auth-config"
    );

    expect(() => getNeonAuthBaseUrl({})).toThrow("NEON_AUTH_JWKS_URL is required");
    expect(() => getNeonAuthBaseUrl({
      NEON_AUTH_JWKS_URL: "https://auth.example.com/wrong-path",
    })).toThrow("NEON_AUTH_JWKS_URL must end with /.well-known/jwks.json");
    expect(() => getNeonAuthCookieSecret({
      NEON_AUTH_COOKIE_SECRET: "too-short",
    })).toThrow("NEON_AUTH_COOKIE_SECRET must be at least 32 characters");
  });
});
