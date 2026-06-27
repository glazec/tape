import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  calendarEvents,
  mediaAssets,
  meetingAccess,
  meetingAttendees,
  meetingEntities,
  meetings,
  teamMemberships,
  transcriptJobs,
  transcriptSegments,
  users,
} from "@/db/schema";
import type { MeetingListItem } from "@/components/meeting-list";
import type {
  SpeakerSuggestion,
  TranscriptSegment,
} from "@/components/transcript-viewer";
import type { SessionUser } from "@/lib/auth";
import {
  getDashboardWorkflowSummary,
  type DashboardWorkflowSummaryModel,
} from "@/lib/dashboard-workflow-summary";
import type { TranscriptJobStatus } from "@/lib/meeting-display-status";
import {
  getOrCreateWorkspaceForSessionUser,
  type WorkspaceContext,
} from "@/lib/workspace";
import { groupRelatedMeetings } from "@/lib/meeting-intelligence";

const uuidSchema = z.string().uuid();

export type MeetingTranscript = {
  id: string;
  title: string;
  platform: MeetingListItem["platform"];
  status: MeetingListItem["status"];
  transcriptJobStatus: TranscriptJobStatus | null;
  audioUrl: string | null;
  segments: TranscriptSegment[];
  speakerSuggestions: SpeakerSuggestion[];
  accessScope: "workspace" | "shared";
};

export type ShareRecipient = {
  email: string;
  name: string | null;
};

export async function listWorkspaceMeetings(
  sessionUser: SessionUser,
  query?: string,
): Promise<MeetingListItem[]> {
  const workspace = await getOrCreateWorkspaceForSessionUser(sessionUser);

  return listMeetingsForWorkspace(workspace, query);
}

export async function listMeetingsForWorkspace(
  workspace: WorkspaceContext,
  query?: string,
): Promise<MeetingListItem[]> {
  const search = query?.trim();
  const hasMeetingAccess = sql`exists (
    select 1
    from ${meetingAccess}
    where ${meetingAccess.meetingId} = ${meetings.id}
      and ${meetingAccess.userId} = ${workspace.userId}
  )`;
  const where = search
    ? and(
        or(eq(meetings.teamId, workspace.teamId), hasMeetingAccess),
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
    : or(eq(meetings.teamId, workspace.teamId), hasMeetingAccess);

  const rows = await db
    .select({
      id: meetings.id,
      teamId: meetings.teamId,
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
      recallBotId: meetings.recallBotId,
      startedAt: meetings.startedAt,
      createdAt: meetings.createdAt,
    })
    .from(meetings)
    .where(where)
    .orderBy(desc(meetings.startedAt), desc(meetings.createdAt))
    .limit(50);

  const primaryEntityByMeetingId = await getPrimaryEntitiesForMeetings(
    rows.map((meeting) => meeting.id),
  );
  const items: Array<MeetingListItem & { primaryEntity: string | null }> =
    rows.map((meeting) => ({
    id: meeting.id,
    title: meeting.title,
    platform: meeting.platform,
    status: meeting.status,
    transcriptJobStatus: meeting.transcriptJobStatus,
    hasRecallBot: Boolean(meeting.recallBotId),
    startedAt: (meeting.startedAt ?? meeting.createdAt).toISOString(),
    accessScope: meeting.teamId === workspace.teamId ? "workspace" : "shared",
    primaryEntity: primaryEntityByMeetingId.get(meeting.id) ?? null,
  }));
  const grouped = groupRelatedMeetings(items);
  const groupedById = new Map(
    grouped.map((meeting) => [meeting.id, meeting.relatedMeetings]),
  );

  return items
    .filter((meeting) => groupedById.has(meeting.id))
    .map((meeting) => ({
      id: meeting.id,
      title: meeting.title,
      platform: meeting.platform,
      status: meeting.status,
      transcriptJobStatus: meeting.transcriptJobStatus,
      hasRecallBot: meeting.hasRecallBot,
      startedAt: meeting.startedAt,
      accessScope: meeting.accessScope,
      relatedMeetings: groupedById.get(meeting.id),
    }));
}

export async function getMeetingDashboardSummaryForWorkspace(
  workspace: WorkspaceContext,
): Promise<DashboardWorkflowSummaryModel> {
  const rows = await db
    .select({
      title: meetings.title,
      status: meetings.status,
      transcriptJobStatus: sql<TranscriptJobStatus | null>`(
        select ${transcriptJobs.status}
        from ${transcriptJobs}
        where ${transcriptJobs.meetingId} = ${meetings.id}
        order by ${transcriptJobs.createdAt} desc
        limit 1
      )`,
      recallBotId: meetings.recallBotId,
      startedAt: meetings.startedAt,
      createdAt: meetings.createdAt,
    })
    .from(meetings)
    .where(eq(meetings.teamId, workspace.teamId));

  return getDashboardWorkflowSummary(
    rows.map((meeting) => ({
      title: meeting.title,
      status: meeting.status,
      transcriptJobStatus: meeting.transcriptJobStatus,
      hasRecallBot: Boolean(meeting.recallBotId),
      startedAt: (meeting.startedAt ?? meeting.createdAt).toISOString(),
    })),
  );
}

export async function getWorkspaceMeetingTranscript(
  sessionUser: SessionUser,
  meetingId: string,
): Promise<MeetingTranscript | null> {
  const workspace = await getOrCreateWorkspaceForSessionUser(sessionUser);

  return getMeetingTranscriptForWorkspace(workspace, meetingId);
}

export async function getMeetingTranscriptForWorkspace(
  workspace: WorkspaceContext,
  meetingId: string,
): Promise<MeetingTranscript | null> {
  const parsedMeetingId = uuidSchema.safeParse(meetingId);

  if (!parsedMeetingId.success) {
    return null;
  }

  const meetingRows = await db
    .select({
      id: meetings.id,
      teamId: meetings.teamId,
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
      audioObjectKey: mediaAssets.objectKey,
      calendarAttendeeEmails: calendarEvents.attendeeEmails,
      recallRecordingId: meetings.recallRecordingId,
    })
    .from(meetings)
    .leftJoin(
      mediaAssets,
      and(eq(mediaAssets.meetingId, meetings.id), eq(mediaAssets.type, "audio")),
    )
    .leftJoin(calendarEvents, eq(calendarEvents.id, meetings.calendarEventId))
    .where(
      and(
        eq(meetings.id, parsedMeetingId.data),
        or(
          eq(meetings.teamId, workspace.teamId),
          sql`exists (
            select 1
            from ${meetingAccess}
            where ${meetingAccess.meetingId} = ${meetings.id}
              and ${meetingAccess.userId} = ${workspace.userId}
          )`,
        ),
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
      translatedText: transcriptSegments.translatedText,
      emotionLabel: transcriptSegments.emotionLabel,
      emotionReason: transcriptSegments.emotionReason,
    })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.meetingId, meeting.id))
    .orderBy(asc(transcriptSegments.startMs));
  const speakerSuggestions =
    meeting.teamId === workspace.teamId
      ? await listMeetingSpeakerSuggestions(
          meeting.id,
          meeting.calendarAttendeeEmails,
        )
      : [];

  return {
    id: meeting.id,
    title: meeting.title,
    platform: meeting.platform,
    status: meeting.status,
    transcriptJobStatus: meeting.transcriptJobStatus,
    audioUrl:
      meeting.teamId === workspace.teamId &&
      (meeting.audioObjectKey || meeting.recallRecordingId)
        ? `/api/meetings/${meeting.id}/audio`
        : null,
    segments: segments.map((segment) => ({
      ...segment,
      emotionLabel: normalizeEmotionLabel(segment.emotionLabel),
    })),
    speakerSuggestions,
    accessScope: meeting.teamId === workspace.teamId ? "workspace" : "shared",
  };
}

