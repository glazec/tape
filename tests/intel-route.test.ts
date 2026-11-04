import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), getOrCreateWorkspaceForSessionUser: vi.fn(), assertRequestRateLimit: vi.fn(), loadIntelMeetings: vi.fn(), saveIntelHistory: vi.fn(), searchIntel: vi.fn() }));
vi.mock("@/lib/auth", () => mocks);
vi.mock("@/lib/workspace", () => mocks);
vi.mock("@/lib/intel/store", () => mocks);
vi.mock("@/lib/intel/search", () => mocks);
vi.mock("@/lib/request-rate-limit", () => ({ ...mocks, RequestRateLimitError: class extends Error {} }));
vi.mock("@/lib/provider-credit", () => ({ providerCreditErrorResponse: () => null }));
import { POST } from "@/app/api/intel/search/route";
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
  it("persists input only after successful search and prohibits caching", async () => {
    mocks.searchIntel.mockResolvedValue({ matches: [], source: { text: "hello" }, coverage: "0 meetings" }); mocks.saveIntelHistory.mockResolvedValue("h1");
    const response = await POST(request({ kind: "content", text: "hello" }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.saveIntelHistory).toHaveBeenCalledWith({ userId: "user", teamId: "team" }, { kind: "content", text: "hello" });
  });
  it("does not save a failed search as a successful result", async () => {
    mocks.searchIntel.mockRejectedValue(new Error("Provider failed"));
    expect((await POST(request({ kind: "content", text: "hello" }))).status).toBe(502);
    expect(mocks.saveIntelHistory).not.toHaveBeenCalled();
  });
});
