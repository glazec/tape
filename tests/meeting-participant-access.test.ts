import { afterEach, describe, expect, it, vi } from "vitest";

const {
  deleteRows,
  grantMeetingAccessByEmail,
  reconcileEffectiveMeetingAccess,
  insert,
  onConflictDoUpdate,
  select,
  set,
  update,
  values,
  where,
} = vi.hoisted(() => ({
  deleteRows: vi.fn(),
  grantMeetingAccessByEmail: vi.fn(),
  reconcileEffectiveMeetingAccess: vi.fn(),
  insert: vi.fn(),
  onConflictDoUpdate: vi.fn(),
  select: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  values: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { delete: deleteRows, insert, select, update },
}));
vi.mock("@/lib/meeting-access-grants", () => ({
  grantMeetingAccessByEmail,
  reconcileEffectiveMeetingAccess,
}));

import {
  classifyMeetingAttendeeEmails,
  syncMeetingParticipantAccess,
} from "@/lib/meeting-participant-access";

describe("meeting participant access", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("normalizes attendees and limits automatic access to allowed domains", () => {
    expect(
      classifyMeetingAttendeeEmails(
        [
          " Alice@Example.com ",
          "alice@example.com",
          "founder@external.com",
        ],
        ["example.com"],
      ),
    ).toEqual({
      attendeeEmails: ["alice@example.com", "founder@external.com"],
      internalEmails: ["alice@example.com"],
    });
  });

  it("does not grant automatic participant access to an external member", async () => {
    select
      .mockReturnValueOnce({
        from: () => ({ where: vi.fn().mockResolvedValue([{ domain: "example.com" }]) }),
      })
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            where: vi.fn().mockResolvedValue([
              { email: "member@example.com", id: "member_123", role: "member" },
              {
                email: "external@example.com",
                id: "external_123",
                role: "external",
              },
            ]),
          }),
        }),
      });
    deleteRows.mockReturnValue({ where });
    insert.mockReturnValue({ values });
    values.mockReturnValue({ onConflictDoUpdate });
    onConflictDoUpdate.mockResolvedValue(undefined);
    update.mockReturnValue({ set });
    set.mockReturnValue({ where });
    where.mockResolvedValue(undefined);
    grantMeetingAccessByEmail.mockResolvedValue({ pending: false });
    reconcileEffectiveMeetingAccess.mockResolvedValue(undefined);

    await expect(
      syncMeetingParticipantAccess({
        attendeeEmails: ["member@example.com", "external@example.com"],
        meetingId: "meeting_123",
        ownerUserId: "owner_123",
        teamId: "team_123",
      }),
    ).resolves.toEqual({ attendeeCount: 2, internalParticipantCount: 1 });
    expect(grantMeetingAccessByEmail).toHaveBeenCalledTimes(1);
    expect(grantMeetingAccessByEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: "member@example.com" }),
    );
    expect(reconcileEffectiveMeetingAccess).toHaveBeenCalledWith(
      "meeting_123",
      "owner_123",
    );
  });
});
