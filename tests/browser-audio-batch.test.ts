// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadAudioBatch } from "@/lib/browser-audio-batch";
import { getUploadMediaFromFile } from "@/lib/upload-media";

describe("uploadAudioBatch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps successful direct uploads and stages only the remaining files", async () => {
    const files = [
      new File(["one"], "one.mp3", { type: "audio/mpeg" }),
      new File(["two"], "two.mp3", { type: "audio/mpeg" }),
      new File(["three"], "three.mp3", { type: "audio/mpeg" }),
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          uploads: [
            { uploadId: "direct_1", uploadUrl: "https://upload/1" },
            { uploadId: "direct_2", uploadUrl: "https://upload/2" },
            { uploadId: "direct_3", uploadUrl: "https://upload/3" },
          ],
        }),
      )
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({}, 500))
      .mockResolvedValueOnce(response({ uploads: [{ uploadId: "server_2" }] }))
      .mockResolvedValueOnce(response({ uploads: [{ uploadId: "server_3" }] }))
      .mockResolvedValueOnce(response({ redirectTo: "/meetings/meeting_1" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadAudioBatch({
        completePath: "/complete",
        files: files.map((file, index) => ({
          durationMs: (index + 1) * 60_000,
          file,
          uploadMedia: getUploadMediaFromFile(file)!,
        })),
        stagePath: "/stage",
      }),
    ).resolves.toMatchObject({ redirectTo: "/meetings/meeting_1" });

    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://upload/3",
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/stage",
      expect.objectContaining({ method: "POST" }),
    );
    const completion = JSON.parse(
      String((fetchMock.mock.calls[5]?.[1] as RequestInit).body),
    );
    expect(
      completion.files.map((file: { uploadId: string }) => file.uploadId),
    ).toEqual(["direct_1", "server_2", "server_3"]);
  });

  it("does not bypass a rejected sign request through server staging", async () => {
    const file = new File(["one"], "one.mp3", { type: "audio/mpeg" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ error: "Too many requests. Please try again later." }, 429),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadAudioBatch({
        completePath: "/complete",
        files: [file, file].map((selectedFile) => ({
          durationMs: 60_000,
          file: selectedFile,
          uploadMedia: getUploadMediaFromFile(selectedFile)!,
        })),
        stagePath: "/stage",
      }),
    ).rejects.toThrow("Too many requests");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
