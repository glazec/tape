import { afterEach, describe, expect, it, vi } from "vitest";
const { select, insert, setDatabaseWorkspace } = vi.hoisted(() => ({
  select: vi.fn(), insert: vi.fn(), setDatabaseWorkspace: vi.fn(),
}));
vi.mock("@/db/client", () => ({ db: { select, insert } }));
vi.mock("@/db/rls-context", () => ({ setDatabaseWorkspace, withVerifiedCalendarEmail: (_email: string, operation: () => Promise<unknown>) => operation() }));
import { selectOrganizationWorkspace, workspaceForVerifiedCalendarEmail } from "@/lib/organization-workspaces";
const workspace = { teamId: "home", userId: "user", domain: "example.com" };
const other = { teamId: "other", teamName: "Other", domain: "other.test", role: "admin" };
function rows(value: unknown[]) {
  return { from: () => ({ innerJoin: () => ({ where: () => ({ orderBy: async () => value, limit: async () => value }) }) }) };
}
afterEach(() => vi.clearAllMocks());
describe("organization workspaces", () => {
  it("rejects selecting an organization without membership", async () => {
    select.mockReturnValue(rows([other]));
    expect(await selectOrganizationWorkspace(workspace, "unrelated")).toBeNull();
    expect(setDatabaseWorkspace).not.toHaveBeenCalled();
  });
  it("selects an existing membership with that organization's domain", async () => {
    select.mockReturnValue(rows([other]));
    expect(await selectOrganizationWorkspace(workspace, "other")).toMatchObject({ ...other, userId: "user" });
    expect(setDatabaseWorkspace).toHaveBeenCalledWith(expect.objectContaining({ teamId: "other" }));
  });
  it("keeps unknown email domains in the existing workspace", async () => {
    select.mockReturnValue(rows([]));
    expect(await workspaceForVerifiedCalendarEmail(workspace, "me@unknown.test")).toEqual(workspace);
    expect(insert).not.toHaveBeenCalled();
  });
  it("grants member access only to the configured organization and preserves an existing role", async () => {
    select.mockReturnValue(rows([other]));
    const onConflictDoNothing = vi.fn();
    const values = vi.fn(() => ({ onConflictDoNothing }));
    insert.mockReturnValue({ values });
    const result = await workspaceForVerifiedCalendarEmail(workspace, "me@other.test");
    expect(result).toMatchObject({ teamId: "other", domain: "other.test", userId: "user" });
    expect(values).toHaveBeenCalledWith({ teamId: "other", userId: "user", role: "member" });
    expect(onConflictDoNothing).toHaveBeenCalled();
  });
});
