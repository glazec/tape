import { beforeEach, describe, expect, it, vi } from "vitest";
const { getCurrentUser, getWorkspace, assertCanCreateMeetings, listCandidates } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), getWorkspace: vi.fn(), assertCanCreateMeetings: vi.fn(), listCandidates: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/workspace", () => ({ getOrCreateWorkspaceForSessionUser: getWorkspace, assertCanCreateMeetings }));
vi.mock("@/lib/upload-meeting-candidates", () => ({ listUploadMeetingCandidates: listCandidates }));
import { GET } from "@/app/api/uploads/meeting-candidates/route";
import { SharedOnlyAccessError } from "@/lib/access-errors";
const workspace = { teamId: "selected-team", userId: "user" };
const request = (query = "startedAt=2026-10-19T15%3A41%3A00Z&durationMs=5127900") => new Request(`https://app.example.com/api/uploads/meeting-candidates?${query}`, { headers: { "x-tape-organization": "selected-team" } });
beforeEach(() => {
  vi.resetAllMocks();
  getCurrentUser.mockResolvedValue({ id: "user" });
  getWorkspace.mockResolvedValue(workspace);
  listCandidates.mockResolvedValue({ meetings: [], hasMore: false });
});
describe("upload meeting candidates route", () => {
  it("uses the selected workspace and recording interval, returning a truthful empty result", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ meetings: [], hasMore: false });
    expect(listCandidates).toHaveBeenCalledWith({ workspace, startedAt: new Date("2026-10-19T15:41:00Z"), durationMs: 5127900 });
  });
  it("returns lookup failure distinctly from no matches", async () => {
    listCandidates.mockRejectedValue(new Error("database unavailable"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Calendar meetings could not be loaded. Try again." });
  });
  it.each(["", "startedAt=no", "startedAt=2026-10-19T15%3A41%3A00Z&durationMs=-1", "startedAt=2026-10-19T15%3A41%3A00Z&durationMs=Infinity"])("rejects invalid interval %s", async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(listCandidates).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(listCandidates).not.toHaveBeenCalled();
  });
  it("denies shared users before querying", async () => {
    assertCanCreateMeetings.mockRejectedValue(new SharedOnlyAccessError());
    expect((await GET(request())).status).toBe(403);
    expect(listCandidates).not.toHaveBeenCalled();
  });
});
