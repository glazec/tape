import { afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { execute, select, transaction, txn } = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  transaction: vi.fn(),
  txn: vi.fn(
    (strings: TemplateStringsArray, ...params: unknown[]) => ({
      params,
      strings: [...strings],
    }),
  ),
}));

vi.mock("@/db/client", () => ({
  databaseSql: { transaction },
  db: { execute, select },
}));

describe("meeting share service", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("creates a policy and all grants in one database transaction", async () => {
    transaction.mockImplementation(async (buildQueries) => {
      const queries = buildQueries(txn);

      return [
        [{ id: "55555555-5555-4555-8555-555555555555" }],
        [
          {
            id: "55555555-5555-4555-8555-555555555555",
            pending: false,
            shared: true,
          },
        ],
      ].slice(0, queries.length);
    });
    const { createMeetingSharePolicy } = await import(
      "@/lib/meeting-share-service"
    );

    await expect(
      createMeetingSharePolicy({
        createdByUserId: "11111111-1111-4111-8111-111111111111",
        matchKeys: ["title:weekly-sync"],
        meetingIds: [
          "22222222-2222-4222-8222-222222222222",
          "33333333-3333-4333-8333-333333333333",
        ],
        ownerUserId: "11111111-1111-4111-8111-111111111111",
        recipientEmail: "colleague@example.com",
        scope: "related",
        seedMeetingId: "22222222-2222-4222-8222-222222222222",
        teamId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toMatchObject({
      id: "55555555-5555-4555-8555-555555555555",
      pending: false,
      shared: true,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(txn).toHaveBeenCalledTimes(2);
    const policyQuery = txn.mock.results[0]?.value;
    const materializationQuery = txn.mock.results[1]?.value;
    const policySql = policyQuery?.strings.join(" ") ?? "";
    const materializationSql =
      materializationQuery?.strings.join(" ") ?? "";
    expect(policySql).toContain("insert into meeting_share_policies");
    expect(policySql).not.toContain("meeting_share_policy_keys");
    expect(materializationSql).toContain(
      "from meeting_share_policies",
    );
    expect(materializationSql).toContain(
      "insert into meeting_share_policy_keys",
    );
    expect(materializationSql).toContain("::text[]");
    expect(materializationSql).toContain("::uuid[]");
    expect(materializationQuery?.params).toContainEqual([
      "title:weekly-sync",
    ]);
    expect(materializationQuery?.params).toContainEqual([
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ]);
  });

  it("falls back to the generated policy id when the database returns no row", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "55555555-5555-4555-8555-555555555555",
    );
    transaction.mockImplementation(async (buildQueries) => {
      buildQueries(txn);
      return [
        [{ id: "55555555-5555-4555-8555-555555555555" }],
        [],
      ];
    });
    const { createMeetingSharePolicy } = await import(
      "@/lib/meeting-share-service"
    );

    await expect(
      createMeetingSharePolicy({
        createdByUserId: "11111111-1111-4111-8111-111111111111",
        matchKeys: [],
        meetingIds: ["22222222-2222-4222-8222-222222222222"],
        ownerUserId: "11111111-1111-4111-8111-111111111111",
        recipientEmail: "invitee@example.com",
        scope: "single",
        seedMeetingId: "22222222-2222-4222-8222-222222222222",
        teamId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toEqual({
      id: "55555555-5555-4555-8555-555555555555",
      pending: true,
      shared: false,
    });
    const materializationQuery = txn.mock.results[1]?.value;
    expect(materializationQuery?.params).toContainEqual([]);
    expect(materializationQuery?.params).toContainEqual([
      "22222222-2222-4222-8222-222222222222",
    ]);
  });

  it("lists supported active share scopes and their pending state", async () => {
    const orderBy = vi.fn().mockResolvedValue([
      {
        email: "member@example.com",
        id: "11111111-1111-4111-8111-111111111111",
        scope: "single",
        userId: "22222222-2222-4222-8222-222222222222",
      },
      {
        email: "invitee@example.com",
        id: "33333333-3333-4333-8333-333333333333",
        scope: "related",
        userId: null,
      },
      {
        email: "ignored@example.com",
        id: "44444444-4444-4444-8444-444444444444",
        scope: "legacy",
        userId: null,
      },
    ]);
    select.mockReturnValue({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => ({ orderBy })),
        })),
      })),
    });
    const { listActiveMeetingShares } = await import(
      "@/lib/meeting-share-service"
    );

    await expect(
      listActiveMeetingShares("55555555-5555-4555-8555-555555555555"),
    ).resolves.toEqual([
      {
        email: "member@example.com",
        id: "11111111-1111-4111-8111-111111111111",
        pending: false,
        scope: "single",
      },
      {
        email: "invitee@example.com",
        id: "33333333-3333-4333-8333-333333333333",
        pending: true,
        scope: "related",
      },
    ]);
  });

  it("reports whether an active policy applies to a meeting", async () => {
    const limit = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "11111111-1111-4111-8111-111111111111",
        },
      ])
      .mockResolvedValueOnce([]);
    select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit })),
      })),
    });
    const { meetingSharePolicyAppliesToMeeting } = await import(
      "@/lib/meeting-share-service"
    );

    await expect(
      meetingSharePolicyAppliesToMeeting(
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ),
    ).resolves.toBe(true);
    await expect(
      meetingSharePolicyAppliesToMeeting(
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
      ),
    ).resolves.toBe(false);
  });

  it("revokes a policy and reconciles effective access in one statement", async () => {
    execute.mockResolvedValue({ rows: [] });
    const { revokeMeetingSharePolicy } = await import(
      "@/lib/meeting-share-service"
    );

    await revokeMeetingSharePolicy(
      "11111111-1111-4111-8111-111111111111",
    );

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("excludes and revokes one recipient from one meeting", async () => {
    execute.mockResolvedValue({ rows: [] });
    const { revokeMeetingRecipientAccess } = await import(
      "@/lib/meeting-share-service"
    );

    await revokeMeetingRecipientAccess({
      createdByUserId: "11111111-1111-4111-8111-111111111111",
      meetingId: "22222222-2222-4222-8222-222222222222",
      recipientEmail: "colleague@example.com",
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]).sql;
    expect(query).toContain("insert into meeting_access_exclusions");
    expect(query).toContain("update meeting_access_sources");
    expect(query).toContain("update meeting_access as access");
    expect(query).toContain("update meeting_share_invites as invite");
  });

  it("revokes future policies when their seed meeting is deleted", async () => {
    execute.mockResolvedValue({ rows: [] });
    const { revokeMeetingSharesSeededByMeeting } = await import(
      "@/lib/meeting-share-service"
    );

    await revokeMeetingSharesSeededByMeeting(
      "22222222-2222-4222-8222-222222222222",
    );

    expect(execute).toHaveBeenCalledTimes(1);
  });
});
