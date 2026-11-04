import { expect, it } from "vitest";
import { parseLocalRecorderUploadCompletionRequest } from "@/lib/local-recorder-upload-request";
const imageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const body = {
  fallbackIntentId: "intent", clientRecordingId: "recording",
  recordingStartedAt: "2026-11-03T12:00:00Z", recordingStoppedAt: "2026-11-03T12:01:00Z",
  assets: { computerAudioAssetId: "c", microphoneAudioAssetId: "m", synthesizedAudioAssetId: "s",
    audioFormat: "m4a", screenshots: [{ assetId: imageId, timestampMs: 5000 }] },
};
it("accepts compressed audio and timed screenshots while preserving legacy WAV uploads", () => {
  expect(parseLocalRecorderUploadCompletionRequest(body)).toMatchObject({ ok: true, value: { assets: body.assets } });
  expect(parseLocalRecorderUploadCompletionRequest({ ...body, assets: { computerAudioAssetId: "c", microphoneAudioAssetId: "m", synthesizedAudioAssetId: "s" } }).ok).toBe(true);
});
it("rejects duplicate images, invalid formats and timestamps outside capture", () => {
  for (const screenshots of [[{ assetId: imageId, timestampMs: 60001 }], [body.assets.screenshots[0], body.assets.screenshots[0]]]) {
    expect(parseLocalRecorderUploadCompletionRequest({ ...body, assets: { ...body.assets, screenshots } }).ok).toBe(false);
  }
  expect(parseLocalRecorderUploadCompletionRequest({ ...body, assets: { ...body.assets, audioFormat: "mp3" } }).ok).toBe(false);
});
