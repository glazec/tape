// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { MeetingBotRecoveryPanel } from "@/components/meeting-bot-recovery-panel";

describe("MeetingBotRecoveryPanel", () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("rejoins the original call under the same meeting", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ status: "joining" }));
    render(
      <MeetingBotRecoveryPanel
        meetingId="meeting_123"
        meetingUrl="https://meet.google.com/original"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ask bot to rejoin" }));

    expect(await screen.findByText("The bot is joining this meeting again.")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      "/api/meetings/link",
      expect.objectContaining({
        body: JSON.stringify({
          meetingUrl: "https://meet.google.com/original",
          recoveryMeetingId: "meeting_123",
        }),
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("accepts a replacement meeting link", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ status: "joining" }));
    render(
      <MeetingBotRecoveryPanel
        meetingId="meeting_123"
        meetingUrl="https://meet.google.com/original"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Use a different link" }),
    );
    fireEvent.change(screen.getByLabelText("New meeting link"), {
      target: { value: "https://zoom.us/j/123456789" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Send bot to new link" }),
    );

    expect(await screen.findByText("The bot is joining this meeting again.")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      "/api/meetings/link",
      expect.objectContaining({
        body: JSON.stringify({
          meetingUrl: "https://zoom.us/j/123456789",
          recoveryMeetingId: "meeting_123",
        }),
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Ask bot to rejoin" }),
    ).toBeNull();
  });
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
