// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, replace } = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace }) }));

import { CalendarSyncButton } from "@/components/calendar-sync-button";

describe("CalendarSyncButton interactions", () => {
  beforeEach(() => {
    refresh.mockReset();
    replace.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("syncs manually and refreshes the dashboard", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ syncedEventCount: 2 }));
    render(<CalendarSyncButton />);
    fireEvent.click(screen.getByRole("button", { name: "Sync calendar" }));
    expect(await screen.findByText("Captured 2 upcoming calendar events.")).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("auto syncs once and removes the OAuth query through replace", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ failedEventCount: 1, syncedEventCount: 1 }));
    const { rerender } = render(<CalendarSyncButton autoSync />);
    expect(await screen.findByText(/1 event needs review/)).toBeTruthy();
    expect(replace).toHaveBeenCalledWith("/dashboard");
    rerender(<CalendarSyncButton autoSync />);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("offers reconnection when calendar access expired", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ reconnect: true }, 409));
    render(<CalendarSyncButton />);
    fireEvent.click(screen.getByRole("button", { name: "Sync calendar" }));
    expect(await screen.findByText(/Calendar access expired/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect calendar" })).toBeTruthy();
  });

  it("reports sync network failures", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));
    render(<CalendarSyncButton />);
    fireEvent.click(screen.getByRole("button", { name: "Sync calendar" }));
    expect(await screen.findByText(/could not be captured/)).toBeTruthy();
  });

  it("disconnects after confirmation and reports service failures", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    vi.mocked(fetch).mockResolvedValueOnce(response({}));
    const { unmount } = render(<CalendarSyncButton />);
    openDisconnect();
    expect(await screen.findByText(/Existing meeting transcripts were kept/)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
    unmount();

    vi.mocked(fetch).mockReset().mockResolvedValueOnce(response({}, 500));
    render(<CalendarSyncButton />);
    openDisconnect();
    expect(await screen.findByText("Calendar could not be disconnected.")).toBeTruthy();
  });

  it("does not disconnect when confirmation is declined", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    render(<CalendarSyncButton />);
    openDisconnect();
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });
});

function openDisconnect() {
  fireEvent.click(screen.getByRole("button", { name: "Calendar options" }));
  fireEvent.click(screen.getByText("Disconnect calendar"));
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
