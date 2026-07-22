// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, replace } = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace }),
}));

import { MeetingRecoveryUploadPanel } from "@/components/meeting-recovery-upload-panel";

describe("MeetingRecoveryUploadPanel", () => {
  beforeEach(() => {
    refresh.mockReset();
    replace.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("validates missing and unsupported recovery files", async () => {
    render(<MeetingRecoveryUploadPanel meetingId="meeting_123" />);

    expect(screen.queryByLabelText("Audio file")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Audio recording" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload audio" }));
    expect(await screen.findByText("Select a recording file first")).toBeTruthy();

    chooseFile("meeting-recovery-audio", new File(["bad"], "notes.txt"));
    fireEvent.click(screen.getByRole("button", { name: "Upload audio" }));
    expect(
      await screen.findByText("Only MP3, M4A, and WebM files are supported"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    fireEvent.click(screen.getByRole("button", { name: "Add transcript" }));
    expect(
      await screen.findByText("Add transcript text or choose a transcript file"),
    ).toBeTruthy();
  });

  it("uploads audio directly and follows the server redirect", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ uploadId: "up_1", uploadUrl: "https://upload" }))
      .mockResolvedValueOnce(response({}, 200))
      .mockResolvedValueOnce(response({ redirectTo: "/meetings/meeting_123?queued=1" }));

    render(<MeetingRecoveryUploadPanel meetingId="meeting_123" />);
    fireEvent.click(screen.getByRole("button", { name: "Audio recording" }));
    chooseFile(
      "meeting-recovery-audio",
      new File(["audio"], "meeting.mp3", { type: "audio/mpeg" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Upload audio" }));

    expect(await screen.findByText("Recording uploaded. Transcription queued")).toBeTruthy();
    expect(fetch).toHaveBeenNthCalledWith(2, "https://upload", expect.objectContaining({ method: "PUT" }));
    expect(replace).toHaveBeenCalledWith("/meetings/meeting_123?queued=1");
    expect(refresh).toHaveBeenCalled();
  });

  it("falls back to the server upload when signing is unavailable", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({}));

    render(<MeetingRecoveryUploadPanel meetingId="meeting_123" />);
    fireEvent.click(screen.getByRole("button", { name: "Audio recording" }));
    chooseFile(
      "meeting-recovery-audio",
      new File(["audio"], "meeting.m4a", { type: "audio/mp4" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Upload audio" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/meetings/meeting_123"));
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/meetings/meeting_123/uploads/audio",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows sign in recovery for unauthorized audio and transcript uploads", async () => {
    vi.mocked(fetch).mockResolvedValue(response({}, 401));
    render(<MeetingRecoveryUploadPanel meetingId="meeting_123" />);

    fireEvent.click(screen.getByRole("button", { name: "Audio recording" }));
    chooseFile(
      "meeting-recovery-audio",
      new File(["audio"], "meeting.mp3", { type: "audio/mpeg" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Upload audio" }));
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    fireEvent.change(screen.getByLabelText("Paste transcript"), {
      target: { value: "  Speaker: hello  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add transcript" }));
    expect(await screen.findByText("Transcript upload failed")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
  });

  it("submits trimmed transcript text and refreshes the meeting", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({}));
    render(<MeetingRecoveryUploadPanel meetingId="meeting_123" />);

    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    fireEvent.change(screen.getByLabelText("Paste transcript"), {
      target: { value: "  Speaker: hello  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add transcript" }));

    expect(await screen.findByText("Transcript added")).toBeTruthy();
    const request = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect((request.body as FormData).get("transcriptText")).toBe("Speaker: hello");
    expect(refresh).toHaveBeenCalled();
  });
});

function chooseFile(inputId: string, file: File) {
  fireEvent.change(document.getElementById(inputId) as HTMLInputElement, {
    target: { files: [file] },
  });
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
