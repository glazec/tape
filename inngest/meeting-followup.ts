import { z } from "zod";

import { inngest } from "@/inngest/client";
import { autoGenerateMeetingFollowup } from "@/lib/meeting-followup-generation";
import { ProviderCreditExhaustedError } from "@/lib/provider-credit";

const dataSchema = z.object({
  meetingId: z.uuid(),
  transcriptJobId: z.uuid().optional(),
  sendCompletionEmail: z.boolean().optional(),
});

// A finished recording can take a few minutes to flip to ready while other
// audio parts complete; wait for it rather than giving up on the first look.
const READY_CHECKS = 30;

export const generateMeetingFollowupOnTranscript = inngest.createFunction(
  {
    id: "generate-meeting-followup",
    retries: 2,
    concurrency: { limit: 1, key: "event.data.meetingId" },
    triggers: [{ event: "meeting/enrich.transcript" }],
  },
  async ({ event, step }) => {
    const data = dataSchema.parse(event.data);

    // Only a finished transcription earns an automatic followup; translation
    // requests reuse this event and must not trigger new generation.
    if (!data.sendCompletionEmail) {
      return { status: "skipped", reason: "not_transcript_completion" };
    }

    for (let check = 0; check < READY_CHECKS; check += 1) {
      const outcome = await step.run(`generate-followup-${check}`, async () => {
        try {
          return await autoGenerateMeetingFollowup(data.meetingId);
        } catch (error) {
          if (error instanceof ProviderCreditExhaustedError) {
            return { status: "credit_exhausted" as const };
          }
          throw error;
        }
      });

      if (outcome.status !== "not_ready") {
        return { status: outcome.status };
      }

      await step.sleep(`wait-for-ready-${check}`, "1m");
    }

    return { status: "skipped", reason: "meeting_never_ready" };
  },
);
