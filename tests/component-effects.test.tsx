// @vitest-environment happy-dom

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { LocalDateTime } from "@/components/local-date-time";
import {
  MeetingAutoRefresh,
  shouldAutoRefreshMeeting,
} from "@/components/meeting-auto-refresh";
import {
  formatMeetingHeaderDateTime,
  formatMeetingHeaderDuration,
  MeetingHeaderMetadata,
} from "@/components/meeting-header-metadata";
import { OneSignalLogin } from "@/components/onesignal-login";
import { getMeetingDisplayStatus } from "@/lib/meeting-display-status";

describe("client component effects", () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete window.MeetingNoteOneSignalReady;
  });

  it("refreshes active meetings and clears polling on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(<MeetingAutoRefresh meetingStatus="processing" segmentCount={0} />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(refresh).toHaveBeenCalledTimes(2);
    unmount();
    act(() => vi.advanceTimersByTime(5_000));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not poll terminal meetings", () => {
    vi.useFakeTimers();
    render(<MeetingAutoRefresh meetingStatus="ready" segmentCount={0} />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(refresh).not.toHaveBeenCalled();
    expect(shouldAutoRefreshMeeting({
      meetingStatus: "processing",
      segmentCount: 0,
      transcriptJobStatus: "failed",
    })).toBe(false);
    expect(getMeetingDisplayStatus({
      meetingStatus: "processing",
      transcriptJobStatus: "failed",
    })).toBe("failed");
  });

  it("logs in to OneSignal only on allowed origins", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    window.MeetingNoteOneSignalReady = Promise.resolve({ login });
    const { rerender } = render(<OneSignalLogin allowedOrigins={[window.location.origin]} externalId="user_1" />);
    await act(async () => Promise.resolve());
    expect(login).toHaveBeenCalledWith("user_1");
    rerender(<OneSignalLogin allowedOrigins={["https://other.example"]} externalId="user_2" />);
    await act(async () => Promise.resolve());
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("contains OneSignal SDK failures", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    window.MeetingNoteOneSignalReady = Promise.resolve({ login: vi.fn().mockRejectedValue(new Error("denied")) });
    render(<OneSignalLogin allowedOrigins={[window.location.origin]} externalId="user_1" />);
    await act(async () => Promise.resolve());
    expect(warning).toHaveBeenCalledWith("OneSignal login failed", expect.any(Error));
  });

  it("ignores an empty OneSignal external id", async () => {
    const login = vi.fn();
    window.MeetingNoteOneSignalReady = Promise.resolve({ login });
    render(<OneSignalLogin allowedOrigins={[window.location.origin]} externalId="" />);
    await act(async () => Promise.resolve());
    expect(login).not.toHaveBeenCalled();
  });

  it("renders local date, duration, and status metadata", () => {
    render(<>
      <LocalDateTime value="2026-07-20T12:30:00.000Z" />
      <MeetingHeaderMetadata
        durationMs={null}
        endedAt="2026-07-20T13:35:00.000Z"
        platform="Zoom"
        startedAt="2026-07-20T12:30:00.000Z"
        status="Ready"
      />
    </>);
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("Zoom")).toBeTruthy();
    expect(screen.getByText("1h 5m")).toBeTruthy();
    expect(document.querySelector("time")?.textContent?.trim()).toBeTruthy();
  });

  it("formats meeting date and duration edge cases", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    expect(formatMeetingHeaderDateTime("invalid", now)).toBe("");
    expect(formatMeetingHeaderDateTime("2026-07-19T12:00:00.000Z", now)).toContain("Yesterday");
    expect(formatMeetingHeaderDateTime("2025-07-20T12:00:00.000Z", now)).toContain("2025");
    expect(formatMeetingHeaderDuration({
      durationMs: 0,
      endedAt: null,
      startedAt: null,
    })).toBeNull();
    expect(formatMeetingHeaderDuration({
      durationMs: 60 * 60 * 1_000,
      endedAt: null,
      startedAt: null,
    })).toBe("1h");
  });
});
