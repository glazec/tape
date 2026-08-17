// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readMediaFileDurationMs, refresh, replace } = vi.hoisted(() => ({
  readMediaFileDurationMs: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace }) }));
vi.mock("@/lib/recording-duration", () => ({
  readMediaFileDurationMs,
  waitForRecordingDurationMs: async (
    pendingDuration: Promise<number | undefined> | null,
  ) => pendingDuration ? pendingDuration : undefined,
}));

import { UploadDropzone } from "@/components/upload-dropzone";

describe("UploadDropzone", () => {
  beforeEach(() => {
    refresh.mockReset();
    replace.mockReset();
    readMediaFileDurationMs.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("validates missing, oversized, and unsupported files", async () => {
    render(<UploadDropzone />);
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));
    expect(await screen.findByText("Select a recording file first")).toBeTruthy();

    selectFile(new File(["bad"], "notes.txt"));
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));
    expect(await screen.findByText(/Only MP3/)).toBeTruthy();

    const oversized = new File(["audio"], "meeting.mp3", { type: "audio/mpeg" });
    Object.defineProperty(oversized, "size", { value: 1024 ** 3 + 1 });
    selectFile(oversized);
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));
    expect(
      await screen.findByText("Each recording file must be 1 GB or smaller"),
    ).toBeTruthy();
  });

  it("uploads directly and queues transcription", async () => {
    readMediaFileDurationMs.mockResolvedValueOnce(45 * 60 * 1_000);
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ uploadId: "up_1", uploadUrl: "https://upload" }))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ redirectTo: "/meetings/new" }));
    render(<UploadDropzone />);
    selectFile(new File(["audio"], "meeting.mp3", { type: "audio/mpeg" }));
    fireEvent.change(screen.getByLabelText("When did it start?"), {
      target: { value: "2026-07-20T09:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));

    expect(await screen.findByText("Upload complete. Transcription queued")).toBeTruthy();
    expect(fetch).toHaveBeenNthCalledWith(2, "https://upload", expect.objectContaining({ method: "PUT" }));
    expect(
      JSON.parse(
        String((vi.mocked(fetch).mock.calls[2]?.[1] as RequestInit).body),
      ),
    ).toEqual(expect.objectContaining({ durationMs: 45 * 60 * 1_000 }));
    expect(replace).toHaveBeenCalledWith("/dashboard");
    expect(refresh).toHaveBeenCalled();
  });

  it("falls back to server upload when the direct upload fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ uploadId: "up_1", uploadUrl: "https://upload" }))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(response({}));
    render(<UploadDropzone />);
    selectFile(new File(["audio"], "meeting.m4a", { type: "audio/mp4" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(fetch).toHaveBeenNthCalledWith(3, "/api/uploads/audio", expect.objectContaining({ method: "POST" }));
  });

  it("uploads multiple audio files in the selected order", async () => {
    readMediaFileDurationMs
      .mockResolvedValueOnce(60_000)
      .mockResolvedValueOnce(120_000);
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
        response({ redirectTo: "/meetings/meeting_1" }),
      );

    render(<UploadDropzone />);
    selectFiles([
      new File(["one"], "first.mp3", { type: "audio/mpeg" }),
      new File(["two"], "second.m4a", { type: "audio/mp4" }),
    ]);

    expect(screen.getByText("Plays in this order")).toBeTruthy();
    expect(screen.getByText("first.mp3")).toBeTruthy();
    expect(screen.getByText("second.m4a")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Upload recordings" }));

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/meetings/meeting_1"),
    );
    const batchRequest = vi.mocked(fetch).mock.calls[3]?.[1] as RequestInit;
    expect(
      JSON.parse(String(batchRequest.body)),
    ).toEqual({
      files: [
        {
          contentType: "audio/mpeg",
          durationMs: 60_000,
          extension: "mp3",
          fileName: "first.mp3",
          uploadId: "up_1",
        },
        {
          contentType: "audio/mp4",
          durationMs: 120_000,
          extension: "m4a",
          fileName: "second.m4a",
          uploadId: "up_2",
        },
      ],
      startedAt: expect.any(String),
    });
  });

  it("shows sign in and generic service failures", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({}, 401));
    render(<UploadDropzone />);
    selectFile(new File(["audio"], "meeting.mp3", { type: "audio/mpeg" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));
    expect(await screen.findByText("Sign in to upload recordings")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();

    vi.mocked(fetch).mockResolvedValueOnce(response({}, 500));
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));
    expect((await screen.findAllByText("Upload failed")).length).toBeGreaterThan(0);
  });
});

function selectFile(file: File) {
  selectFiles([file]);
}

function selectFiles(files: File[]) {
  fireEvent.change(screen.getByLabelText("Recording files"), {
    target: { files },
  });
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
