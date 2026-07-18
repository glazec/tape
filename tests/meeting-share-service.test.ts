import { afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/db/client", () => ({ db: { execute, select: vi.fn() } }));

describe("meeting share service", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("creates a policy and all grants in one database statement", async () => {
    execute.mockResolvedValue({
      rows: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          pending: false,
        },
      ],
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
    });
    expect(execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]).sql;
    expect(query).toContain("on conflict");
    expect(query).toContain("where revoked_at is null");
    expect(query).toMatch(/do update\s+set/);
    expect(query).toContain("active_policy");
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
