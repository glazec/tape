import { afterEach, describe, expect, it, vi } from "vitest";

describe("database environment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("parses and trims a valid database URL", async () => {
    vi.stubEnv("DATABASE_URL", "  postgresql://user:password@localhost:5432/tape  ");

    const { databaseEnv } = await import("@/lib/database-env");

    expect(databaseEnv.DATABASE_URL).toBe(
      "postgresql://user:password@localhost:5432/tape",
    );
  });
});
