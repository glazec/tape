import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  workspace: vi.fn(),
  access: vi.fn(),
  put: vi.fn(),
  sign: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: mocks.workspace,
}));
vi.mock("@/lib/meeting-notes", () => ({ canReadMeetingNotes: mocks.access }));
vi.mock("@/lib/r2", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/r2")>(),
  createReadUrl: mocks.sign,
  putObject: mocks.put,
}));

import { GET, POST } from "@/app/api/meetings/[meetingId]/notes/images/route";
import { noteImageMaxBytes } from "@/lib/meeting-note-document";

const meetingId = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ meetingId }) };
const url = `https://example.com/api/meetings/${meetingId}/notes/images`;
const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "session-user" });
  mocks.workspace.mockResolvedValue({ userId: "owner" });
  mocks.access.mockResolvedValue(true);
  mocks.sign.mockResolvedValue("https://storage.example.com/signed");
});

describe("meeting note images", () => {
  it("uploads and signs image objects only under the current note owner's key", async () => {
    const upload = await POST(new Request(url, { method: "POST", body: png }), context);
    expect(upload.status).toBe(201);
    const { id } = await upload.json();
    expect(mocks.put).toHaveBeenCalledWith({
      key: `meetings/${meetingId}/notes/owner/${id}`,
      body: Buffer.from(png),
      contentType: "image/png",
    });

    const redirect = await GET(new Request(`${url}?id=${id}`), context);
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.sign).toHaveBeenLastCalledWith({
      key: `meetings/${meetingId}/notes/owner/${id}`,
    });

    mocks.workspace.mockResolvedValue({ userId: "another-reader" });
    await GET(new Request(`${url}?id=${id}`), context);
    expect(mocks.sign).toHaveBeenLastCalledWith({
      key: `meetings/${meetingId}/notes/another-reader/${id}`,
    });
  });

  it("requires a session and meeting access before touching storage", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await POST(new Request(url, { method: "POST", body: png }), context)).status).toBe(401);
    mocks.access.mockResolvedValue(false);
    expect((await GET(new Request(`${url}?id=${meetingId}`), context)).status).toBe(404);
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("rejects unsupported and oversized image data", async () => {
    expect((await POST(new Request(url, { method: "POST", body: "<svg/>" }), context)).status).toBe(415);
    const oversized = new Uint8Array(noteImageMaxBytes + 1);
    expect((await POST(new Request(url, { method: "POST", body: oversized }), context)).status).toBe(413);
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