async function getPrimaryEntitiesForMeetings(meetingIds: string[]) {
  const primaryEntityByMeetingId = new Map<string, string>();

  if (meetingIds.length === 0) {
    return primaryEntityByMeetingId;
  }

  const rows = await db
    .select({
      meetingId: meetingEntities.meetingId,
      normalizedValue: meetingEntities.normalizedValue,
    })
    .from(meetingEntities)
    .where(inArray(meetingEntities.meetingId, meetingIds))
    .orderBy(asc(meetingEntities.createdAt));

  for (const row of rows) {
    if (!primaryEntityByMeetingId.has(row.meetingId)) {
      primaryEntityByMeetingId.set(row.meetingId, row.normalizedValue);
    }
  }

  return primaryEntityByMeetingId;
}

async function listMeetingSpeakerSuggestions(
  meetingId: string,
  calendarAttendeeEmails: unknown,
): Promise<SpeakerSuggestion[]> {
  const rows = await db
    .select({
      email: meetingAttendees.email,
      name: users.name,
    })
    .from(meetingAttendees)
    .leftJoin(users, eq(users.email, meetingAttendees.email))
    .where(eq(meetingAttendees.meetingId, meetingId))
    .orderBy(asc(meetingAttendees.email))
    .limit(100);
  const attendeeEmails = new Set(
    Array.isArray(calendarAttendeeEmails)
      ? calendarAttendeeEmails.filter(
          (email): email is string =>
            typeof email === "string" && email.trim().length > 0,
        )
      : [],
  );

  for (const row of rows) {
    attendeeEmails.add(row.email);
  }

  const namesByEmail = new Map(
    rows.map((row) => [row.email, row.name?.trim() || null]),
  );

  return Array.from(attendeeEmails)
    .sort()
    .map((email) => ({
      email,
      name: namesByEmail.get(email) || formatNameFromEmail(email),
    }));
}

function formatNameFromEmail(email: string) {
  const localPart = email.split("@")[0] ?? email;
  const words = localPart.split(/[._-]+/).filter(Boolean);

  if (words.length === 0) {
    return email;
  }

  return words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function normalizeEmotionLabel(value: string | null) {
  return value === "hard" || value === "chill" || value === "neutral"
    ? value
    : null;
}

export async function listWorkspaceShareRecipients(
  workspace: WorkspaceContext,
): Promise<ShareRecipient[]> {
  return db
    .select({
      email: users.email,
      name: users.name,
    })
    .from(teamMemberships)
    .innerJoin(users, eq(teamMemberships.userId, users.id))
    .where(
      and(
        eq(teamMemberships.teamId, workspace.teamId),
        ne(teamMemberships.userId, workspace.userId),
      ),
    )
    .orderBy(asc(users.email))
    .limit(100);
}
