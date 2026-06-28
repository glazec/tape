import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  calendarEvents,
  mediaAssets,
  meetingAccess,
  meetingAttendees,
  meetingEntities,
  meetingParticipantTimeline,
  meetings,
  teamMemberships,
  transcriptJobs,
  transcriptSegments,
  users,
} from "@/db/schema";
import type {
  MeetingListItem,
  MeetingListRelatedItem,
} from "@/components/meeting-list";
import type {
  SpeakerSuggestion,
  TranscriptSegment,
} from "@/components/transcript-viewer";
import type { SessionUser } from "@/lib/auth";
import {
  getDashboardWorkflowSummary,
  type DashboardWorkflowSegment,
  type DashboardWorkflowSummaryModel,
} from "@/lib/dashboard-workflow-summary";
import {
  getEmailDomain,
  isCommonPersonalEmailDomain,
  normalizeEmailAddress,
} from "@/lib/email-domains";
import {
  getMeetingDisplayStatus,
  type TranscriptJobStatus,
} from "@/lib/meeting-display-status";
import {
  parseMeetingLibrarySearchScope,
  parseMeetingLibrarySort,
  parseMeetingLibraryStatusFilter,
  type MeetingLibrarySearchScope,
  type MeetingLibrarySort,
  type MeetingLibraryStatusFilter,
} from "@/lib/meeting-library-view-options";
import {
  getOrCreateWorkspaceForSessionUser,
  type WorkspaceContext,
} from "@/lib/workspace";
import { groupRelatedMeetings } from "@/lib/meeting-intelligence";

const uuidSchema = z.string().uuid();
export const MEETING_LIBRARY_PAGE_SIZE = 50;
const genericMeetingGroupTitles = new Set([
  "google meet",
  "google meet recording",
  "meeting",
  "recording",
  "untitled meeting",
  "uploaded audio",
  "zoom",
  "zoom meeting",
  "zoom recording",
]);

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
  accessPeople: MeetingAccessPerson[];
  entities: MeetingTranscriptEntity[];
};

export type MeetingTranscriptEntity = {
  normalizedValue: string;
  type: string;
  value: string;
};

export type ShareRecipient = {
  email: string;
  name: string | null;
};

export type MeetingAccessPerson = {
  email: string;
  name: string | null;
};

