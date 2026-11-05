import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/workspace", () => ({ getOrCreateWorkspaceForSessionUser: mocks.workspace }));
vi.mock("@/db/client", () => ({ db: { update: () => ({ set: mocks.set }) } }));
import { POST } from "@/app/api/user/language/route";
const request = (language: string) => new Request("https://example.test/api/user/language", { method: "POST", body: new URLSearchParams({ defaultLanguage: language, userId: "other-user" }) });
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "auth-id" }); mocks.workspace.mockResolvedValue({ userId: "own-id" }); });
describe("personal language", () => {
  it("requires authentication and rejects unsupported languages", async () => {
    expect((await POST(request("fr"))).status).toBe(400);
    mocks.user.mockResolvedValue(null);
    expect((await POST(request("en"))).status).toBe(401);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("saves the signed in user's language", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    mocks.set.mockReturnValue({ where });
    expect((await POST(request("zh-CN"))).status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ defaultLanguage: "zh-CN" }));
    const { PgDialect } = await import("drizzle-orm/pg-core");
    expect(new PgDialect().sqlToQuery(where.mock.calls[0][0]).params).toEqual(["own-id"]);
  });
});
