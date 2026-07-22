// @vitest-environment happy-dom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { MeetingActions } from "@/components/meeting-actions";

describe("MeetingActions interactions", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("downloads only selected formats and closes from outside interactions", () => {
    vi.useFakeTimers();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<MeetingActions imageCount={2} meetingId="meeting/one" />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByLabelText("MP3"));
    fireEvent.click(screen.getByRole("button", { name: "Download selected" }));
    act(() => vi.runAllTimers());
    expect(click).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.mouseDown(document.body);
    expect((document.querySelector('[aria-label="Export options"]') as HTMLElement).hidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect((document.querySelector('[aria-label="Export options"]') as HTMLElement).hidden).toBe(true);
  });

  it("disables download when every available format is cleared", () => {
    render(<MeetingActions meetingId="meeting" />);
    fireEvent.click(screen.getByLabelText("Transcript"));
    fireEvent.click(screen.getByLabelText("MP3"));
    expect((screen.getByRole("button", { name: "Download selected", hidden: true }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("copies transcript and resets the copied state", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(new Response("Transcript text"));
    render(<MeetingActions meetingId="meeting" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await act(async () => Promise.resolve());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Transcript text");
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("reports copy failures", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }));
    render(<MeetingActions meetingId="meeting" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText("Could not copy transcript.")).toBeTruthy();
  });

  it("honors delete confirmation and handles success and failure", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValueOnce(false).mockReturnValue(true));
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    render(<MeetingActions meetingId="meeting/one" />);
    fireEvent.click(screen.getByLabelText("More meeting actions"));
    fireEvent.click(screen.getByRole("button", { name: "Delete meeting" }));
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete meeting" }));
    expect(await screen.findByText("Could not delete this meeting.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete meeting" }));
    await act(async () => Promise.resolve());
    expect(push).toHaveBeenCalledWith("/dashboard");
    expect(refresh).toHaveBeenCalled();
  });
});