export type MeetingLibraryPage = {
  meetings: MeetingListItem[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export type MeetingLibraryPageOptions = {
  now?: Date;
  page?: number;
  pageSize?: number;
  query?: string;
  searchScope?: MeetingLibrarySearchScope;
  sort?: MeetingLibrarySort;
  status?: MeetingLibraryStatusFilter;
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
  options: Omit<MeetingLibraryPageOptions, "query"> = {},
): Promise<MeetingListItem[]> {
  const page = await listMeetingLibraryPageForWorkspace(workspace, {
    ...options,
    query,
  });

  return page.meetings;
}

export async function listMeetingLibraryPageForWorkspace(
  workspace: WorkspaceContext,
  options: MeetingLibraryPageOptions = {},
): Promise<MeetingLibraryPage> {
  const search = options.query?.trim();
  const searchScope = parseMeetingLibrarySearchScope(options.searchScope);
  const hasMeetingAccess = sql`exists (
    select 1
    from ${meetingAccess}
    where ${meetingAccess.meetingId} = ${meetings.id}
      and ${meetingAccess.userId} = ${workspace.userId}
  )`;
  const searchCondition = search
    ? getMeetingLibrarySearchCondition(search, searchScope)
    : undefined;
  const where = searchCondition
    ? and(
        or(eq(meetings.teamId, workspace.teamId), hasMeetingAccess),
        searchCondition,
      )
    : or(eq(meetings.teamId, workspace.teamId), hasMeetingAccess);
  const activeWorkRank = sql<number>`case
    when ${meetings.status} in ('recording', 'processing') then 0
    else 1
  end`;

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
      calendarAttendeeEmails: calendarEvents.attendeeEmails,
      recallBotId: meetings.recallBotId,
      startedAt: meetings.startedAt,
      endedAt: meetings.endedAt,
      createdAt: meetings.createdAt,
      recognizedSpeakerCount: sql<number>`(
        select count(distinct lower(btrim(${transcriptSegments.speaker})))::int
        from ${transcriptSegments}
        where ${transcriptSegments.meetingId} = ${meetings.id}
          and ${transcriptSegments.speaker} is not null
          and btrim(${transcriptSegments.speaker}) <> ''
      )`,
      transcriptSegmentCount: sql<number>`(
        select count(*)::int
        from ${transcriptSegments}
        where ${transcriptSegments.meetingId} = ${meetings.id}
      )`,
      transcriptDurationMs: sql<number | null>`(
        select max(greatest(
          ${transcriptSegments.startMs},
          coalesce(${transcriptSegments.endMs}, ${transcriptSegments.startMs})
        ))::int
        from ${transcriptSegments}
        where ${transcriptSegments.meetingId} = ${meetings.id}
      )`,
    })
    .from(meetings)
    .leftJoin(calendarEvents, eq(calendarEvents.id, meetings.calendarEventId))
    .where(where)
    .orderBy(
      asc(activeWorkRank),
      desc(meetings.startedAt),
      desc(meetings.createdAt),
    );

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
      endedAt: meeting.endedAt?.toISOString() ?? null,
      durationMs: getTranscriptDurationMs(meeting.transcriptDurationMs),
      participantCount: getMeetingParticipantCount({
        attendeeEmails: meeting.calendarAttendeeEmails,
        recognizedSpeakerCount: meeting.recognizedSpeakerCount,
        transcriptSegmentCount: meeting.transcriptSegmentCount,
        status: meeting.status,
      }),
      accessScope: meeting.teamId === workspace.teamId ? "workspace" : "shared",
      externalParticipantKeys: getExternalParticipantKeys(
        meeting.calendarAttendeeEmails,
        workspace.domain,
      ),
      primaryEntity: primaryEntityByMeetingId.get(meeting.id) ?? null,
    }));
  const grouped = groupRelatedMeetings(items);
  const itemById = new Map(items.map((meeting) => [meeting.id, meeting]));
  const groupedById = new Map(
    grouped.map((meeting) => [
      meeting.id,
      meeting.relatedMeetings.flatMap((relatedMeeting) => {
        const fullMeeting = itemById.get(relatedMeeting.id);

        return fullMeeting ? [toRelatedMeeting(fullMeeting)] : [];
      }),
    ]),
  );

  const meetingsForLibrary = items
    .filter((meeting) => groupedById.has(meeting.id))
    .map((meeting) => ({
      id: meeting.id,
      title: meeting.title,
      platform: meeting.platform,
      status: meeting.status,
      transcriptJobStatus: meeting.transcriptJobStatus,
      hasRecallBot: meeting.hasRecallBot,
      startedAt: meeting.startedAt,
      endedAt: meeting.endedAt,
      durationMs: meeting.durationMs,
      participantCount: meeting.participantCount,
      accessScope: meeting.accessScope,
      ...(meeting.primaryEntity
        ? { primaryEntity: meeting.primaryEntity }
        : {}),
      relatedMeetings: groupedById.get(meeting.id),
    }));

  return buildMeetingLibraryPage(meetingsForLibrary, options);
}

