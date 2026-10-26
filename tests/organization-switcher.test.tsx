// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
import { OrganizationSwitcher } from "@/components/organization-switcher";
const organizations = [{ teamId: "first", teamName: "First" }, { teamId: "second", teamName: "Second" }];
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("organization switcher", () => {
  it("changes the workspace before refreshing the dashboard", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ teamId: "first", organizations })).mockResolvedValueOnce(response({ teamId: "second" }));
    vi.stubGlobal("fetch", fetch);
    render(<OrganizationSwitcher />);
    fireEvent.change(await screen.findByLabelText("Organization"), { target: { value: "second" } });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ teamId: "second" });
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("keeps the current workspace if the server rejects the change", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ teamId: "first", organizations })).mockResolvedValueOnce(response({}, 403)));
    render(<OrganizationSwitcher />);
    fireEvent.change(await screen.findByLabelText("Organization"), { target: { value: "second" } });
    await screen.findByRole("alert");
    expect((screen.getByLabelText("Organization") as HTMLSelectElement).value).toBe("first");
    expect(push).not.toHaveBeenCalled();
  });
  it("hides the control when there is only one workspace", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ teamId: "first", organizations: organizations.slice(0, 1) }));
    vi.stubGlobal("fetch", fetch);
    render(<OrganizationSwitcher />);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(screen.queryByLabelText("Organization")).toBeNull();
  });
});
