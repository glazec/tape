import { NonRetriableError } from "inngest";
import { z } from "zod";

import { inngest } from "@/inngest/client";
import { buildMeetingEmail, formatEmailTranscript, splitTranscriptForNotes } from "@/lib/meeting-email";
import { isMeetingEmailCurrent, listPendingMeetingEmails, loadMeetingEmailSnapshot, markMeetingEmailsQueued, markMeetingEmailSent, prepareMeetingEmail } from "@/lib/meeting-email-records";
import { assertMeetingHasProviderCredit } from "@/lib/provider-credit";
import { generateMeetingNotes } from "@/lib/vendors/openrouter";
import { sendResendEmail } from "@/lib/vendors/resend";

const dataSchema = z.object({ meetingId: z.uuid(), transcriptJobId: z.uuid().optional(), sendCompletionEmail: z.boolean().optional() });

export const sendMeetingEmail = inngest.createFunction({
  id: "send-meeting-email",
  retries: 4,
  concurrency: { limit: 1, key: "event.data.meetingId" },
  triggers: [{ event: "meeting/enrich.transcript" }, { event: "meeting/send.completion-email" }],
}, async ({ event, step }) => {
  if (!process.env.RESEND_API_KEY?.trim()) return { action: "skipped", reason: "email_disabled" };
  const data = dataSchema.parse(event.data);
  if (!data.sendCompletionEmail) return { action: "skipped", reason: "not_transcript_completion" };
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const snapshot = await step.run(`load-meeting-email-${attempt}`, () => loadMeetingEmailSnapshot({
      ...data, eventTimestamp: event.ts,
    }));
    if (snapshot.action === "waiting") {
      await step.sleep(`wait-for-transcripts-${attempt}`, "1m");
      continue;
    }
    if (snapshot.action === "skipped") return snapshot;

    let delivery = snapshot.delivery;
    if (!delivery) {
      await step.run("check-notes-credit", () => assertMeetingHasProviderCredit(data.meetingId));
      const chunks = splitTranscriptForNotes(formatEmailTranscript(snapshot.segments));
      const notes: string[] = [];
      for (const [index, transcript] of chunks.entries()) {
        notes.push(await step.run(`generate-meeting-notes-${index}`, () => generateMeetingNotes({
          meetingId: data.meetingId, title: snapshot.title, transcript,
        })));
      }
      delivery = await step.run("prepare-meeting-email", () => prepareMeetingEmail(snapshot, buildMeetingEmail({
        title: snapshot.title, recipientEmail: snapshot.recipientEmail,
        from: process.env.MEETING_EMAIL_FROM?.trim() || "Tape <tape@inevitable.tech>",
        notes: notes.join("\n\n"), segments: snapshot.segments,
      })));
    }
    if (!delivery) return { action: "skipped", reason: "transcript_changed" };
    if (delivery.jobIds.join(",") !== snapshot.jobIds.join(",")) {
      return { action: "skipped", reason: "recording_changed_after_preparation" };
    }
    const prepared = delivery;
    const result = await step.run("send-meeting-email", async () => {
      // A retry may replay earlier steps long after the original provider request.
      if (Date.now() - new Date(prepared.preparedAt).getTime() >= 23 * 3600000) {
        throw new NonRetriableError("Meeting email delivery review required before retrying an expired idempotency key");
      }
      if (!await isMeetingEmailCurrent(snapshot)) return { action: "skipped", reason: "transcript_changed" };
      if (prepared.payload.to[0] !== snapshot.recipientEmail) return { action: "skipped", reason: "recipient_changed" };
      const providerId = await sendResendEmail(prepared.payload, `meeting-email/${snapshot.anchorId}`);
      await markMeetingEmailSent(snapshot.anchorId, providerId);
      return { action: "sent", providerId };
    });
    return result;
  }
  throw new NonRetriableError("Meeting email timed out waiting for all audio parts to finish");
});

export const reconcileMeetingEmails = inngest.createFunction({
  id: "reconcile-meeting-emails",
  triggers: [{ cron: "*/5 * * * *" }],
}, async ({ step }) => {
  if (!process.env.RESEND_API_KEY?.trim()) return { queued: 0 };
  const pending = await step.run("load-pending-meeting-emails", listPendingMeetingEmails);
  if (pending.length === 0) return { queued: 0 };
  await step.sendEvent("dispatch-pending-meeting-emails", pending.map((data) => ({
    name: "meeting/send.completion-email",
    data: { ...data, sendCompletionEmail: true },
  })));
  await step.run("rotate-dispatched-meeting-emails", () => markMeetingEmailsQueued(pending.map((data) => data.transcriptJobId)));
  return { queued: pending.length };
});
