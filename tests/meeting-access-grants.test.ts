import { afterEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/db/client", () => ({
  databaseSql: { transaction: vi.fn() },
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
});
