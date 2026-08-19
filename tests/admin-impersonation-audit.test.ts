import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    execute,
  },
}));

describe("admin impersonation audit", () => {
  afterEach(() => {
    execute.mockReset();
    vi.resetModules();
  });

  it("casts the auth user ID used in JSON metadata", async () => {
    execute.mockResolvedValue(undefined);
    const { recordAdminImpersonationAudit } = await import(
      "@/lib/admin-impersonation"
    );

    await recordAdminImpersonationAudit({
      action: "admin_impersonation_started",
      actorAuthUserId: "auth_owner",
      targetUserId: "11111111-1111-4111-8111-111111111111",
    });

    const dialect = new PgDialect();
    const query = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);

    expect(query.sql).toContain(
      "jsonb_build_object('actorAuthUserId', $2::text)",
    );
    expect(query.params).toEqual([
      "admin_impersonation_started",
      "auth_owner",
      "auth_owner",
      "11111111-1111-4111-8111-111111111111",
    ]);
  });
});
