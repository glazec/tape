// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readMediaFileDurationMs, refresh, replace } = vi.hoisted(() => ({
  readMediaFileDurationMs: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace }),
}));
vi.mock("@/lib/recording-duration", () => ({
  readMediaFileDurationMs,
  waitForRecordingDurationMs: async (
    pendingDuration: Promise<number | undefined> | null,
  ) => (pendingDuration ? pendingDuration : undefined),
}));

import { MeetingRecoveryUploadPanel } from "@/components/meeting-recovery-upload-panel";

describe("MeetingRecoveryUploadPanel", () => {
  beforeEach(() => {
    refresh.mockReset();
    replace.mockReset();
    readMediaFileDurationMs.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("offers a dedicated replacement form without starting upload on file selection", () => {
    render(
      <MeetingRecoveryUploadPanel meetingId="meeting_replace" replaceAudio />,
    );
    expect(screen.queryByRole("button", { name: "Transcript" })).toBeNull();
    expect(
      screen.getByRole("region", { name: "Replacement audio upload" }),
    ).toBeTruthy();
    chooseFile(
      "meeting-recovery-audio",
      new File(["audio"], "correct.mp3", { type: "audio/mpeg" }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uploads replacement audio to the existing meeting and queues a new transcript", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        response({ uploadId: "replacement", uploadUrl: "https://upload" }),
      )
      .mockResolvedValueOnce(response({}, 200))
      .mockResolvedValueOnce(
        response({ redirectTo: "/meetings/same-meeting" }),
      );
    render(
      <MeetingRecoveryUploadPanel meetingId="same-meeting" replaceAudio />,
    );
    chooseFile(
      "meeting-recovery-audio",
      new File(["audio"], "correct.mp3", { type: "audio/mpeg" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Replace audio" }));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/meetings/same-meeting"),
    );
    expect(vi.mocked(fetch).mock.calls[2][0]).toBe(
      "/api/meetings/same-meeting/uploads/audio/complete",
    );
  });

  it("validates missing and unsupported recovery files", async () => {
    render(<MeetingRecoveryUploadPanel meetingId="meeting_123" />);

    expect(screen.queryByLabelText("Audio file")).toBeNull();
    const audioChoice = screen.getByRole("button", {
      name: "Audio recording",
    });
    expect(audioChoice.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(audioChoice);
    expect(audioChoice.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.getElementById(audioChoice.getAttribute("aria-controls") ?? ""),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Upload audio" }));
    expect(
      await screen.findByText("Select a recording file first"),
    ).toBeTruthy();

    chooseFile("meeting-recovery-audio", new File(["bad"], "notes.txt"));
    fireEvent.click(screen.getByRole("button", { name: "Upload audio" }));
    expect(
      await screen.findByText("Only MP3, M4A, and WebM files are supported"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    fireEvent.click(screen.getByRole("button", { name: "Add transcript" }));
    expect(
      await screen.findByText(
        "Add transcript text or choose a transcript file",
      ),
    ).toBeTruthy();
  });

  it.each(["picker", "drop"])(
    "uploads audio directly via %s and follows the server redirect",
    async (method) => {
      readMediaFileDurationMs.mockResolvedValueOnce(45 * 60 * 1_000);
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          response({ uploadId: "up_1", uploadUrl: "https://upload" }),
        )
        .mockResolvedValueOnce(response({}, 200))
        .mockResolvedValueOnce(
          response({ redirectTo: "/meetings/meeting_123?queued=1" }),
        );

      render(<MeetingRecoveryUploadPanel meetingId="meeting_123" />);
      fireEvent.click(screen.getByRole("button", { name: "Audio recording" }));
      const file = new File(["audio"], "meeting.mp3", { type: "audio/mpeg" });
      if (method === "drop") dropFiles("Audio files", [file]);
      else chooseFile("meeting-recovery-audio", file);
      fireEvent.click(screen.getByRole("button", { name: "Upload audio" }));

      expect(
        await screen.findByText("Recording uploaded. Transcription queued"),
      ).toBeTruthy();
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        "https://upload",
        expect.objectContaining({ method: "PUT" }),
      );
      expect(
        JSON.parse(
          String((vi.mocked(fetch).mock.calls[2]?.[1] as RequestInit).body),
        ),
      ).toEqual(expect.objectContaining({ durationMs: 45 * 60 * 1_000 }));
      expect(replace).toHaveBeenCalledWith("/meetings/meeting_123?queued=1");
      expect(refresh).toHaveBeenCalled();
    },
  );

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

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/meetings/meeting_123"),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/meetings/meeting_123/uploads/audio",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it.each(["picker", "drop"])(
    "uploads multiple audio files in order via %s",
    async (method) => {
      readMediaFileDurationMs
        .mockResolvedValueOnce(60_000)
        .mockResolvedValueOnce(90_000);
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          response({
            uploads: [
              { uploadId: "up_1", uploadUrl: "https://upload/1" },
              { uploadId: "up_2", uploadUrl: "https://upload/2" },
            ],
          }),
        )
        .mockResolvedValueOnce(response({}))
        .mockResolvedValueOnce(response({}))
        .mockResolvedValueOnce(
          response({ redirectTo: "/meetings/meeting_123?queued=1" }),
        );

      render(<MeetingRecoveryUploadPanel meetingId="meeting_123" />);
      fireEvent.click(screen.getByRole("button", { name: "Audio recording" }));
      const files = [
        new File(["one"], "first.mp3", { type: "audio/mpeg" }),
        new File(["two"], "second.m4a", { type: "audio/mp4" }),
      ];
      if (method === "drop") dropFiles("Audio files", files);
      else chooseFiles("meeting-recovery-audio", files);

      expect(screen.getByText("first.mp3")).toBeTruthy();
      expect(screen.getByText("second.m4a")).toBeTruthy();
      fireEvent.click(
        screen.getByRole("button", { name: "Upload audio files" }),
      );

      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith("/meetings/meeting_123?queued=1"),
      );
      expect(fetch).toHaveBeenNthCalledWith(
        4,
        "/api/meetings/meeting_123/uploads/audio/batch/complete",
        expect.objectContaining({ method: "POST" }),
      );
      const request = vi.mocked(fetch).mock.calls[3]?.[1] as RequestInit;
      expect(JSON.parse(String(request.body)).files).toEqual([
        expect.objectContaining({ uploadId: "up_1", durationMs: 60_000 }),
        expect.objectContaining({ uploadId: "up_2", durationMs: 90_000 }),
      ]);
    },
  );

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

  it("drops a transcript, clears pasted text, and submits the file", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({}));
    render(<MeetingRecoveryUploadPanel meetingId="meeting_123" />);
    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    fireEvent.change(screen.getByLabelText("Paste transcript"), {
      target: { value: "Old text" },
    });
    dropFiles("Transcript file", [new File(["Speaker: hello"], "meeting.txt")]);
    expect(screen.getByText("meeting.txt")).toBeTruthy();
    expect(
      (screen.getByLabelText("Paste transcript") as HTMLTextAreaElement).value,
    ).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Add transcript" }));
    expect(await screen.findByText("Transcript added")).toBeTruthy();
    const body = vi.mocked(fetch).mock.calls[0][1]?.body as FormData;
    expect((body.get("transcript-file") as File).name).toBe("meeting.txt");
    expect(body.has("transcriptText")).toBe(false);
  });

  it("rejects multiple transcripts without discarding pasted text", () => {
    render(<MeetingRecoveryUploadPanel meetingId="meeting_123" />);
    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    fireEvent.change(screen.getByLabelText("Paste transcript"), {
      target: { value: "Keep this" },
    });
    dropFiles("Transcript file", [
      new File(["one"], "one.txt"),
      new File(["two"], "two.txt"),
    ]);
    expect(
      screen.getByText("Choose one transcript file at a time"),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Paste transcript") as HTMLTextAreaElement).value,
    ).toBe("Keep this");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates dropped audio and ignores empty drops", async () => {
    render(<MeetingRecoveryUploadPanel meetingId="meeting_123" />);
    fireEvent.click(screen.getByRole("button", { name: "Audio recording" }));
    dropFiles("Audio files", [new File(["bad"], "notes.txt")]);
    dropFiles("Audio files", []);
    expect(screen.getByText("notes.txt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Upload audio" }));
    expect(
      await screen.findByText("Only MP3, M4A, and WebM files are supported"),
    ).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps nested drag feedback stable and ignores drops during upload", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    render(<MeetingRecoveryUploadPanel meetingId="meeting_123" />);
    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    const input = screen.getByLabelText("Transcript file");
    const zone = input.parentElement!;
    const dataTransfer = { types: ["Files"] };
    fireEvent.dragEnter(zone, { dataTransfer });
    fireEvent.dragEnter(input, { dataTransfer });
    fireEvent.dragLeave(input, { dataTransfer });
    expect(screen.getByText("Drop transcript file here")).toBeTruthy();
    fireEvent.dragLeave(zone, { dataTransfer });
    expect(screen.getByText(/Drag and drop a transcript/)).toBeTruthy();
    dropFiles("Transcript file", [new File(["one"], "original.txt")]);
    fireEvent.click(screen.getByRole("button", { name: "Add transcript" }));
    dropFiles("Transcript file", [new File(["two"], "replacement.txt")]);
    expect(screen.getByText("original.txt")).toBeTruthy();
    expect(screen.queryByText("replacement.txt")).toBeNull();
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
    expect((request.body as FormData).get("transcriptText")).toBe(
      "Speaker: hello",
    );
    expect(refresh).toHaveBeenCalled();
  });
});

function chooseFile(inputId: string, file: File) {
  chooseFiles(inputId, [file]);
}

function chooseFiles(inputId: string, files: File[]) {
  fireEvent.change(
    document.querySelector(`[name="${inputId}"]`) as HTMLInputElement,
    {
      target: { files },
    },
  );
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function dropFiles(label: string, files: File[]) {
  fireEvent.drop(screen.getByLabelText(label).parentElement!, {
    dataTransfer: { files, types: ["Files"] },
  });
}
