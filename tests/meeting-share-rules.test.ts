import { afterEach, describe, expect, it, vi } from "vitest";

const { transaction, txn } = vi.hoisted(() => ({
  transaction: vi.fn(),
  txn: vi.fn(() => ({})),
}));

vi.mock("@/db/client", () => ({
  databaseSql: { transaction },
  db: { select: vi.fn() },
}));

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
  });
});
