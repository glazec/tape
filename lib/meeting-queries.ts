import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  mediaAssets,
  meetings,
  transcriptJobs,
  transcriptSegments,
} from "@/db/schema";
import type { MeetingListItem } from "@/components/meeting-list";
import type { TranscriptSegment } from "@/components/transcript-viewer";
import type { SessionUser } from "@/lib/auth";
import type { TranscriptJobStatus } from "@/lib/meeting-display-status";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

const uuidSchema = z.string().uuid();

export type MeetingTranscript = {
  id: string;
  title: string;
  platform: MeetingListItem["platform"];
  status: MeetingListItem["status"];
  audioUrl: string | null;
  segments: TranscriptSegment[];
};

export async function listWorkspaceMeetings(
  sessionUser: SessionUser,
  query?: string,
): Promise<MeetingListItem[]> {
  const workspace = await getOrCreateWorkspaceForSessionUser(sessionUser);
  const search = query?.trim();
  const where = search
    ? and(
        eq(meetings.teamId, workspace.teamId),
        or(
          ilike(meetings.title, `%${search}%`),
          ilike(meetings.meetingUrl, `%${search}%`),
          sql`exists (
            select 1
            from ${transcriptSegments}
            where ${transcriptSegments.meetingId} = ${meetings.id}
              and ${transcriptSegments.text} ilike ${`%${search}%`}
          )`,
        ),
      )
    : eq(meetings.teamId, workspace.teamId);

  const rows = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      platform: meetings.platform,
      status: meetings.status,
      transcriptJobStatus: sql<TranscriptJobStatus | null>`(
        select ${transcriptJobs.status}
        from ${transcriptJobs}
        where ${transcriptJobs.meetingId} = ${meetings.id}
        order by ${transcriptJobs.createdAt} desc
        limit 1
      )`,
      startedAt: meetings.startedAt,
      createdAt: meetings.createdAt,
    })
    .from(meetings)
    .where(where)
    .orderBy(desc(meetings.startedAt), desc(meetings.createdAt))
    .limit(50);

  return rows.map((meeting) => ({
    id: meeting.id,
    title: meeting.title,
    platform: meeting.platform,
    status: meeting.status,
    transcriptJobStatus: meeting.transcriptJobStatus,
    startedAt: (meeting.startedAt ?? meeting.createdAt).toISOString(),
  }));
}

export async function getWorkspaceMeetingTranscript(
  sessionUser: SessionUser,
  meetingId: string,
): Promise<MeetingTranscript | null> {
  const parsedMeetingId = uuidSchema.safeParse(meetingId);

  if (!parsedMeetingId.success) {
    return null;
  }

  const workspace = await getOrCreateWorkspaceForSessionUser(sessionUser);
  const meetingRows = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      platform: meetings.platform,
      status: meetings.status,
      audioObjectKey: mediaAssets.objectKey,
      recallRecordingId: meetings.recallRecordingId,
    })
    .from(meetings)
    .leftJoin(
      mediaAssets,
      and(eq(mediaAssets.meetingId, meetings.id), eq(mediaAssets.type, "audio")),
    )
    .where(
      and(
        eq(meetings.id, parsedMeetingId.data),
        eq(meetings.teamId, workspace.teamId),
      ),
    )
    .orderBy(desc(mediaAssets.createdAt))
    .limit(1);
  const meeting = meetingRows[0];

  if (!meeting) {
    return null;
  }

  const segments = await db
    .select({
      id: transcriptSegments.id,
      speaker: transcriptSegments.speaker,
      startMs: transcriptSegments.startMs,
      endMs: transcriptSegments.endMs,
      text: transcriptSegments.text,
    })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.meetingId, meeting.id))
    .orderBy(asc(transcriptSegments.startMs));

  return {
    id: meeting.id,
    title: meeting.title,
    platform: meeting.platform,
    status: meeting.status,
    audioUrl: meeting.audioObjectKey || meeting.recallRecordingId
      ? `/api/meetings/${meeting.id}/audio`
      : null,
    segments,
  };
}
