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
// Enrichment and translation run on the same event and rewrite the meeting
// while the followup is generating, so a lost save is retried on the fresh row,
// backing off (20s, 40s, 80s, 160s) so a long translation can finish first.
const CHANGED_RETRIES = 4;
const RETRYABLE = new Set(["not_ready", "meeting_changed", "transcript_changed"]);

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

    let changedRetries = 0;
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

      if (!RETRYABLE.has(outcome.status)) {
        return { status: outcome.status };
      }

      if (outcome.status !== "not_ready") {
        changedRetries += 1;
        if (changedRetries > CHANGED_RETRIES) {
          return { status: outcome.status };
        }
      }

      await step.sleep(
        `wait-for-ready-${check}`,
        outcome.status === "not_ready" ? "1m" : `${20 * 2 ** (changedRetries - 1)}s`,
      );
    }

    return { status: "skipped", reason: "meeting_never_ready" };
  },
);
