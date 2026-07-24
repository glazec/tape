import { afterEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => {
  function sqlTag() {
    const tag = vi.fn(
      (strings: TemplateStringsArray, ...params: unknown[]) => ({
        params,
        strings: [...strings],
      }),
    );

    return Object.assign(tag, {
      transaction: vi.fn(),
    });
  }

  const administrativeSql = sqlTag();
  const authenticatedSql = sqlTag();
  authenticatedSql.transaction.mockImplementation((buildQueries) => {
    const queries = Array.isArray(buildQueries)
      ? buildQueries
      : buildQueries(authenticatedSql);

    return Promise.resolve([
      null,
      ...queries.slice(1).map(() => ({ rows: [{ id: "raw-tenant-row" }] })),
    ]);
  });
  const setClaimsQuery = { _prepare: vi.fn(), kind: "claims" };
  const tenantQuery = {
    _prepare: vi.fn(),
    from: vi.fn(),
    kind: "tenant-query",
  };
  tenantQuery.from.mockReturnValue(tenantQuery);
  const administrativeDb = {
    execute: vi.fn(),
    select: vi.fn(),
  };
  const authenticatedDb = {
    batch: vi.fn().mockResolvedValue([null, [{ id: "tenant-row" }]]),
    execute: vi.fn().mockReturnValue(setClaimsQuery),
    select: vi.fn().mockReturnValue(tenantQuery),
  };

  return {
    administrativeDb,
    administrativeSql,
    authenticatedDb,
    authenticatedSql,
    setClaimsQuery,
    tenantQuery,
  };
});

vi.mock("@neondatabase/serverless", () => ({
  neon: vi.fn((url: string) =>
    url.includes("authenticated")
      ? fixtures.authenticatedSql
      : fixtures.administrativeSql,
  ),
}));

vi.mock("drizzle-orm/neon-http", () => ({
  drizzle: vi.fn((client: unknown) =>
    client === fixtures.authenticatedSql
      ? fixtures.authenticatedDb
      : fixtures.administrativeDb,
  ),
}));

describe("database RLS client", () => {
  afterEach(async () => {
    const { clearDatabaseClaims } = await import("@/db/rls-context");
    clearDatabaseClaims();
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
    fixtures.tenantQuery.from.mockReturnValue(fixtures.tenantQuery);
    fixtures.authenticatedDb.execute.mockReturnValue(fixtures.setClaimsQuery);
    fixtures.authenticatedDb.batch.mockResolvedValue([
      null,
      [{ id: "tenant-row" }],
    ]);
  });

  it("sets verified claims in the same transaction as an ORM query", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://admin:password@localhost:5432/tape",
    );
    vi.stubEnv(
      "DATABASE_AUTHENTICATED_URL",
      "postgresql://authenticated:password@localhost:5432/tape",
    );
    const { setDatabaseSessionUser } = await import("@/db/rls-context");
    setDatabaseSessionUser({
      email: "Member@Example.com",
      id: "auth-user-1",
      name: "Member",
    });
    const { databaseSql, db } = await import("@/db/client");

    await expect(
      db.select().from({} as never),
    ).resolves.toEqual([{ id: "tenant-row" }]);

    expect(fixtures.authenticatedDb.batch).toHaveBeenCalledWith([
      fixtures.setClaimsQuery,
      fixtures.tenantQuery,
    ]);
    expect(fixtures.authenticatedDb.execute).toHaveBeenCalledOnce();
    expect(fixtures.administrativeDb.select).not.toHaveBeenCalled();

    await expect(databaseSql`select id from meetings`).resolves.toEqual({
      rows: [{ id: "raw-tenant-row" }],
    });
    expect(fixtures.authenticatedSql.transaction).toHaveBeenCalledOnce();
  });
});