export function buildMeetingLibraryPage(
  meetingsForLibrary: MeetingListItem[],
  options: MeetingLibraryPageOptions = {},
): MeetingLibraryPage {
  const nowTime = (options.now ?? new Date()).getTime();
  const sort = parseMeetingLibrarySort(options.sort);
  const status = parseMeetingLibraryStatusFilter(options.status);
  const scheduledBotMeetingIds = new Set(
    meetingsForLibrary
      .filter((meeting) => isFutureScheduledBotMeeting(meeting, nowTime))
      .sort(
        (left, right) =>
          new Date(left.startedAt).getTime() -
          new Date(right.startedAt).getTime(),
      )
      .slice(0, 3)
      .map((meeting) => meeting.id),
  );
  const sortedMeetings = meetingsForLibrary
    .filter(
      (meeting) =>
        meeting.status !== "scheduled" ||
        scheduledBotMeetingIds.has(meeting.id),
    )
    .filter((meeting) => matchesMeetingLibraryStatus(meeting, status))
    .toSorted((left, right) =>
      compareMeetingLibraryItems(left, right, scheduledBotMeetingIds, sort),
    );
  const visibleMeetings =
    sort === "smart" ? foldSimilarMeetings(sortedMeetings) : sortedMeetings;
  const page = normalizePage(options.page);
  const pageSize = normalizePageSize(options.pageSize);
  const start = (page - 1) * pageSize;

  return {
    meetings: visibleMeetings.slice(start, start + pageSize),
    page,
    pageSize,
    hasNextPage: start + pageSize < visibleMeetings.length,
    hasPreviousPage: page > 1,
  };
}

function foldSimilarMeetings(meetingsForLibrary: MeetingListItem[]) {
  const roots: MeetingListItem[] = [];
  const rootByTitle = new Map<string, MeetingListItem>();

  for (const meeting of meetingsForLibrary) {
    const titleKey = getSimilarMeetingTitleKey(meeting.title);

    if (!titleKey) {
      roots.push(meeting);
      continue;
    }

    const existingRoot = rootByTitle.get(titleKey);

    if (!existingRoot) {
      const root = {
        ...meeting,
        relatedMeetings: [...(meeting.relatedMeetings ?? [])],
      };

      rootByTitle.set(titleKey, root);
      roots.push(root);
      continue;
    }

    existingRoot.relatedMeetings = mergeRelatedMeetings(
      existingRoot.relatedMeetings,
      [toRelatedMeeting(meeting), ...(meeting.relatedMeetings ?? [])],
    );
  }

  return roots;
}

function getSimilarMeetingTitleKey(title: string) {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, " ");

  if (!normalized || genericMeetingGroupTitles.has(normalized)) {
    return null;
  }

  return normalized;
}

function toRelatedMeeting(meeting: MeetingListItem): MeetingListRelatedItem {
  return {
    id: meeting.id,
    title: meeting.title,
    platform: meeting.platform,
    startedAt: meeting.startedAt,
    endedAt: meeting.endedAt,
    durationMs: meeting.durationMs,
    participantCount: meeting.participantCount,
    status: meeting.status,
    transcriptJobStatus: meeting.transcriptJobStatus,
    hasRecallBot: meeting.hasRecallBot,
    accessScope: meeting.accessScope,
    primaryEntity: meeting.primaryEntity,
  };
}

function mergeRelatedMeetings(
  existing: MeetingListRelatedItem[] | undefined,
  incoming: MeetingListRelatedItem[],
) {
  const merged: MeetingListRelatedItem[] = [];
  const seenIds = new Set<string>();

  for (const meeting of [...(existing ?? []), ...incoming]) {
    if (seenIds.has(meeting.id)) {
      continue;
    }

    seenIds.add(meeting.id);
    merged.push(meeting);
  }

  return merged;
}

function isFutureScheduledBotMeeting(
  meeting: MeetingListItem,
  nowTime: number,
) {
  return (
    meeting.status === "scheduled" &&
    Boolean(meeting.hasRecallBot) &&
    new Date(meeting.startedAt).getTime() >= nowTime
  );
}

