import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db/client";
import { meetings, transcriptJobs, transcriptSegments, users } from "@/db/schema";
import { activeTranscriptJobIdsSubquery } from "@/lib/current-transcript-job";
import type { MeetingEmail, MeetingEmailSegment } from "@/lib/meeting-email";

export type PreparedMeetingEmail = { payload: MeetingEmail; jobIds: string[]; preparedAt: string };
export type MeetingEmailSnapshot = {
  action: "ready";
  meetingId: string;
  anchorId: string;
  jobIds: string[];
  title: string;
  recipientEmail: string;
  segments: MeetingEmailSegment[];
  delivery: PreparedMeetingEmail | null;
};

export async function loadMeetingEmailSnapshot(input: {
  meetingId: string;
  transcriptJobId?: string;
  eventTimestamp?: number;
}): Promise<MeetingEmailSnapshot | { action: "waiting" } | { action: "skipped"; reason: string }> {
  const [meeting] = await db.select({ title: meetings.title, recipientEmail: users.email })
    .from(meetings).innerJoin(users, eq(meetings.ownerUserId, users.id))
    .where(eq(meetings.id, input.meetingId)).limit(1);
  if (!meeting) return { action: "skipped", reason: "meeting_deleted" };

  const jobs = await db.select({
    id: transcriptJobs.id, status: transcriptJobs.status, mode: transcriptJobs.mode,
    createdAt: transcriptJobs.createdAt,
    payload: transcriptJobs.completionEmailPayload,
    preparedAt: transcriptJobs.completionEmailPreparedAt,
    sentAt: transcriptJobs.completionEmailSentAt,
  }).from(transcriptJobs).where(and(
    eq(transcriptJobs.meetingId, input.meetingId),
    inArray(transcriptJobs.id, activeTranscriptJobIdsSubquery(input.meetingId)),
  )).orderBy(asc(transcriptJobs.createdAt), asc(transcriptJobs.id));
  const anchor = jobs[0];
  if (!anchor || (input.transcriptJobId && !jobs.some((job) => job.id === input.transcriptJobId)) ||
    (!input.transcriptJobId && input.eventTimestamp && jobs.some((job) => job.mode === "replace" && job.createdAt.getTime() > input.eventTimestamp!))) {
    return { action: "skipped", reason: "transcript_superseded" };
  }
  if (anchor.sentAt) return { action: "skipped", reason: "already_sent" };
  if (jobs.some((job) => job.status === "failed")) return { action: "skipped", reason: "transcription_failed" };
  if (jobs.some((job) => job.status !== "completed")) return { action: "waiting" };

  const jobIds = jobs.map((job) => job.id);
  const segments = await db.select({
    startMs: transcriptSegments.startMs, speaker: transcriptSegments.speaker, text: transcriptSegments.text,
  }).from(transcriptSegments).where(and(
    eq(transcriptSegments.meetingId, input.meetingId), inArray(transcriptSegments.jobId, jobIds),
  )).orderBy(asc(transcriptSegments.startMs), asc(transcriptSegments.endMs), asc(transcriptSegments.id));
  if (segments.length === 0) return { action: "skipped", reason: "empty_transcript" };
  return {
    action: "ready", meetingId: input.meetingId, anchorId: anchor.id, jobIds,
    ...meeting, segments,
    delivery: anchor.payload && anchor.preparedAt
      ? { ...anchor.payload, preparedAt: anchor.preparedAt.toISOString() } : null,
  };
}

export async function isMeetingEmailCurrent(snapshot: MeetingEmailSnapshot) {
  const current = await loadMeetingEmailSnapshot({ meetingId: snapshot.meetingId, transcriptJobId: snapshot.anchorId });
  return current.action === "ready" && current.recipientEmail === snapshot.recipientEmail &&
    current.jobIds.join(",") === snapshot.jobIds.join(",");
}

export async function prepareMeetingEmail(snapshot: MeetingEmailSnapshot, payload: MeetingEmail): Promise<PreparedMeetingEmail | null> {
  if (!await isMeetingEmailCurrent(snapshot)) return null;
  const [delivery] = await db.update(transcriptJobs).set({
    completionEmailPayload: sql`coalesce(${transcriptJobs.completionEmailPayload}, ${JSON.stringify({ payload, jobIds: snapshot.jobIds })}::jsonb)`,
    completionEmailPreparedAt: sql`coalesce(${transcriptJobs.completionEmailPreparedAt}, now())`,
  }).where(and(eq(transcriptJobs.id, snapshot.anchorId), isNull(transcriptJobs.completionEmailSentAt)))
    .returning({ payload: transcriptJobs.completionEmailPayload, preparedAt: transcriptJobs.completionEmailPreparedAt });
  return delivery?.payload && delivery.preparedAt
    ? { ...delivery.payload, preparedAt: delivery.preparedAt.toISOString() } : null;
}

export async function markMeetingEmailSent(anchorId: string, providerId: string) {
  await db.update(transcriptJobs).set({
    completionEmailSentAt: new Date(), completionEmailId: providerId,
    // Keep a durable receipt without retaining a second copy of the private transcript.
    completionEmailPayload: null,
  }).where(eq(transcriptJobs.id, anchorId));
}

export async function listPendingMeetingEmails() {
  const emailJobs = alias(transcriptJobs, "email_jobs");
  return db.select({ meetingId: emailJobs.meetingId, transcriptJobId: emailJobs.id })
    .from(emailJobs).where(and(
      eq(emailJobs.mode, "replace"),
      eq(emailJobs.status, "completed"),
      isNotNull(emailJobs.completionEmailReadyAt),
      isNull(emailJobs.completionEmailSentAt),
      sql`(${emailJobs.completionEmailPreparedAt} is null or ${emailJobs.completionEmailPreparedAt} > now() - interval '23 hours')`,
      inArray(emailJobs.id, activeTranscriptJobIdsSubquery(emailJobs.meetingId)),
      sql`not exists (
        select 1 from transcript_jobs pending_part
        where pending_part.id in ${activeTranscriptJobIdsSubquery(emailJobs.meetingId)}
          and pending_part.status <> 'completed'
      )`,
    )).orderBy(asc(emailJobs.completionEmailReadyAt)).limit(50);
}

export async function markMeetingEmailsQueued(jobIds: string[]) {
  // Rotate dispatched rows behind other pending meetings, including when a provider keeps failing.
  await db.update(transcriptJobs).set({ completionEmailReadyAt: new Date() })
    .where(and(inArray(transcriptJobs.id, jobIds), isNull(transcriptJobs.completionEmailSentAt)));
}
