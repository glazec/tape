// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { MeetingRecordingResume } from "@/components/meeting-recording-resume";
import { MeetingMergeDialog } from "@/components/meeting-merge-dialog";

const now = Date.parse("2026-10-27T16:00:00Z");
const endedAt = new Date(now - 30 * 60 * 1000).toISOString();

beforeEach(() => {
  refresh.mockReset();
  vi.spyOn(Date, "now").mockReturnValue(now);
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Continue recording", () => {
  it("submits the new link without a personal name, preserving the draft after a failure", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json(
          { error: "The bot could not join. Try again." },
          { status: 502 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ status: "joining" }));
    render(
      <MeetingRecordingResume
        meetingId="meeting/one"
        meetingUrl="https://zoom.us/j/123"
        lastRecordingEndedAt={endedAt}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue recording" }));
    const input = screen.getByRole("textbox", { name: "Meeting link" });
    fireEvent.change(input, {
      target: { value: "https://meet.google.com/abc-defg-hij" },
    });
    expect(screen.queryByText("Name shown in meeting")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Join and continue" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "The bot could not join. Try again.",
    );
    expect(input).toHaveProperty(
      "value",
      "https://meet.google.com/abc-defg-hij",
    );
    fireEvent.click(screen.getByRole("button", { name: "Join and continue" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/meetings/meeting%2Fone/continue",
      expect.objectContaining({
        body: JSON.stringify({
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        }),
      }),
    );
    expect(screen.getByRole("status").textContent).toContain(
      "once the bot joins",
    );
  });

  it("refreshes a pending request conflict while preserving its explanation and link", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(
        {
          error:
            "The previous join request is still being confirmed. Refresh shortly.",
        },
        { status: 409 },
      ),
    );
    render(
      <MeetingRecordingResume
        meetingId="meeting"
        meetingUrl="https://zoom.us/j/123"
        lastRecordingEndedAt={endedAt}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue recording" }));
    fireEvent.click(screen.getByRole("button", { name: "Join and continue" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "still being confirmed",
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("textbox", { name: "Meeting link" }),
    ).toHaveProperty("value", "https://zoom.us/j/123");
  });

  it("does not offer continuation at the one hour boundary", () => {
    render(
      <MeetingRecordingResume
        meetingId="meeting"
        meetingUrl="https://zoom.us/j/123"
        lastRecordingEndedAt={new Date(now - 60 * 60 * 1000).toISOString()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Continue recording" }),
    ).toBeNull();
  });

  it("explains expiration inside an open dialog and removes the action after closing", async () => {
    vi.useFakeTimers();
    render(
      <MeetingRecordingResume
        meetingId="meeting"
        meetingUrl="https://zoom.us/j/123"
        lastRecordingEndedAt={new Date(
          now - 60 * 60 * 1000 + 1000,
        ).toISOString()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue recording" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "one hour window has ended",
    );
    expect(
      screen.queryByRole("button", { name: "Join and continue" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(
      screen.queryByRole("button", { name: "Continue recording" }),
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Merge meetings", () => {
  it("merges a meeting whose transcript is processing and provides undo", async () => {
    const source = {
      id: "source",
      title: "Conversation part two",
      startedAt: "2026-10-27T15:00:00Z",
      status: "processing",
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({ candidates: [source], merged: [] }),
      )
      .mockResolvedValueOnce(Response.json({ merged: true }))
      .mockResolvedValueOnce(Response.json({ merged: false }));
    const onOpenChange = vi.fn();
    const props = {
      meetingId: "destination",
      title: "Product conversation",
      onOpenChange,
      finalFocus: createRef<HTMLElement>(),
    };
    const view = render(<MeetingMergeDialog {...props} open />);
    const candidate = await screen.findByRole("radio");
    expect(screen.getByText(/Transcript processing/)).toBeTruthy();
    fireEvent.click(candidate);
    fireEvent.click(screen.getByRole("button", { name: "Merge meetings" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(fetch).toHaveBeenCalledWith(
      "/api/meetings/destination/merge",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sourceMeetingId: "source" }),
      }),
    );
    view.rerender(<MeetingMergeDialog {...props} open={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo merge" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(fetch).toHaveBeenCalledWith(
      "/api/meetings/destination/merge",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ sourceMeetingId: "source" }),
      }),
    );
  });

  it("retains selection and explains a rejected merge", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          candidates: [
            {
              id: "source",
              title: "Part two",
              startedAt: null,
              status: "ready",
            },
          ],
          merged: [],
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          { error: "Meeting sharing changed. Reload the list." },
          { status: 409 },
        ),
      );
    const onOpenChange = vi.fn();
    render(
      <MeetingMergeDialog
        meetingId="meeting"
        title="First part"
        open
        onOpenChange={onOpenChange}
        finalFocus={createRef<HTMLElement>()}
      />,
    );
    fireEvent.click(await screen.findByRole("radio"));
    fireEvent.click(screen.getByRole("button", { name: "Merge meetings" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Meeting sharing changed",
    );
    expect(screen.getByRole("radio")).toHaveProperty("checked", true);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