function compareMeetingLibraryItems(
  left: MeetingListItem,
  right: MeetingListItem,
  scheduledBotMeetingIds: Set<string>,
  sort: MeetingLibrarySort,
) {
  if (sort !== "smart") {
    const explicitSortResult = compareMeetingLibraryItemsBySort(
      left,
      right,
      sort,
    );

    if (explicitSortResult !== 0) {
      return explicitSortResult;
    }
  }

  const rankDifference =
    getMeetingLibraryRank(left, scheduledBotMeetingIds) -
    getMeetingLibraryRank(right, scheduledBotMeetingIds);

  if (rankDifference !== 0) {
    return rankDifference;
  }

  if (
    scheduledBotMeetingIds.has(left.id) &&
    scheduledBotMeetingIds.has(right.id)
  ) {
    return (
      new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime()
    );
  }

  return (
    new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
  );
}

function compareMeetingLibraryItemsBySort(
  left: MeetingListItem,
  right: MeetingListItem,
  sort: MeetingLibrarySort,
) {
  if (sort === "time_asc") {
    return compareNumbers(
      new Date(left.startedAt).getTime(),
      new Date(right.startedAt).getTime(),
      "asc",
    );
  }

  if (sort === "time_desc") {
    return compareNumbers(
      new Date(left.startedAt).getTime(),
      new Date(right.startedAt).getTime(),
      "desc",
    );
  }

  if (sort === "duration_asc" || sort === "duration_desc") {
    return compareNumbers(
      getMeetingDurationMs(left),
      getMeetingDurationMs(right),
      sort === "duration_asc" ? "asc" : "desc",
    );
  }

  if (sort === "participants_asc" || sort === "participants_desc") {
    return compareNumbers(
      left.participantCount ?? null,
      right.participantCount ?? null,
      sort === "participants_asc" ? "asc" : "desc",
    );
  }

  if (sort === "title_asc") {
    return left.title.localeCompare(right.title);
  }

  if (sort === "title_desc") {
    return right.title.localeCompare(left.title);
  }

  return 0;
}

function compareNumbers(
  left: number | null,
  right: number | null,
  direction: "asc" | "desc",
) {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return direction === "asc" ? left - right : right - left;
}

function getMeetingDurationMs(meeting: MeetingListItem) {
  if (meeting.endedAt) {
    const startedAt = new Date(meeting.startedAt).getTime();
    const endedAt = new Date(meeting.endedAt).getTime();

    if (Number.isFinite(startedAt) && Number.isFinite(endedAt)) {
      const durationMs = endedAt - startedAt;

      if (durationMs > 0) {
        return durationMs;
      }
    }
  }

  return getTranscriptDurationMs(meeting.durationMs) ?? null;
}

function matchesMeetingLibraryStatus(
  meeting: MeetingListItem,
  status: MeetingLibraryStatusFilter,
) {
  if (status === "all") {
    return true;
  }

  const displayStatus = getMeetingDisplayStatus({
    meetingStatus: meeting.status,
    transcriptJobStatus: meeting.transcriptJobStatus,
  });

  if (status === "in_progress") {
    return (
      displayStatus === "recording" ||
      displayStatus === "queued" ||
      displayStatus === "transcribing" ||
      displayStatus === "processing"
    );
  }

  return displayStatus === status;
}

function getMeetingLibrarySearchCondition(
  search: string,
  scope: MeetingLibrarySearchScope,
) {
  const pattern = `%${search}%`;
  const titleCondition = ilike(meetings.title, pattern);
  const participantCondition = or(
    sql`${calendarEvents.attendeeEmails}::text ilike ${pattern}`,
    sql`exists (
      select 1
      from ${meetingAttendees}
      where ${meetingAttendees.meetingId} = ${meetings.id}
        and ${meetingAttendees.email} ilike ${pattern}
    )`,
    sql`exists (
      select 1
      from ${meetingParticipantTimeline}
      where ${meetingParticipantTimeline.meetingId} = ${meetings.id}
        and (
          ${meetingParticipantTimeline.name} ilike ${pattern}
          or ${meetingParticipantTimeline.email} ilike ${pattern}
        )
    )`,
  );
  const transcriptCondition = sql`exists (
    select 1
    from ${transcriptSegments}
    where ${transcriptSegments.meetingId} = ${meetings.id}
      and (
        ${transcriptSegments.text} ilike ${pattern}
        or ${transcriptSegments.speaker} ilike ${pattern}
      )
  )`;

  if (scope === "title") {
    return titleCondition;
  }

  if (scope === "participants") {
    return participantCondition;
  }

  if (scope === "transcript") {
    return transcriptCondition;
  }

  return or(
    titleCondition,
    ilike(meetings.meetingUrl, pattern),
    participantCondition,
    transcriptCondition,
  );
}

