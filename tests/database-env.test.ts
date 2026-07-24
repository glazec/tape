import { afterEach, describe, expect, it, vi } from "vitest";

describe("database environment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("parses and trims a valid database URL", async () => {
    vi.stubEnv("DATABASE_URL", "  postgresql://user:password@localhost:5432/tape  ");
    vi.stubEnv(
      "DATABASE_AUTHENTICATED_URL",
      "  postgresql://app:password@localhost:5432/tape  ",
    );

    const { databaseEnv } = await import("@/lib/database-env");

    expect(databaseEnv.DATABASE_URL).toBe(
      "postgresql://user:password@localhost:5432/tape",
    );
    expect(databaseEnv.DATABASE_AUTHENTICATED_URL).toBe(
      "postgresql://app:password@localhost:5432/tape",
    );
  });

  it("falls back to the administrative URL outside deployment validation", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://user:password@localhost:5432/tape",
    );
    vi.stubEnv("DATABASE_AUTHENTICATED_URL", "");

    const { databaseEnv } = await import("@/lib/database-env");

    expect(databaseEnv.DATABASE_AUTHENTICATED_URL).toBe(databaseEnv.DATABASE_URL);
  });

  it.each([
    ["Vercel", "VERCEL_ENV", "preview"],
    ["self hosted production", "NODE_ENV", "production"],
  ])("fails closed on %s when the authenticated URL is missing", async (
    _name,
    variable,
    value,
  ) => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://user:password@localhost:5432/tape",
    );
    vi.stubEnv("DATABASE_AUTHENTICATED_URL", "");
    vi.stubEnv(variable, value);

    await expect(import("@/lib/database-env")).rejects.toThrow(
      "DATABASE_AUTHENTICATED_URL is required for production deployments",
    );
  });
});
