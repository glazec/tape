import { afterEach, describe, expect, it, vi } from "vitest";

const { select, transaction, txn } = vi.hoisted(() => ({
  select: vi.fn(),
  transaction: vi.fn(),
  txn: vi.fn((strings: TemplateStringsArray) => strings),
}));

vi.mock("@/db/client", () => ({
  databaseSql: { transaction },
  db: { select },
}));

function mockMeetingRows(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);

  select.mockReturnValue({
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => ({ limit })),
        })),
      })),
    })),
  });
}

describe("meeting share rules", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("reconciles stale related grants in one transaction", async () => {
    transaction.mockImplementation(async (buildQueries) => {
      const queries = buildQueries(txn);

      return queries.map((_: unknown, index: number) =>
        index === queries.length - 1 ? [{ shared_count: 0 }] : [],
      );
    });
    const { applyMeetingShareRules } = await import(
      "@/lib/meeting-share-rules"
    );

    await expect(
      applyMeetingShareRules({
        attendeeEmails: [],
        meetingId: "22222222-2222-4222-8222-222222222222",
        ownerUserId: "owner_user_id",
        teamId: "team_123",
        title: "Google Meet",
        workspaceDomain: "example.com",
      }),
    ).resolves.toEqual({ sharedCount: 0 });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(txn).toHaveBeenCalledTimes(7);
  });

  it("returns zero when reconciliation produces no count row", async () => {
    transaction.mockResolvedValue([]);
    const { applyMeetingShareRules } = await import(
      "@/lib/meeting-share-rules"
    );

    await expect(
      applyMeetingShareRules({
        attendeeEmails: [],
        meetingId: "22222222-2222-4222-8222-222222222222",
        ownerUserId: "owner_user_id",
        teamId: "team_123",
        title: "Partner sync",
        workspaceDomain: "example.com",
      }),
    ).resolves.toEqual({ sharedCount: 0 });
  });

  it("materializes matching policies in the same transaction", async () => {
    transaction.mockImplementation(async (buildQueries) => {
      const queries = buildQueries(txn);

      return queries.map((_: unknown, index: number) =>
        index === queries.length - 1 ? [{ shared_count: 1 }] : [],
      );
    });
    const { applyMeetingShareRules } = await import(
      "@/lib/meeting-share-rules"
    );

    await expect(
      applyMeetingShareRules({
        attendeeEmails: ["partner@vendor.com", "owner@example.com"],
        meetingId: "22222222-2222-4222-8222-222222222222",
        ownerUserId: "owner_user_id",
        teamId: "team_123",
        title: "Weekly partner sync",
        workspaceDomain: "example.com",
      }),
    ).resolves.toEqual({ sharedCount: 1 });

    const materializeSql = txn.mock.calls[1]?.[0].join(" ") ?? "";
    const countSql = txn.mock.calls[6]?.[0].join(" ") ?? "";

    expect(materializeSql).toContain("participant:email:%");
    expect(materializeSql).toContain("title:%");
    expect(materializeSql).toContain("participant:domain:%");
    expect(countSql).toContain("meeting_access_sources as source");
    expect(countSql).toContain("source.source_id = policy.id::text");
    expect(countSql).toContain("source.revoked_at is null");
  });

  it("skips reconciliation when the meeting does not exist", async () => {
    mockMeetingRows([]);
    const { reconcileMeetingSharingForMeeting } = await import(
      "@/lib/meeting-share-rules"
    );

    await expect(
      reconcileMeetingSharingForMeeting(
        "22222222-2222-4222-8222-222222222222",
      ),
    ).resolves.toEqual({ sharedCount: 0 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("skips reconciliation when the owner email has no domain", async () => {
    mockMeetingRows([
      {
        attendeeEmails: [],
        id: "22222222-2222-4222-8222-222222222222",
        ownerEmail: "invalid-email",
        ownerUserId: "11111111-1111-4111-8111-111111111111",
        teamId: "33333333-3333-4333-8333-333333333333",
        title: "Partner sync",
      },
    ]);
    const { reconcileMeetingSharingForMeeting } = await import(
      "@/lib/meeting-share-rules"
    );

    await expect(
      reconcileMeetingSharingForMeeting(
        "22222222-2222-4222-8222-222222222222",
      ),
    ).resolves.toEqual({ sharedCount: 0 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("reconciles an existing meeting using the owner workspace domain", async () => {
    mockMeetingRows([
      {
        attendeeEmails: ["partner@vendor.com"],
        id: "22222222-2222-4222-8222-222222222222",
        ownerEmail: "owner@example.com",
        ownerUserId: "11111111-1111-4111-8111-111111111111",
        teamId: "33333333-3333-4333-8333-333333333333",
        title: "Partner sync",
      },
    ]);
    transaction.mockImplementation(async (buildQueries) => {
      const queries = buildQueries(txn);

      return queries.map((_: unknown, index: number) =>
        index === queries.length - 1 ? [{ shared_count: 2 }] : [],
      );
    });
    const { reconcileMeetingSharingForMeeting } = await import(
      "@/lib/meeting-share-rules"
    );

    await expect(
      reconcileMeetingSharingForMeeting(
        "22222222-2222-4222-8222-222222222222",
      ),
    ).resolves.toEqual({ sharedCount: 2 });
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
