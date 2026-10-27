import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ownerRows: vi.fn(),
  composed: vi.fn(),
  current: vi.fn(),
  ready: vi.fn(),
  credit: vi.fn(),
  generate: vi.fn(),
  returning: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: mocks.ownerRows }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: mocks.returning }) }),
    }),
  },
}));
vi.mock("@/lib/meeting-composition", () => ({
  getComposedMeetingForFollowup: mocks.composed,
}));
vi.mock("@/lib/meeting-followup-source", () => ({
  getCurrentMeetingFollowup: mocks.current,
  getFollowupSource: (meeting: { title: string; segments: unknown[] }) => ({
    title: meeting.title,
    segments: meeting.segments,
  }),
  getFollowupSourceHash: () => "a".repeat(64),
  isFollowupReady: mocks.ready,
}));
vi.mock("@/lib/meeting-write-policy", () => ({
  getManageableMeetingCondition: () => undefined,
}));
vi.mock("@/lib/provider-credit", () => ({
  assertWorkspaceHasProviderCredit: mocks.credit,
}));
vi.mock("@/lib/vendors/openrouter", () => ({
  generateMeetingFollowup: mocks.generate,
}));

import { autoGenerateMeetingFollowup } from "@/lib/meeting-followup-generation";

const meetingId = "11111111-1111-4111-8111-111111111111";
const meeting = {
  canManage: true,
  title: "Weekly sync",
  segments: [{ id: "s1", speaker: "Jocy", startMs: 0, text: "We ship Monday." }],
  updatedAt: "2026-10-27T12:00:00.000Z",
};

beforeEach(() => {
  mocks.ownerRows.mockResolvedValue([
    { email: "owner@iosg.vc", teamId: "team", userId: "owner" },
  ]);
  mocks.composed.mockResolvedValue(meeting);
  mocks.ready.mockReturnValue(true);
  mocks.current.mockReturnValue(null);
  mocks.generate.mockResolvedValue({ todos: [], dynamics: [] });
  mocks.returning.mockResolvedValue([{ id: meetingId }]);
});
afterEach(() => vi.clearAllMocks());

describe("autoGenerateMeetingFollowup", () => {
  it("generates and saves as the meeting owner", async () => {
    expect(await autoGenerateMeetingFollowup(meetingId)).toEqual({
      status: "saved",
      result: { todos: [], dynamics: [] },
    });
    expect(mocks.composed).toHaveBeenCalledWith(
      { domain: "iosg.vc", teamId: "team", userId: "owner" },
      meetingId,
    );
    expect(mocks.credit).toHaveBeenCalled();
  });

  it("does not spend a generation when the saved followup is current", async () => {
    mocks.current.mockReturnValue({ todos: [], dynamics: [] });

    expect(await autoGenerateMeetingFollowup(meetingId)).toEqual({
      status: "already_current",
    });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("reports a meeting that is not ready yet", async () => {
    mocks.ready.mockReturnValue(false);

    expect(await autoGenerateMeetingFollowup(meetingId)).toEqual({
      status: "not_ready",
    });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("skips a deleted meeting", async () => {
    mocks.ownerRows.mockResolvedValue([]);

    expect(await autoGenerateMeetingFollowup(meetingId)).toEqual({
      status: "not_found",
    });
  });
});
