import { z } from "zod";

import { inngest } from "@/inngest/client";
import { generatePersonProfileAfterTranscript, listTranscriptProfilePeople } from "@/lib/person-profile";
import { refreshPersonTimelineAfterMeeting } from "@/lib/person-timeline-store";
import { ProviderCreditExhaustedError } from "@/lib/provider-credit";

const transcriptSchema = z.object({ meetingId: z.uuid(), transcriptJobId: z.uuid() });
const profileEvent = "person/profile.generate";

export const queuePersonProfilesOnTranscript = inngest.createFunction({
  id: "queue-person-profiles-on-transcript",
  triggers: [{ event: "meeting/enrich.transcript" }],
}, async ({ event, step }) => {
  // Translation requests also emit enrichment events.
  if (event.data.sendCompletionEmail !== true) return { queued: 0 };
  const transcript = transcriptSchema.parse(event.data);
  const people = await step.run("find-linked-speakers", () => listTranscriptProfilePeople(transcript));
  if (people.length) {
    await step.sendEvent("queue-person-profiles", people.map(personId => ({
      id: `person-profile:${transcript.transcriptJobId}:${personId}`,
      name: profileEvent,
      data: { ...transcript, personId },
    })));
  }
  return { queued: people.length };
});

export const generatePersonProfileOnTranscript = inngest.createFunction({
  id: "generate-person-profile-on-transcript",
  retries: 2,
  concurrency: [{ limit: 3 }, { limit: 1, key: "event.data.personId" }],
  triggers: [{ event: profileEvent }],
}, async ({ event, step }) => {
  const { personId, ...transcript } = transcriptSchema.extend({ personId: z.uuid() }).parse(event.data);
  return step.run("generate-person-profile", async () => {
    try {
      return await generatePersonProfileAfterTranscript(transcript, personId);
    } catch (error) {
      if (error instanceof ProviderCreditExhaustedError) return { status: "credit_exhausted" };
      throw error;
    }
  });
});

export const generatePersonTimelineOnMeeting = inngest.createFunction({
  id: "generate-person-timeline-on-meeting",
  retries: 2,
  concurrency: [{ limit: 3 }, { limit: 1, key: "event.data.personId" }],
  triggers: [{ event: profileEvent }, { event: "person/timeline.generate" }],
}, async ({ event, step }) => {
  const { meetingId, personId } = z.object({ meetingId: z.uuid(), personId: z.uuid() }).parse(event.data);
  return step.run("refresh-meeting-evidence", async () => {
    try {
      return await refreshPersonTimelineAfterMeeting(meetingId, personId);
    } catch (error) {
      if (error instanceof ProviderCreditExhaustedError) return { status: "credit_exhausted" };
      throw error;
    }
  });
});
