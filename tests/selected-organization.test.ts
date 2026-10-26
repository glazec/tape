import { beforeEach, describe, expect, it, vi } from "vitest";
const { cookies, headers } = vi.hoisted(() => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/headers", () => ({ cookies, headers }));
import { getSelectedOrganization } from "@/lib/selected-organization";
beforeEach(() => vi.resetAllMocks());
describe("organization request context", () => {
  it("pins an in-flight form to its explicit organization even if another tab switches", async () => {
    headers.mockResolvedValue(new Headers({ "x-tape-organization": "form-team" }));
    cookies.mockResolvedValue({ get: () => ({ value: "other-tab-team" }) });
    expect(await getSelectedOrganization()).toEqual({ teamId: "form-team", required: true });
    expect(cookies).not.toHaveBeenCalled();
  });
  it("uses browser selection when there is no explicit form context", async () => {
    headers.mockResolvedValue(new Headers());
    cookies.mockResolvedValue({ get: () => ({ value: "browser-team" }) });
    expect(await getSelectedOrganization()).toEqual({ teamId: "browser-team", required: false });
  });
  it("does not require browser context in background jobs", async () => {
    headers.mockRejectedValue(new Error("No request context"));
    expect(await getSelectedOrganization()).toBeUndefined();
  });
});
