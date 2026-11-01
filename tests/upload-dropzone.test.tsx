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
  ) => (pendingDuration ? pendingDuration : undefined),
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

  it("requires a destination before uploading and previews locally", async () => {
    render(<UploadDropzone />);
    selectFile(
      new File(["audio"], "meeting.mp3", { type: "audio/mpeg" }),
      false,
    );
    expect(screen.getByLabelText("Recording preview")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Upload recording",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("radio", { name: /Create a new meeting/ }),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Upload recording",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it.each([false, true])(
    "preserves the calendar destination and time through fallback=%s",
    async (fallback) => {
      const target = "22222222-2222-4222-8222-222222222222";
      const uploadId = "11111111-1111-4111-8111-111111111111";
      vi.mocked(fetch).mockImplementation(async (url) => {
        if (String(url).startsWith("/api/uploads/meeting-candidates"))
          return response({
            meetings: [
              {
                id: target,
                title: "Budget review",
                startedAt: "2026-10-19T15:30:00Z",
                endedAt: null,
                unavailableReason: null,
              },
            ],
          });
        if (url === "/api/upload")
          return response({ uploadId, uploadUrl: "https://upload" });
        if (url === "https://upload") return response({}, fallback ? 500 : 200);
        return response({
          meetingId: target,
          redirectTo: `/meetings/${target}`,
        });
      });
      render(<UploadDropzone teamId="team-a" />);
      selectFile(new File(["audio"], "meeting.m4a", { type: "audio/mp4" }));
      fireEvent.change(screen.getByLabelText("When did it start?"), {
        target: { value: "2026-10-19T11:41" },
      });
      fireEvent.change(screen.getByLabelText("Timezone"), {
        target: { value: "America/New_York" },
      });
      fireEvent.click(
        await screen.findByRole("radio", { name: /Budget review/ }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Upload to Budget review" }),
      );
      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith(`/meetings/${target}`),
      );
      const call = vi
        .mocked(fetch)
        .mock.calls.find(
          ([url]) =>
            url === (fallback ? "/api/uploads/audio" : "/api/uploads/complete"),
        )!;
      const body = fallback
        ? Object.fromEntries((call[1]?.body as FormData).entries())
        : JSON.parse(String(call[1]?.body));
      expect(body).toEqual(
        expect.objectContaining({
          meetingId: target,
          startedAt: "2026-10-19T15:41:00.000Z",
          uploadId,
        }),
      );
      expect(call[1]?.headers).toEqual(
        expect.objectContaining({ "x-tape-organization": "team-a" }),
      );
    },
  );

  it("retries completion without uploading another copy", async () => {
    let completions = 0;
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (url === "/api/upload")
        return response({ uploadId: "same-id", uploadUrl: "https://upload" });
      if (url === "https://upload") return response({});
      if (++completions === 1) throw new Error("Lost completion response");
      return response({ meetingId: "meeting-1" });
    });
    render(<UploadDropzone />);
    selectFile(new File(["audio"], "meeting.mp3", { type: "audio/mpeg" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));
    await screen.findAllByText("Upload failed");
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/meetings/meeting-1"),
    );
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => url === "https://upload"),
    ).toHaveLength(1);
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/upload"),
    ).toHaveLength(1);
  });

  it("validates missing, oversized, and unsupported files", async () => {
    render(<UploadDropzone />);
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));
    expect(
      await screen.findByText("Select a recording file first"),
    ).toBeTruthy();

    selectFile(new File(["bad"], "notes.txt"));
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));
    expect(await screen.findByText(/Only MP3/)).toBeTruthy();

    const oversized = new File(["audio"], "meeting.mp3", {
      type: "audio/mpeg",
    });
    Object.defineProperty(oversized, "size", { value: 1024 ** 3 + 1 });
    selectFile(oversized);
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));
    expect(
      await screen.findByText("Each recording file must be 1 GB or smaller"),
    ).toBeTruthy();
  });

  it.each(["picker", "drop"])(
    "uploads directly and queues transcription via %s",
    async (method) => {
      readMediaFileDurationMs.mockResolvedValueOnce(45 * 60 * 1_000);
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          response({ uploadId: "up_1", uploadUrl: "https://upload" }),
        )
        .mockResolvedValueOnce(response({}))
        .mockResolvedValueOnce(response({ redirectTo: "/meetings/new" }));
      render(<UploadDropzone />);
      const file = new File(["audio"], "meeting.mp3", { type: "audio/mpeg" });
      if (method === "drop") dropFiles([file]);
      else selectFile(file);
      fireEvent.change(screen.getByLabelText("When did it start?"), {
        target: { value: "2026-07-20T09:30" },
      });
      chooseNewMeeting();
      fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));

      expect(
        await screen.findByText("Upload complete. Transcription queued"),
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
      expect(replace).toHaveBeenCalledWith("/dashboard");
      expect(refresh).toHaveBeenCalled();
    },
  );

  it("falls back to server upload when the direct upload fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        response({ uploadId: "up_1", uploadUrl: "https://upload" }),
      )
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(response({}));
    render(<UploadDropzone />);
    selectFile(new File(["audio"], "meeting.m4a", { type: "audio/mp4" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "/api/uploads/audio",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it.each(["picker", "drop"])(
    "uploads multiple audio files in the selected order via %s",
    async (method) => {
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
        .mockResolvedValueOnce(response({ redirectTo: "/meetings/meeting_1" }));

      render(<UploadDropzone />);
      const files = [
        new File(["one"], "first.mp3", { type: "audio/mpeg" }),
        new File(["two"], "second.m4a", { type: "audio/mp4" }),
      ];
      if (method === "drop") dropFiles(files);
      else selectFiles(files);

      expect(screen.getByText("Plays in this order")).toBeTruthy();
      expect(screen.getByText("first.mp3")).toBeTruthy();
      expect(screen.getByText("second.m4a")).toBeTruthy();
      fireEvent.click(
        screen.getByRole("button", { name: "Upload recordings" }),
      );

      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith("/meetings/meeting_1"),
      );
      const batchRequest = vi.mocked(fetch).mock.calls[3]?.[1] as RequestInit;
      expect(JSON.parse(String(batchRequest.body))).toEqual({
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
    },
  );

  it("keeps the drop highlight while dragging over children and clears it on exit", () => {
    render(<UploadDropzone />);
    const input = screen.getByLabelText("Recording files");
    const zone = input.parentElement!;
    const dataTransfer = { types: ["Files"] };
    fireEvent.dragEnter(zone, { dataTransfer });
    fireEvent.dragEnter(input, { dataTransfer });
    fireEvent.dragLeave(input, { dataTransfer });
    expect(screen.getByText("Drop recording files here")).toBeTruthy();
    fireEvent.dragLeave(zone, { dataTransfer });
    expect(screen.getByText(/Drag and drop files here/)).toBeTruthy();
  });

  it("validates dropped files and ignores empty drops", async () => {
    render(<UploadDropzone />);
    dropFiles([new File(["text"], "notes.txt")]);
    dropFiles([]);
    expect(screen.getByText("notes.txt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));
    expect(await screen.findByText(/Only MP3/)).toBeTruthy();
    const oversized = new File(["audio"], "large.mp3", { type: "audio/mpeg" });
    Object.defineProperty(oversized, "size", { value: 1024 ** 3 + 1 });
    dropFiles([oversized]);
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));
    expect(
      await screen.findByText("Each recording file must be 1 GB or smaller"),
    ).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not replace files during an upload", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    render(<UploadDropzone />);
    dropFiles([new File(["audio"], "original.mp3", { type: "audio/mpeg" })]);
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));
    dropFiles([new File(["audio"], "replacement.mp3", { type: "audio/mpeg" })]);
    expect(screen.getByText("original.mp3")).toBeTruthy();
    expect(screen.queryByText("replacement.mp3")).toBeNull();
    expect(
      (screen.getByLabelText("Recording files") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Uploading recordings" }),
    ).toBeTruthy();
  });

  it("shows sign in and generic service failures", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({}, 401));
    render(<UploadDropzone />);
    selectFile(new File(["audio"], "meeting.mp3", { type: "audio/mpeg" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));
    expect(
      await screen.findByText("Sign in to upload recordings"),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();

    vi.mocked(fetch).mockResolvedValueOnce(response({}, 500));
    fireEvent.click(screen.getByRole("button", { name: "Upload recording" }));
    expect(
      (await screen.findAllByText("Upload failed")).length,
    ).toBeGreaterThan(0);
  });
});

function selectFile(file: File, choose = true) {
  selectFiles([file], choose);
}

function dropFiles(files: File[]) {
  files.forEach((file) =>
    Object.defineProperty(file, "lastModified", {
      value: 0,
      configurable: true,
    }),
  );
  fireEvent.drop(screen.getByLabelText("Recording files").parentElement!, {
    dataTransfer: { files, types: ["Files"] },
  });
  chooseNewMeeting();
}

function selectFiles(files: File[], choose = true) {
  files.forEach((file) =>
    Object.defineProperty(file, "lastModified", {
      value: 0,
      configurable: true,
    }),
  );
  fireEvent.change(screen.getByLabelText("Recording files"), {
    target: { files },
  });
  if (choose) chooseNewMeeting();
}

function chooseNewMeeting() {
  const option = screen.queryByRole("radio", { name: /Create a new meeting/ });
  if (option) fireEvent.click(option);
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
