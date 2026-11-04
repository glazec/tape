import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), getOrCreateWorkspaceForSessionUser: vi.fn(), assertRequestRateLimit: vi.fn(), loadIntelMeetings: vi.fn(), enqueueIntelSearch: vi.fn(), readIntelJob: vi.fn(), previewIntelSearch: vi.fn(), searchIntel: vi.fn() }));
vi.mock("@/lib/auth", () => mocks);
vi.mock("@/lib/workspace", () => mocks);
vi.mock("@/lib/intel/store", () => mocks);
vi.mock("@/lib/intel/jobs", () => mocks);
vi.mock("@/lib/request-rate-limit", () => ({ ...mocks, RequestRateLimitError: class extends Error {} }));
vi.mock("@/lib/provider-credit", () => ({ providerCreditErrorResponse: () => null }));
import { POST, GET } from "@/app/api/intel/search/route";
const request = (body: unknown) => new Request("https://tape.example/api/intel/search", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.getCurrentUser.mockResolvedValue({ id: "user" }); mocks.getOrCreateWorkspaceForSessionUser.mockResolvedValue({ userId: "user", teamId: "team" }); mocks.loadIntelMeetings.mockResolvedValue([]); });
describe("Intel search route", () => {
  it("requires authentication before any corpus or provider access", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await POST(request({ kind: "content", text: "hello" }))).status).toBe(401);
    expect(mocks.loadIntelMeetings).not.toHaveBeenCalled(); expect(mocks.searchIntel).not.toHaveBeenCalled();
  });
  it("rejects client supplied results or evidence", async () => {
    expect((await POST(request({ kind: "person", ids: ["p"], evidence: ["private"] }))).status).toBe(400);
    expect(mocks.searchIntel).not.toHaveBeenCalled();
  });
  it("acknowledges a durable job without reading transcripts or running matching in the request", async () => {
    mocks.enqueueIntelSearch.mockResolvedValue({ id: "job" });
    const response = await POST(request({ kind: "content", text: "hello" }));
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ id: "job" });
    expect(mocks.loadIntelMeetings).not.toHaveBeenCalled();
  });
  it("previews the model cost without dispatching a search", async () => {
    const input = { kind: "content", text: "inference" };
    const estimate = { lowUsd: 0.01, highUsd: 0.09 };
    mocks.previewIntelSearch.mockResolvedValue({ id: "preview", estimate });
    const response = await POST(new Request("https://tape.example/api/intel/search?estimate=1", {
      method: "POST", body: JSON.stringify(input),
    }));
    expect(await response.json()).toEqual({ id: "preview", estimate });
    expect(mocks.enqueueIntelSearch).not.toHaveBeenCalled();
  });
  it("does not acknowledge a failed enqueue", async () => {
    mocks.enqueueIntelSearch.mockRejectedValue(new Error());
    expect((await POST(request({ kind: "content", text: "hello" }))).status).toBe(502);
  });
  it("reconnects through the signed in user's workspace without dispatching a second search", async () => {
    mocks.readIntelJob.mockResolvedValue({ id: "job", status: "running", completed: 1, total: 3 });
    const response = await GET(new Request("https://tape.example/api/intel/search"));
    expect((await response.json()).job.completed).toBe(1);
    expect(mocks.readIntelJob).toHaveBeenCalledWith({ userId: "user", teamId: "team" }, undefined);
    expect(mocks.enqueueIntelSearch).not.toHaveBeenCalled();
  });
});