function getMeetingLibraryRank(
  meeting: MeetingListItem,
  scheduledBotMeetingIds: Set<string>,
) {
  if (meeting.status === "recording" || meeting.status === "processing") {
    return 0;
  }

  if (scheduledBotMeetingIds.has(meeting.id)) {
    return 1;
  }

  return 2;
}

function normalizePage(page: number | undefined) {
  if (!page || !Number.isFinite(page)) {
    return 1;
  }

  return Math.max(1, Math.floor(page));
}

function normalizePageSize(pageSize: number | undefined) {
  if (!pageSize || !Number.isFinite(pageSize)) {
    return MEETING_LIBRARY_PAGE_SIZE;
  }

  return Math.max(1, Math.min(100, Math.floor(pageSize)));
}

function getExternalParticipantKeys(
  attendeeEmails: unknown,
  workspaceDomain: string,
) {
  if (!Array.isArray(attendeeEmails)) {
    return [];
  }

  const normalizedWorkspaceDomain = workspaceDomain.trim().toLowerCase();
  const keys = new Set<string>();

  for (const rawEmail of attendeeEmails) {
    if (typeof rawEmail !== "string") {
      continue;
    }

    const email = normalizeEmailAddress(rawEmail);
    const domain = getEmailDomain(email);

    if (!email || !domain || domain === normalizedWorkspaceDomain) {
      continue;
    }

    keys.add(`email:${email}`);

    if (!isCommonPersonalEmailDomain(domain)) {
      keys.add(`domain:${domain}`);
    }
  }

  return Array.from(keys);
}

function getMeetingParticipantCount(input: {
  attendeeEmails: unknown;
  recognizedSpeakerCount?: number | null;
  transcriptSegmentCount?: number | null;
  status: MeetingListItem["status"];
}) {
  const attendeeCount = getAttendeeCount(input.attendeeEmails);

  if (typeof attendeeCount === "number" && attendeeCount > 0) {
    return attendeeCount;
  }

  if (
    input.status === "ready" &&
    typeof input.recognizedSpeakerCount === "number" &&
    input.recognizedSpeakerCount > 0
  ) {
    return input.recognizedSpeakerCount;
  }

  if (
    input.status === "ready" &&
    typeof input.transcriptSegmentCount === "number" &&
    input.transcriptSegmentCount > 0
  ) {
    return 1;
  }

  return attendeeCount;
}

function getTranscriptDurationMs(durationMs?: number | null) {
  return typeof durationMs === "number" && durationMs > 0
    ? durationMs
    : undefined;
}

function getAttendeeCount(attendeeEmails: unknown) {
  if (!Array.isArray(attendeeEmails)) {
    return undefined;
  }

  const count = attendeeEmails.filter(
    (email): email is string =>
      typeof email === "string" && email.trim().length > 0,
  ).length;

  return count > 0 ? count : undefined;
}

