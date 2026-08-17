// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { MeetingList } from "@/components/meeting-list";

describe("MeetingList failed meeting recovery", () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("opens the existing recovery flow in a modal and restores trigger focus", async () => {
    render(<MeetingList meetings={[recoverableMeeting()]} />);

    const trigger = screen.getByRole("button", { name: "Rejoin Partner call" });
    fireEvent.click(trigger);

    expect(
      await screen.findByRole("dialog", { name: "Continue this meeting" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Tape did not capture a usable record. Send the bot back to the same call or use a new Google Meet or Zoom link.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Rejoin original call" }),
    ).toBe(document.activeElement);

    fireEvent.click(
      screen.getByRole("button", { name: "Use a different link" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("New meeting link")).toBe(
        document.activeElement,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(trigger).toBe(document.activeElement));
  });

  it("rejoins the original call and shows a done action", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "joining" }));
    render(<MeetingList meetings={[recoverableMeeting()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Rejoin Partner call" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Rejoin original call" }),
    );

    const done = await screen.findByRole("button", { name: "Done" });
    await waitFor(() => expect(done).toBe(document.activeElement));
    expect(fetch).toHaveBeenCalledWith(
      "/api/meetings/link",
      expect.objectContaining({
        body: JSON.stringify({
          meetingUrl: "https://zoom.us/j/123456789",
          recoveryMeetingId: "55555555-5555-4555-8555-555555555555",
        }),
      }),
    );
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(done);
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the modal open while the bot request is pending", async () => {
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => undefined));
    render(<MeetingList meetings={[recoverableMeeting()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Rejoin Partner call" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Rejoin original call" }),
    );

    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Continue this meeting" })).toBeTruthy();
  });

  it("opens directly on a replacement link when the failed meeting has no URL", async () => {
    render(
      <MeetingList
        meetings={[{ ...recoverableMeeting(), meetingUrl: null }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rejoin Partner call" }));

    expect(await screen.findByLabelText("New meeting link")).toBe(
      document.activeElement,
    );
    expect(
      screen.getByText(
        "Tape did not capture a usable record. Enter a new Google Meet or Zoom link to continue under this meeting record.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Rejoin original call" }),
    ).toBeNull();
  });
});

function recoverableMeeting() {
  return {
    canRecoverBot: true,
    id: "55555555-5555-4555-8555-555555555555",
    meetingUrl: "https://zoom.us/j/123456789",
    platform: "zoom" as const,
    startedAt: "2026-08-03T12:00:00.000Z",
    status: "failed" as const,
    title: "Partner call",
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
