import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ loadIntelMeetings: vi.fn(), loadIntelHistory: vi.fn() }));
vi.mock("@/lib/intel/store", () => mocks);
vi.mock("@/lib/auth-guards", () => ({ requireCurrentUser: async () => ({ id: "user" }) }));
vi.mock("@/lib/workspace", () => ({ getOrCreateWorkspaceForSessionUser: async () => ({ teamId: "team", userId: "user" }) }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => createElement("main", null, children) }));
vi.mock("@/components/intel-search", () => ({ IntelSearch: () => createElement("input", { placeholder: "Search intel" }) }));
import IntelPage from "@/app/intel/page";
import { IntelCapacityError } from "@/lib/intel/content";
beforeEach(() => vi.clearAllMocks());
it("explains capacity without showing empty search results or loading private history", async () => {
  mocks.loadIntelMeetings.mockRejectedValue(new IntelCapacityError("Intel currently supports up to 100,000 transcript segments."));
  const html = renderToStaticMarkup(await IntelPage());
  expect(html).toContain("100,000 transcript segments");
  expect(html).toContain("Search has not run");
  expect(html).not.toContain("Search intel");
  expect(mocks.loadIntelHistory).not.toHaveBeenCalled();
});
it("does not disguise other failures as capacity limits", async () => {
  mocks.loadIntelMeetings.mockRejectedValue(new Error("Database unavailable"));
  await expect(IntelPage()).rejects.toThrow("Database unavailable");
});