export async function getMeetingDashboardSummaryForWorkspace(
  workspace: WorkspaceContext,
  options: {
    now?: Date;
    userEmail?: string | null;
    userName?: string | null;
  } = {},
): Promise<DashboardWorkflowSummaryModel> {
  const now = options.now ?? new Date();
  const statsCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const [rows, segmentRows] = await Promise.all([
    db
      .select({
        id: meetings.id,
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
        endedAt: meetings.endedAt,
        createdAt: meetings.createdAt,
      })
      .from(meetings)
      .where(eq(meetings.teamId, workspace.teamId)),
    db
      .select({
        meetingId: transcriptSegments.meetingId,
        speaker: transcriptSegments.speaker,
        startMs: transcriptSegments.startMs,
        endMs: transcriptSegments.endMs,
        text: transcriptSegments.text,
        emotionLabel: transcriptSegments.emotionLabel,
      })
      .from(transcriptSegments)
      .innerJoin(meetings, eq(transcriptSegments.meetingId, meetings.id))
      .where(
        and(
          eq(meetings.teamId, workspace.teamId),
          sql`coalesce(${meetings.startedAt}, ${meetings.createdAt}) >= ${statsCutoff}`,
          sql`coalesce(${meetings.startedAt}, ${meetings.createdAt}) <= ${now}`,
        ),
      ),
  ]);
  const segmentsByMeetingId = new Map<string, DashboardWorkflowSegment[]>();

  for (const segment of segmentRows) {
    const meetingSegments = segmentsByMeetingId.get(segment.meetingId) ?? [];
    meetingSegments.push({
      speaker: segment.speaker,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
      emotionLabel: normalizeEmotionLabel(segment.emotionLabel),
    });
    segmentsByMeetingId.set(segment.meetingId, meetingSegments);
  }

  return getDashboardWorkflowSummary(
    rows.map((meeting) => ({
      title: meeting.title,
      status: meeting.status,
      transcriptJobStatus: meeting.transcriptJobStatus,
      hasRecallBot: Boolean(meeting.recallBotId),
      startedAt: (meeting.startedAt ?? meeting.createdAt).toISOString(),
      endedAt: meeting.endedAt?.toISOString() ?? null,
      segments: segmentsByMeetingId.get(meeting.id) ?? [],
    })),
    now,
    {
      userEmail: options.userEmail,
      userName: options.userName,
    },
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

  const accessScope =
    meeting.teamId === workspace.teamId ? "workspace" : "shared";
  const [segments, speakerSuggestions, accessPeople, entities] = await Promise.all([
    db
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
      .orderBy(asc(transcriptSegments.startMs)),
    accessScope === "workspace"
      ? listMeetingSpeakerSuggestions(meeting.id, meeting.calendarAttendeeEmails)
      : Promise.resolve([]),
    accessScope === "shared"
      ? listMeetingAccessPeople(meeting.id)
      : Promise.resolve([]),
    db
      .select({
        normalizedValue: meetingEntities.normalizedValue,
        type: meetingEntities.type,
        value: meetingEntities.value,
      })
      .from(meetingEntities)
      .where(eq(meetingEntities.meetingId, meeting.id))
      .orderBy(asc(meetingEntities.createdAt)),
  ]);

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
    accessScope,
    accessPeople,
    entities: normalizeMeetingTranscriptEntities(entities),
  };
}

function normalizeMeetingTranscriptEntities(rows: MeetingTranscriptEntity[]) {
  const entities: MeetingTranscriptEntity[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const normalizedValue = row.normalizedValue.trim().toLowerCase();
    const type = row.type.trim().toLowerCase();
    const value = row.value.trim();

    if (!normalizedValue || !value || !isDisplayableMeetingEntityType(type)) {
      continue;
    }

    const key = `${type}:${normalizedValue}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    entities.push({ normalizedValue, type, value });
  }

  return entities;
}

function isDisplayableMeetingEntityType(type: string) {
  return type === "organization" || type === "product";
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

async function listMeetingAccessPeople(
  meetingId: string,
): Promise<MeetingAccessPerson[]> {
  return db
    .select({
      email: users.email,
      name: users.name,
    })
    .from(meetingAccess)
    .innerJoin(users, eq(meetingAccess.userId, users.id))
    .where(eq(meetingAccess.meetingId, meetingId))
    .orderBy(asc(users.email))
    .limit(20);
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
