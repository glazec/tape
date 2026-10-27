import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  user: vi.fn(),
  workspace: vi.fn(),
  continue: vi.fn(),
  list: vi.fn(),
  merge: vi.fn(),
  undo: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: m.workspace,
}));
vi.mock("@/lib/meeting-continuation", () => ({
  continueMeetingRecording: m.continue,
}));
vi.mock("@/lib/meeting-composition", async () => ({
  ...(await import("@/lib/meeting-composition-error")),
  listMergeCandidates: m.list,
  mergeMeetings: m.merge,
  unmergeMeeting: m.undo,
}));
vi.mock("@/lib/provider-credit", () => ({
  providerCreditErrorResponse: () => null,
}));
import { POST as continuePost } from "@/app/api/meetings/[meetingId]/continue/route";
import { GET, POST, DELETE } from "@/app/api/meetings/[meetingId]/merge/route";
import { MeetingCompositionError } from "@/lib/meeting-composition-error";
const meetingId = "10000000-0000-4000-8000-000000000001";
const sourceMeetingId = "10000000-0000-4000-8000-000000000002";
const context = { params: Promise.resolve({ meetingId }) };
const request = (body: unknown, method = "POST") =>
  new Request("http://localhost/api?query=founder", {
    method,
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue({ id: "user" });
  m.workspace.mockResolvedValue({ teamId: "team" });
  m.continue.mockResolvedValue({ meetingId, status: "joining" });
  m.list.mockResolvedValue({ candidates: [], merged: [] });
});
describe("meeting continuity routes", () => {
  it("denies signed out requests before reading or writing meetings", async () => {
    m.user.mockResolvedValue(null);
    expect(
      (
        await continuePost(
          request({ meetingUrl: "https://zoom.us/j/123" }),
          context,
        )
      ).status,
    ).toBe(401);
    expect(
      (await GET(new Request("http://localhost/api"), context)).status,
    ).toBe(401);
    expect(m.continue).not.toHaveBeenCalled();
    expect(m.list).not.toHaveBeenCalled();
  });
  it("uses the meeting workspace and accepts only a link, with no caller supplied bot name", async () => {
    expect(
      (
        await continuePost(
          request({
            meetingUrl: "https://zoom.us/j/123",
            botName: "yiping@iosf.vc",
          }),
          context,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await continuePost(
          request({ meetingUrl: "https://zoom.us/j/123" }),
          context,
        )
      ).status,
    ).toBe(200);
    expect(m.workspace).toHaveBeenCalledWith({ id: "user" }, { meetingId });
    expect(m.continue).toHaveBeenCalledWith(
      { teamId: "team" },
      meetingId,
      "https://zoom.us/j/123",
    );
  });
  it("returns expiry and inaccessible source failures without claiming success", async () => {
    m.continue.mockRejectedValue(new MeetingCompositionError("Expired", 409));
    expect(
      (
        await continuePost(
          request({ meetingUrl: "https://zoom.us/j/123" }),
          context,
        )
      ).status,
    ).toBe(409);
    m.merge.mockRejectedValue(new MeetingCompositionError("Not found", 404));
    expect((await POST(request({ sourceMeetingId }), context)).status).toBe(
      404,
    );
  });
  it("lists pending candidates and applies and undoes a source relation", async () => {
    m.list.mockResolvedValue({
      candidates: [{ id: sourceMeetingId, status: "processing" }],
      merged: [],
    });
    expect(
      (await GET(new Request("http://localhost/api?query=founder"), context))
        .status,
    ).toBe(200);
    expect(m.list).toHaveBeenCalledWith(
      { teamId: "team" },
      meetingId,
      "founder",
    );
    expect((await POST(request({ sourceMeetingId }), context)).status).toBe(
      200,
    );
    expect(
      (await DELETE(request({ sourceMeetingId }, "DELETE"), context)).status,
    ).toBe(200);
    expect(m.merge).toHaveBeenCalledWith(
      { teamId: "team" },
      meetingId,
      sourceMeetingId,
    );
    expect(m.undo).toHaveBeenCalledWith(
      { teamId: "team" },
      meetingId,
      sourceMeetingId,
    );
  });
});
