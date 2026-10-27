// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MeetingRecordingResume } from "@/components/meeting-recording-resume";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

afterEach(() => {
  refresh.mockReset();
  vi.unstubAllGlobals();
});

describe("MeetingRecordingResume", () => {
  it("rejoins the bot under the existing meeting", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MeetingRecordingResume
        meetingId="11111111-1111-4111-8111-111111111111"
        meetingUrl="https://zoom.us/j/123456789"
        lastRecordingEndedAt={new Date(Date.now() - 60_000).toISOString()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue recording" }));

    fireEvent.click(screen.getByRole("button", { name: "Join and continue" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/meetings/11111111-1111-4111-8111-111111111111/continue", {
        body: JSON.stringify({
          meetingUrl: "https://zoom.us/j/123456789",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    });
    expect(await screen.findByText("Bot joining")).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });
});
