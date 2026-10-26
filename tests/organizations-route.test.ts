import { beforeEach, describe, expect, it, vi } from "vitest";
const { getCurrentUser, getWorkspace, listOrganizationWorkspaces, selectOrganizationWorkspace, setCookie } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), getWorkspace: vi.fn(), listOrganizationWorkspaces: vi.fn(), selectOrganizationWorkspace: vi.fn(), setCookie: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/workspace", () => ({ getOrCreateWorkspaceForSessionUser: getWorkspace }));
vi.mock("@/lib/organization-workspaces", () => ({ listOrganizationWorkspaces, selectOrganizationWorkspace }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: setCookie }) }));
import { GET, POST } from "@/app/api/organizations/route";
const teamId = "11111111-1111-4111-8111-111111111111";
const request = (id: string) => new Request("https://tape.test/api/organizations", { method: "POST", body: JSON.stringify({ teamId: id }) });
beforeEach(() => {
  vi.resetAllMocks();
  getCurrentUser.mockResolvedValue({ id: "auth", email: "person@example.com" });
  getWorkspace.mockResolvedValue({ teamId, userId: "user" });
  listOrganizationWorkspaces.mockResolvedValue([{ teamId, teamName: "Example", role: "member" }]);
  selectOrganizationWorkspace.mockResolvedValue({ teamId });
});
describe("/api/organizations", () => {
  it("lists only the caller's organizations without role or billing details", async () => {
    expect(await (await GET()).json()).toEqual({ teamId, organizations: [{ teamId, teamName: "Example" }] });
  });
  it("persists an authorized selection", async () => {
    expect((await POST(request(teamId))).status).toBe(200);
    expect(setCookie).toHaveBeenCalledWith("tape_organization", teamId, expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }));
  });
  it("rejects another organization's id without changing the cookie", async () => {
    expect((await POST(request("22222222-2222-4222-8222-222222222222"))).status).toBe(403);
    expect(setCookie).not.toHaveBeenCalled();
  });
  it("checks authentication on reads and writes", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await POST(request(teamId))).status).toBe(401);
    expect(setCookie).not.toHaveBeenCalled();
  });
});
