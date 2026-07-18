import { afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { execute, transaction } = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  databaseSql: { transaction },
  db: { execute },
}));

describe("meeting access grants", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("materializes a sourced grant for an existing user atomically", async () => {
    execute.mockResolvedValue({
      rows: [
        {
          email: "alice@example.com",
          id: "user_123",
          name: "Alice",
          pending: false,
        },
      ],
    });
    const { grantMeetingAccessByEmail } = await import(
      "@/lib/meeting-access-grants"
    );

    await expect(
      grantMeetingAccessByEmail({
        createdByUserId: "owner_123",
        email: "Alice@Example.com",
        meetingId: "meeting_123",
        role: "attendee",
        source: "participant",
        sourceId: "calendar",
      }),
    ).resolves.toMatchObject({ pending: false });
    expect(execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]).sql;
    expect(query).toContain("meeting_access_exclusions");
  });

  it("stores an email grant until the recipient signs in", async () => {
    execute.mockResolvedValue({
      rows: [
        {
          email: "newhire@example.com",
          id: null,
          name: null,
          pending: true,
        },
      ],
    });
    const { grantMeetingAccessByEmail } = await import(
      "@/lib/meeting-access-grants"
    );

    await expect(
      grantMeetingAccessByEmail({
        createdByUserId: "owner_123",
        email: "newhire@example.com",
        meetingId: "meeting_123",
        role: "attendee",
        source: "participant",
        sourceId: "calendar",
      }),
    ).resolves.toEqual({ email: "newhire@example.com", pending: true });
  });

  it("returns stable fallback user fields when the database omits its row", async () => {
    execute.mockResolvedValue({ rows: [] });
    const { grantMeetingAccessByEmail } = await import(
      "@/lib/meeting-access-grants"
    );

    await expect(
      grantMeetingAccessByEmail({
        createdByUserId: "owner_123",
        email: "Alice@Example.com",
        meetingId: "meeting_123",
        role: "shared",
        source: "manual",
        sourceId: "manual-share",
      }),
    ).resolves.toEqual({
      pending: false,
      user: {
        email: "alice@example.com",
        id: "owner_123",
        name: null,
      },
    });
  });

  it("reconciles effective access and pending invites in one transaction", async () => {
    const txn = vi.fn((strings: TemplateStringsArray) => strings.join("?"));
    transaction.mockImplementation(
      async (callback: (transaction: typeof txn) => unknown) => callback(txn),
    );
    const { reconcileEffectiveMeetingAccess } = await import(
      "@/lib/meeting-access-grants"
    );

    await reconcileEffectiveMeetingAccess("meeting_123", "owner_123");

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(txn).toHaveBeenCalledTimes(4);
    const queries = txn.mock.results.map(({ value }) => value).join("\n");
    expect(queries).toContain("insert into meeting_access");
    expect(queries).toContain("insert into meeting_share_invites");
    expect(queries).toContain("update meeting_access as access");
    expect(queries).toContain("update meeting_share_invites as invite");
  });
});
