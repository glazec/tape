// @vitest-environment happy-dom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

import DashboardError, {
  recoverDashboardSession,
} from "@/app/dashboard/error";

describe("dashboard error recovery", () => {
  beforeEach(() => {
    replace.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("clears the failed session before returning to sign in", async () => {
    let finishSessionCleanup: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishSessionCleanup = resolve;
        }),
    );

    render(<DashboardError />);

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/sign-out", { method: "POST" }),
    );
    expect(replace).not.toHaveBeenCalled();

    finishSessionCleanup?.(new Response(null, { status: 204 }));

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        "/auth/sign-in?reason=dashboard_load_failed",
      ),
    );
    expect(
      screen
        .getByRole("link", { name: "Continue to sign in" })
        .getAttribute("href"),
    ).toBe(
      "/auth/sign-in?reason=dashboard_load_failed",
    );
  });

  it("still returns to sign in when session cleanup fails", async () => {
    const returnToSignIn = vi.fn();

    await recoverDashboardSession({
      clearSession: vi.fn().mockRejectedValue(new Error("Unavailable")),
      returnToSignIn,
    });

    expect(returnToSignIn).toHaveBeenCalledOnce();
  });
});
