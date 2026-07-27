import { z } from "zod";

import { persistRecallMeetingVideoFrames } from "@/lib/meeting-video-frames";
import { imageWorkerInngest } from "@/services/image-worker/client";

const extractionDataSchema = z.object({
  meetingId: z.uuid(),
  recallBotId: z.string().trim().min(1).optional(),
  recallRecordingId: z.string().trim().min(1),
});

export const extractMeetingVideoFrames = imageWorkerInngest.createFunction(
  {
    concurrency: 1,
    id: "extract-meeting-video-frames",
    retries: 2,
    triggers: [{ event: "meeting/extract.video-frames" }],
  },
  async ({ event }) => {
    const data = extractionDataSchema.parse(event.data);

    return persistRecallMeetingVideoFrames(data);
  },
);

export const functions = [extractMeetingVideoFrames];
