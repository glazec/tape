// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

    fireEvent.click(
      screen.getByRole("button", { name: "Rejoin original call" }),
    );

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
    expect(
      screen.queryByRole("button", { name: "Rejoin original call" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Use original link" }),
    ).toBeTruthy();
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
      screen.queryByRole("button", { name: "Rejoin original call" }),
    ).toBeNull();
  });

  it("returns focus to the original action from the card replacement flow", async () => {
    render(
      <MeetingBotRecoveryPanel
        meetingId="meeting_123"
        meetingUrl="https://meet.google.com/original"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Use a different link" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Use original link" }),
    );

    const originalAction = screen.getByRole("button", {
      name: "Rejoin original call",
    });
    await waitFor(() => expect(originalAction).toBe(document.activeElement));
  });

  it("announces loading and keeps a failed rejoin recoverable", async () => {
    let resolveRequest: (value: Response) => void = () => undefined;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    render(
      <MeetingBotRecoveryPanel
        meetingId="meeting_123"
        meetingUrl="https://meet.google.com/original"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Rejoin original call" }),
    );

    expect(
      screen
        .getByRole("button", { name: "Rejoining..." })
        .getAttribute("aria-busy"),
    ).toBe("true");
    resolveRequest(response({ error: "Meeting is no longer available" }, 409));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Meeting is no longer available",
    );
    expect(
      (screen.getByRole("button", {
        name: "Rejoin original call",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
