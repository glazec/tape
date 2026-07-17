import { afterEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/db/client", () => ({ db: { execute, select: vi.fn() } }));

describe("meeting share service", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("creates a policy and all grants in one database statement", async () => {
    execute.mockResolvedValue({ rows: [{ pending: false }] });
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
    ).resolves.toMatchObject({ pending: false });
    expect(execute).toHaveBeenCalledTimes(1);
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
