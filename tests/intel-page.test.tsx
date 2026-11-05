import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ loadIntelMeetings: vi.fn(), loadIntelHistory: vi.fn() }));
vi.mock("@/lib/intel/store", () => mocks);
vi.mock("@/lib/auth-guards", () => ({ requireCurrentUser: async () => ({ id: "user" }) }));
vi.mock("@/lib/workspace", () => ({ getOrCreateWorkspaceForSessionUser: async () => ({ teamId: "team", userId: "user" }) }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => createElement("main", null, children) }));
vi.mock("@/components/intel-search", () => ({ IntelSearch: () => createElement("input", { placeholder: "Search intel" }) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: "user" }) }));
import { GET } from "@/app/api/intel/catalog/route";
import IntelPage from "@/app/intel/page";
import { IntelCapacityError } from "@/lib/intel/content";
beforeEach(() => vi.clearAllMocks());
it("renders the search field without waiting for transcripts or history", async () => {
  expect(renderToStaticMarkup(await IntelPage())).toContain("Search intel");
  expect(mocks.loadIntelMeetings).not.toHaveBeenCalled();
  expect(mocks.loadIntelHistory).not.toHaveBeenCalled();
});
it("shows a capacity error instead of an empty catalog", async () => {
  mocks.loadIntelMeetings.mockRejectedValue(new IntelCapacityError("Collection too large"));
  const response = await GET();
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: "Collection too large" });
  expect(mocks.loadIntelHistory).not.toHaveBeenCalled();
});
