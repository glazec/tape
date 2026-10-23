import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  workspace: vi.fn(),
  access: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: mocks.workspace,
}));
vi.mock("@/lib/meeting-notes", () => ({
  canReadMeetingNotes: mocks.access,
  getMeetingNote: mocks.get,
  saveMeetingNote: mocks.save,
}));
import { GET, PUT } from "@/app/api/meetings/[meetingId]/notes/route";

const meetingId = "11111111-1111-4111-8111-111111111111";
const workspace = { userId: "reader", teamId: "team", role: "external" };
const context = { params: Promise.resolve({ meetingId }) };
const request = (body: unknown) =>
  new Request("https://example.com/notes", {
    method: "PUT",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "auth-user" });
  mocks.workspace.mockResolvedValue(workspace);
  mocks.access.mockResolvedValue(true);
  mocks.get.mockResolvedValue({ content: "", version: 0 });
  mocks.save.mockResolvedValue({ content: "Follow up", version: 1 });
});

describe("personal meeting notes API", () => {
  it("requires authentication for reading and writing", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(request({}), context)).status).toBe(401);
    expect(
      (await PUT(request({ content: "secret", version: 0 }), context)).status,
    ).toBe(401);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rejects invalid and inaccessible meetings", async () => {
    expect(
      (
        await GET(request({}), {
          params: Promise.resolve({ meetingId: "invalid" }),
        })
      ).status,
    ).toBe(404);
    mocks.access.mockResolvedValue(false);
    expect((await GET(request({}), context)).status).toBe(404);
    expect(
      (await PUT(request({ content: "secret", version: 0 }), context)).status,
    ).toBe(404);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("returns only the signed in reader's notes without caching", async () => {
    const response = await GET(request({}), context);
    expect(await response.json()).toEqual({ content: "", version: 0 });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.get).toHaveBeenCalledWith(workspace, meetingId);
  });

  it("allows a shared reader to write their own notes and preserves whitespace", async () => {
    const note = { content: "  Agenda\n\nNext steps  ", version: 0 };
    expect((await PUT(request(note), context)).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(workspace, meetingId, note);
  });

  it("allows clearing notes after a meeting", async () => {
    expect(
      (await PUT(request({ content: "", version: 4 }), context)).status,
    ).toBe(200);
  });

  it.each([
    { content: "x", version: -1 },
    { content: "x", version: 1.5 },
    { content: "x" },
    { content: "x", version: 0, userId: "another-user" },
    { content: "x".repeat(20_001), version: 0 },
  ])("rejects invalid or impersonating payloads", async (body) => {
    expect((await PUT(request(body), context)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("reports a stale edit without overwriting it", async () => {
    mocks.save.mockResolvedValue(null);
    expect(
      (await PUT(request({ content: "old draft", version: 2 }), context))
        .status,
    ).toBe(409);
  });
});
