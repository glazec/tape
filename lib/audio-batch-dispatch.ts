import { inngest } from "@/inngest/client";
import type { AudioBatchTranscription } from "@/lib/meeting-audio-batches";

export async function dispatchAudioBatchTranscriptions(
  transcriptions: AudioBatchTranscription[],
) {
  let delayedCount = 0;

  for (const transcription of transcriptions) {
    try {
      await inngest.send({
        id: `upload-transcription:${transcription.transcriptJobId}`,
        name: "meeting/transcribe.audio",
        data: transcription,
      });
    } catch (error) {
      delayedCount += 1;
      console.error("upload_dispatch_delayed", {
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        meetingId: transcription.meetingId,
        transcriptJobId: transcription.transcriptJobId,
      });
    }
  }

  return { delayedCount };
}
