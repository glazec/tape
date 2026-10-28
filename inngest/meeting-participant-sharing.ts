import { z } from "zod";

import { inngest } from "@/inngest/client";
import { shareMeetingWithRecognizedParticipants } from "@/lib/meeting-participant-access";

const dataSchema = z.object({
  meetingId: z.uuid(),
  transcriptJobId: z.uuid().optional(),
  sendCompletionEmail: z.boolean().optional(),
});

export const shareMeetingWithParticipantsOnTranscript = inngest.createFunction(
  {
    id: "share-meeting-with-participants",
    retries: 2,
    concurrency: { limit: 1, key: "event.data.meetingId" },
    triggers: [{ event: "meeting/enrich.transcript" }],
  },
  async ({ event, step }) => {
    const data = dataSchema.parse(event.data);

    // The speaker timeline is complete once the transcript is; translation
    // requests reuse this event and have nothing new to share.
    if (!data.sendCompletionEmail) {
      return { status: "skipped", reason: "not_transcript_completion" };
    }

    return step.run("share-with-recognized-participants", () =>
      shareMeetingWithRecognizedParticipants(data.meetingId),
    );
  },
);
