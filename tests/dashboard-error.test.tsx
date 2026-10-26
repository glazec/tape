// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
import DashboardError from "@/app/dashboard/error";

describe("dashboard error recovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the login session and offers a full reload after a deployment error", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<DashboardError />);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByText("Returning you to sign in")).toBeNull();
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    reload.mockRestore();
  });
});
