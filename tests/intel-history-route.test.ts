import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), remove: vi.fn(), where: vi.fn(), typed: vi.fn(), loadIntelMeetings: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/workspace", () => ({ getOrCreateWorkspaceForSessionUser: mocks.workspace }));
vi.mock("@/db/client", () => ({ db: { delete: mocks.remove } }));
vi.mock("@/lib/intel/store", () => ({ loadTypedIntelHistory: mocks.typed, loadIntelMeetings: mocks.loadIntelMeetings }));
import { DELETE, GET } from "@/app/api/intel/history/route";
const request = (origin?: string) => new Request("https://tape.example/api/intel/history", {
  method: "DELETE", headers: origin ? { origin } : {},
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tape.example");
  mocks.user.mockResolvedValue({ id: "owner" });
  mocks.workspace.mockResolvedValue({ userId: "owner", teamId: "team" });
  mocks.remove.mockReturnValue({ where: mocks.where });
});
it("rejects another origin before authentication or deletion", async () => {
  expect((await DELETE(request("https://other.example"))).status).toBe(403);
  expect(mocks.user).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("requires authentication before deleting history", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await DELETE(request())).status).toBe(401);
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("deletes only the current user's history in the active workspace", async () => {
  const response = await DELETE(request("https://tape.example"));
  expect(await response.json()).toEqual({ cleared: true });
  const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
  expect(query.sql).toContain('"intel_searches"."team_id" = $1');
  expect(query.sql).toContain('"intel_searches"."user_id" = $2');
  expect(query.params).toEqual(["team", "owner"]);
});

it("returns typed search history without loading any transcripts", async () => {
  const history = [{ id: "h", input: { kind: "content", text: "AI infrastructure" }, label: "AI infrastructure", savedJob: true, createdAt: "2026-11-08T00:00:00.000Z" }];
  mocks.typed.mockResolvedValue(history);
  const response = await GET();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ history });
  expect(mocks.typed).toHaveBeenCalledWith({ userId: "owner", teamId: "team" });
  expect(mocks.loadIntelMeetings).not.toHaveBeenCalled();
});
it("requires authentication before reading history", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await GET()).status).toBe(401);
  expect(mocks.typed).not.toHaveBeenCalled();
});
