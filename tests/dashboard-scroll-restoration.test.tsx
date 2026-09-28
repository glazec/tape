// @vitest-environment happy-dom

import Link from "next/link";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardScrollRestoration } from "@/components/dashboard-scroll-restoration";

let resize: () => void;
const disconnect = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  window.history.replaceState({ __NA: true }, "", "/dashboard?page=3&q=customer");
  disconnect.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function openMeeting() {
  vi.spyOn(window, "scrollY", "get").mockReturnValue(1450);
  const view = render(<><DashboardScrollRestoration /><Link href="/meetings/123" onClick={(event) => event.preventDefault()}>Meeting</Link></>);
  fireEvent.click(view.getByText("Meeting"));
  view.unmount();
}

function frame() {
  act(() => vi.advanceTimersByTime(20));
}

describe("dashboard scroll restoration", () => {
  it("restores the previous list position after returning, including delayed streamed layout", () => {
    openMeeting();
    const dashboardEntry = window.history.state;
    expect(dashboardEntry.__NA).toBe(true);
    window.history.replaceState({ __NA: true }, "", "/meetings/123");
    window.history.replaceState(dashboardEntry, "", "/dashboard?page=3&q=customer");
    render(<DashboardScrollRestoration />);
    frame();
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 1450, behavior: "instant" });
    vi.mocked(window.scrollTo).mockClear();
    act(() => resize());
    frame();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 1450, behavior: "instant" });
  });

  it("does not restore a fresh dashboard visit or another filtered page", () => {
    const view = render(<DashboardScrollRestoration />);
    frame();
    expect(window.scrollTo).not.toHaveBeenCalled();
    view.unmount();
    openMeeting();
    window.history.replaceState(window.history.state, "", "/dashboard?page=4");
    render(<DashboardScrollRestoration />);
    frame();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("keeps waiting when the streamed list takes longer than ten seconds", () => {
    openMeeting();
    render(<DashboardScrollRestoration />);
    act(() => vi.advanceTimersByTime(12_000));
    expect(disconnect).not.toHaveBeenCalled();
    vi.mocked(window.scrollTo).mockClear();
    act(() => resize());
    frame();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 1450, behavior: "instant" });
  });

  it.each(["wheel", "touchstart", "pointerdown", "keydown", "popstate"])("stops restoring when %s occurs", (type) => {
    openMeeting();
    render(<DashboardScrollRestoration />);
    window.dispatchEvent(new Event(type));
    // A resize notification already queued before disconnect must not restart it.
    act(() => resize());
    frame();
    expect(disconnect).toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("ignores opening meetings in another tab and unrelated navigation", () => {
    const view = render(<><DashboardScrollRestoration /><Link href="/meetings/123" onClick={(event) => event.preventDefault()}>Meeting</Link><Link href="/meetings/new" onClick={(event) => event.preventDefault()}>New</Link></>);
    fireEvent.click(view.getByText("Meeting"), { metaKey: true });
    fireEvent.click(view.getByText("New"));
    expect(window.history.state).toEqual({ __NA: true });
  });

  it("cleans up pending restoration when unmounted", () => {
    openMeeting();
    const view = render(<DashboardScrollRestoration />);
    view.unmount();
    frame();
    expect(disconnect).toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
