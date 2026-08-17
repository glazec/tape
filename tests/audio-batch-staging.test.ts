import { describe, expect, it } from "vitest";

import {
  AudioBatchStagingError,
  createAudioBatchUploadUrls,
} from "@/lib/audio-batch-staging";

describe("audio batch staging validation", () => {
  it("rejects unsupported and oversized files before creating upload URLs", async () => {
    await expect(
      createAudioBatchUploadUrls({
        files: [
          { contentType: "text/plain", extension: "txt", fileSize: 10 },
        ],
        userId: "user_1",
      }),
    ).rejects.toBeInstanceOf(AudioBatchStagingError);
    await expect(
      createAudioBatchUploadUrls({
        files: [
          {
            contentType: "audio/mpeg",
            extension: "mp3",
            fileSize: 1_000_000_001,
          },
        ],
        userId: "user_1",
      }),
    ).rejects.toMatchObject({ status: 413 });
  });
});
