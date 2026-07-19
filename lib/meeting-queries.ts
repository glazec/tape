import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
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
import { currentTranscriptJobIdSubquery } from "@/lib/current-transcript-job";
import { normalizeEmailAddress } from "@/lib/email-domains";
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
  buildMeetingTranslationSummary,
  type MeetingTranslationSummary,
} from "@/lib/meeting-translation-status";
import {
  formatNameFromEmail,
  getUniqueFullNameByFirstName,
  getUniqueFullNameForFirstNameAlias,
} from "@/lib/speaker-labels";
import {
  applySpeakerAliasesToSegments,
  type SpeakerAlias,
} from "@/lib/speaker-alias-normalization";
import {
  listTeamSpeakerAliases,
} from "@/lib/speaker-aliases";
import {
  getOrCreateWorkspaceForSessionUser,
  type WorkspaceContext,
} from "@/lib/workspace";
import {
  buildSmartMeetingTitle,
  getExternalParticipantKeys,
  groupRelatedMeetings,
} from "@/lib/meeting-intelligence";
import {
  getMeetingAccessScope,
  getReadableMeetingsCondition,
} from "@/lib/meeting-access-policy";
import { getMeetingManagerCondition } from "@/lib/meeting-write-policy";

const uuidSchema = z.uuid();
const MEETING_LIBRARY_PAGE_SIZE = 50;
export const DEFAULT_MEETING_LIBRARY_HISTORY_MONTHS = 6;
export const DEFAULT_RELATED_MEETING_HISTORY_MONTHS = 2;
export const MEETING_LIBRARY_HISTORY_MONTH_STEP = 6;
export const MAX_MEETING_LIBRARY_HISTORY_MONTHS = 60;
const MEETING_DETAIL_RELATED_TRANSCRIPT_SEGMENT_LIMIT = 60;
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
const nonInformativePrimaryEntities = new Set(["iosg"]);

export type MeetingTranscript = {
  id: string;
  title: string;
  platform: MeetingListItem["platform"];
  status: MeetingListItem["status"];
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  transcriptJobStatus: TranscriptJobStatus | null;
  translationSummary: MeetingTranslationSummary;
  audioUrl: string | null;
  visualAssets: MeetingVisualAsset[];
  segments: TranscriptSegment[];
  speakerAliases: SpeakerAlias[];
  speakerSuggestions: SpeakerSuggestion[];
  accessScope: "workspace" | "shared";
  canManage: boolean;
  accessPeople: MeetingAccessPerson[];
  entities: MeetingTranscriptEntity[];
};

type MeetingVisualAsset = {
  id: string;
  capturedAt: string | null;
  timestampMs: number | null;
  url: string;
};

type MeetingTranscriptEntity = {
  aliases: string[];
  normalizedValue: string;
  type: string;
  value: string;
};

type MeetingDetailRelatedTranscriptSegment = {
  id: string;
  speaker: string | null;
  startMs: number;
  text: string;
};

export type MeetingDetailRelatedMeeting = {
  id: string;
  title: string;
  startedAt: string;
  transcriptPreview: MeetingDetailRelatedTranscriptSegment[];
  hasMoreTranscriptSegments: boolean;
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
  hasOlderMeetings: boolean;
  historyMonths: number;
  relatedHistoryMonths: number;
};

export type MeetingLibraryPageOptions = {
  now?: Date;
  page?: number;
  pageSize?: number;
  historyMonths?: number;
  query?: string;
  relatedHistoryMonths?: number;
  searchScope?: MeetingLibrarySearchScope;
  sort?: MeetingLibrarySort;
  status?: MeetingLibraryStatusFilter;
};

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
  const searchCondition = search
    ? getMeetingLibrarySearchCondition(search, searchScope)
    : undefined;
  const readableMeetingsCondition = getReadableMeetingsCondition(workspace);
  const visibleMeetingsCondition = and(
    readableMeetingsCondition,
    ne(meetings.status, "cancelled"),
  );
  const where = searchCondition
    ? and(visibleMeetingsCondition, searchCondition)
    : visibleMeetingsCondition;
  const activeWorkRank = sql<number>`case
    when ${meetings.status} in ('recording', 'processing') then 0
    else 1
  end`;

  const rows = await db
    .select({
      id: meetings.id,
      teamId: meetings.teamId,
      canManage: getMeetingManagerCondition(workspace),
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
          and ${transcriptSegments.jobId} = ${currentTranscriptJobIdSubquery(meetings.id)}
          and ${transcriptSegments.speaker} is not null
          and btrim(${transcriptSegments.speaker}) <> ''
      )`,
      transcriptSegmentCount: sql<number>`(
        select count(*)::int
        from ${transcriptSegments}
        where ${transcriptSegments.meetingId} = ${meetings.id}
          and ${transcriptSegments.jobId} = ${currentTranscriptJobIdSubquery(meetings.id)}
      )`,
      transcriptDurationMs: sql<number | null>`(
        select max(greatest(
          ${transcriptSegments.startMs},
          coalesce(${transcriptSegments.endMs}, ${transcriptSegments.startMs})
        ))::int
        from ${transcriptSegments}
        where ${transcriptSegments.meetingId} = ${meetings.id}
          and ${transcriptSegments.jobId} = ${currentTranscriptJobIdSubquery(meetings.id)}
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
    rows.map((meeting) => {
      const participantNames = getMeetingParticipantNames(
        meeting.calendarAttendeeEmails,
      );

      return {
        id: meeting.id,
        title: getMeetingDisplayTitle({
          title: meeting.title,
          attendeeEmails: meeting.calendarAttendeeEmails,
          workspaceDomain: workspace.domain,
        }),
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
        ...(participantNames.length > 0 ? { participantNames } : {}),
        accessScope: getMeetingAccessScope(Boolean(meeting.canManage)),
        externalParticipantKeys: getExternalParticipantKeys(
          meeting.calendarAttendeeEmails,
          workspace.domain,
        ),
        primaryEntity: primaryEntityByMeetingId.get(meeting.id) ?? null,
      };
    });
  return buildMeetingLibraryPage(items, options);
}

export function buildMeetingLibraryPage(
  meetingsForLibrary: MeetingListItem[],
  options: MeetingLibraryPageOptions = {},
): MeetingLibraryPage {
  const now = options.now ?? new Date();
  const nowTime = now.getTime();
  const sort = parseMeetingLibrarySort(options.sort);
  const status = parseMeetingLibraryStatusFilter(options.status);
  const historyMonths = normalizeHistoryMonths(options.historyMonths);
  const relatedHistoryMonths = normalizeRelatedHistoryMonths(
    options.relatedHistoryMonths,
  );
  const historyCutoff = subtractMonths(now, historyMonths);
  const relatedHistoryCutoff = subtractMonths(now, relatedHistoryMonths);
  const activeMeetingsForLibrary = meetingsForLibrary.filter(
    (meeting) => meeting.status !== "cancelled",
  );
  const scheduledBotMeetingIds = new Set(
    activeMeetingsForLibrary
      .filter((meeting) => isFutureScheduledBotMeeting(meeting, nowTime))
      .sort(
        (left, right) =>
          new Date(left.startedAt).getTime() -
          new Date(right.startedAt).getTime(),
      )
      .slice(0, 3)
      .map((meeting) => meeting.id),
  );
  const eligibleMeetingsForLibrary = activeMeetingsForLibrary.filter(
    (meeting) =>
      shouldShowMeetingInLibrary(meeting, scheduledBotMeetingIds) &&
      matchesMeetingLibraryStatus(meeting, status),
  );
  const visibleMeetingsForLibrary = eligibleMeetingsForLibrary.filter((meeting) =>
    isMeetingInsideHistoryWindow(meeting, historyCutoff),
  );
  const relatedMeetingsForLibrary = eligibleMeetingsForLibrary.filter((meeting) =>
    isMeetingInsideHistoryWindow(meeting, relatedHistoryCutoff),
  );
  const relatedMeetingsByRoot = getRelatedMeetingsByRoot(
    relatedMeetingsForLibrary,
    { includeTitleKeys: sort === "smart" },
  );
  const allRelatedMeetingsByRoot = getRelatedMeetingsByRoot(
    eligibleMeetingsForLibrary,
    { includeTitleKeys: sort === "smart" },
  );
  const hasMoreRelatedMeetingByRoot = new Map(
    Array.from(allRelatedMeetingsByRoot, ([meetingId, relatedMeetings]) => [
      meetingId,
      relatedMeetings.some(
        (meeting) => !isMeetingInsideHistoryWindow(meeting, relatedHistoryCutoff),
      ),
    ]),
  );
  const meetingsForVisibleWindow = visibleMeetingsForLibrary
    .filter((meeting) => allRelatedMeetingsByRoot.has(meeting.id))
    .map((meeting) =>
      toLibraryRootMeeting({
        meeting,
        hasMoreRelatedMeetings:
          hasMoreRelatedMeetingByRoot.get(meeting.id) ?? false,
        relatedMeetings: relatedMeetingsByRoot.get(meeting.id) ?? [],
      }),
    );
  const allRootMeetings = eligibleMeetingsForLibrary
    .filter((meeting) => allRelatedMeetingsByRoot.has(meeting.id))
    .map((meeting) =>
      toLibraryRootMeeting({
        meeting,
        hasMoreRelatedMeetings: false,
        relatedMeetings: allRelatedMeetingsByRoot.get(meeting.id) ?? [],
      }),
    );
  const sortedMeetings = meetingsForVisibleWindow.toSorted((left, right) =>
    compareMeetingLibraryItems(left, right, scheduledBotMeetingIds, sort),
  );
  const hasOlderMeetings = allRootMeetings.some(
    (meeting) => !isMeetingInsideHistoryWindow(meeting, historyCutoff),
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
    hasOlderMeetings,
    historyMonths,
    relatedHistoryMonths,
  };
}

function getRelatedMeetingsByRoot(
  meetingsForLibrary: MeetingListItem[],
  options: { includeTitleKeys: boolean },
) {
  const grouped = groupRelatedMeetings(meetingsForLibrary, options);
  const itemById = new Map(
    meetingsForLibrary.map((meeting) => [meeting.id, meeting]),
  );

  return new Map(
    grouped.map((meeting) => [
      meeting.id,
      meeting.relatedMeetings.flatMap((relatedMeeting) => {
        const fullMeeting = itemById.get(relatedMeeting.id);

        return fullMeeting ? [toRelatedMeeting(fullMeeting)] : [];
      }),
    ]),
  );
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
    existingRoot.hasMoreRelatedMeetings =
      Boolean(existingRoot.hasMoreRelatedMeetings) ||
      Boolean(meeting.hasMoreRelatedMeetings);
  }

  return roots;
}

function shouldShowMeetingInLibrary(
  meeting: MeetingListItem,
  scheduledBotMeetingIds: Set<string>,
) {
  return (
    meeting.status !== "scheduled" || scheduledBotMeetingIds.has(meeting.id)
  );
}

function subtractMonths(date: Date, months: number) {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() - months);

  return copy;
}

function isMeetingInsideHistoryWindow(
  meeting: MeetingListItem,
  cutoff: Date,
) {
  return new Date(meeting.startedAt).getTime() >= cutoff.getTime();
}

function getSimilarMeetingTitleKey(title: string) {
  const normalized = normalizeMeetingTitleGroupingKey(title);

  if (!normalized || genericMeetingGroupTitles.has(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeMeetingTitleGroupingKey(title: string) {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
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
    ...(meeting.participantNames?.length
      ? { participantNames: meeting.participantNames }
      : {}),
    status: meeting.status,
    transcriptJobStatus: meeting.transcriptJobStatus,
    hasRecallBot: meeting.hasRecallBot,
    accessScope: meeting.accessScope,
    primaryEntity: meeting.primaryEntity,
  };
}

function toLibraryRootMeeting(input: {
  meeting: MeetingListItem;
  hasMoreRelatedMeetings: boolean;
  relatedMeetings: MeetingListRelatedItem[];
}): MeetingListItem {
  return {
    id: input.meeting.id,
    title: input.meeting.title,
    platform: input.meeting.platform,
    status: input.meeting.status,
    transcriptJobStatus: input.meeting.transcriptJobStatus,
    hasRecallBot: input.meeting.hasRecallBot,
    startedAt: input.meeting.startedAt,
    endedAt: input.meeting.endedAt,
    ...(typeof input.meeting.durationMs === "number"
      ? { durationMs: input.meeting.durationMs }
      : {}),
    participantCount: input.meeting.participantCount,
    ...(input.meeting.participantNames?.length
      ? { participantNames: input.meeting.participantNames }
      : {}),
    accessScope: input.meeting.accessScope,
    ...(input.meeting.primaryEntity
      ? { primaryEntity: input.meeting.primaryEntity }
      : {}),
    ...(input.hasMoreRelatedMeetings ? { hasMoreRelatedMeetings: true } : {}),
    relatedMeetings: input.relatedMeetings,
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
      and ${transcriptSegments.jobId} = ${currentTranscriptJobIdSubquery(meetings.id)}
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

function normalizeHistoryMonths(months: number | undefined) {
  if (!months || !Number.isFinite(months)) {
    return DEFAULT_MEETING_LIBRARY_HISTORY_MONTHS;
  }

  return Math.max(
    DEFAULT_MEETING_LIBRARY_HISTORY_MONTHS,
    Math.min(MAX_MEETING_LIBRARY_HISTORY_MONTHS, Math.floor(months)),
  );
}

function normalizeRelatedHistoryMonths(months: number | undefined) {
  if (!months || !Number.isFinite(months)) {
    return DEFAULT_RELATED_MEETING_HISTORY_MONTHS;
  }

  return Math.max(
    DEFAULT_RELATED_MEETING_HISTORY_MONTHS,
    Math.min(MAX_MEETING_LIBRARY_HISTORY_MONTHS, Math.floor(months)),
  );
}

function getMeetingParticipantCount(input: {
  attendeeEmails: unknown;
  recognizedSpeakerCount?: number | null;
  transcriptSegmentCount?: number | null;
  status: MeetingListItem["status"];
}) {
  const attendeeCount = getAttendeeCount(input.attendeeEmails);

  if (
    input.status === "ready" &&
    typeof input.recognizedSpeakerCount === "number" &&
    input.recognizedSpeakerCount > 0
  ) {
    return input.recognizedSpeakerCount;
  }

  if (typeof attendeeCount === "number" && attendeeCount > 0) {
    return attendeeCount;
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

function getMeetingParticipantNames(attendeeEmails: unknown) {
  if (!Array.isArray(attendeeEmails)) {
    return [];
  }

  const seen = new Set<string>();
  const names: string[] = [];

  for (const rawEmail of attendeeEmails) {
    if (typeof rawEmail !== "string") {
      continue;
    }

    const email = normalizeEmailAddress(rawEmail);

    if (!email) {
      continue;
    }

    const name = formatNameFromEmail(email);
    const key = name.trim().toLowerCase();

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    names.push(name);
  }

  return names;
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

function getMeetingDisplayTitle(input: {
  title: string;
  attendeeEmails: unknown;
  workspaceDomain?: string | null;
}) {
  if (!input.workspaceDomain) {
    return input.title;
  }

  return buildSmartMeetingTitle({
    eventTitle: input.title,
    attendeeEmails: getStringAttendeeEmails(input.attendeeEmails),
    workspaceDomain: input.workspaceDomain,
  });
}

function getStringAttendeeEmails(attendeeEmails: unknown) {
  if (!Array.isArray(attendeeEmails)) {
    return [];
  }

  return attendeeEmails.filter(
    (email): email is string =>
      typeof email === "string" && email.trim().length > 0,
  );
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
      .where(
        and(eq(meetings.teamId, workspace.teamId), ne(meetings.status, "cancelled")),
      ),
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
          ne(meetings.status, "cancelled"),
          eq(
            transcriptSegments.jobId,
            currentTranscriptJobIdSubquery(meetings.id),
          ),
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
      ownerUserId: meetings.ownerUserId,
      teamId: meetings.teamId,
      title: meetings.title,
      platform: meetings.platform,
      status: meetings.status,
      startedAt: meetings.startedAt,
      endedAt: meetings.endedAt,
      createdAt: meetings.createdAt,
      transcriptDurationMs: sql<number | null>`(
        select max(greatest(
          ${transcriptSegments.startMs},
          coalesce(${transcriptSegments.endMs}, ${transcriptSegments.startMs})
        ))::int
        from ${transcriptSegments}
        where ${transcriptSegments.meetingId} = ${meetings.id}
          and ${transcriptSegments.jobId} = ${currentTranscriptJobIdSubquery(meetings.id)}
      )`,
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
      translationErrorMessage: meetings.translationErrorMessage,
      translationStatus: meetings.translationStatus,
      canManage: getMeetingManagerCondition(workspace),
    })
    .from(meetings)
    .leftJoin(
      mediaAssets,
      and(
        eq(mediaAssets.meetingId, meetings.id),
        or(eq(mediaAssets.type, "synthesized_audio"), eq(mediaAssets.type, "audio")),
      ),
    )
    .leftJoin(calendarEvents, eq(calendarEvents.id, meetings.calendarEventId))
    .where(
      and(
        eq(meetings.id, parsedMeetingId.data),
        getReadableMeetingsCondition(workspace),
      ),
    )
    .orderBy(
      desc(sql`case when ${mediaAssets.type} = 'synthesized_audio' then 1 else 0 end`),
      desc(mediaAssets.createdAt),
    )
    .limit(1);
  const meeting = meetingRows[0];

  if (!meeting) {
    return null;
  }

  const canManage = Boolean(meeting.canManage);
  const accessScope = getMeetingAccessScope(canManage);
  const [
    segments,
    speakerSuggestions,
    accessPeople,
    entities,
    visualAssets,
    speakerAliases,
  ] = await Promise.all([
    db
      .select({
        id: transcriptSegments.id,
        speaker: transcriptSegments.speaker,
        startMs: transcriptSegments.startMs,
        endMs: transcriptSegments.endMs,
        text: transcriptSegments.text,
        polishedText: transcriptSegments.polishedText,
        translatedText: transcriptSegments.translatedText,
        emotionLabel: transcriptSegments.emotionLabel,
        emotionReason: transcriptSegments.emotionReason,
      })
      .from(transcriptSegments)
      .where(
        and(
          eq(transcriptSegments.meetingId, meeting.id),
          eq(
            transcriptSegments.jobId,
            currentTranscriptJobIdSubquery(meeting.id),
          ),
        ),
      )
      .orderBy(asc(transcriptSegments.startMs)),
    canManage
      ? listMeetingSpeakerSuggestions(meeting.id, meeting.calendarAttendeeEmails)
      : Promise.resolve([]),
    canManage
      ? listMeetingAccessPeople(meeting.id, meeting.ownerUserId)
      : Promise.resolve([]),
    db
      .select({
        aliases: meetingEntities.aliases,
        normalizedValue: meetingEntities.normalizedValue,
        type: meetingEntities.type,
        value: meetingEntities.value,
      })
      .from(meetingEntities)
      .where(eq(meetingEntities.meetingId, meeting.id))
      .orderBy(asc(meetingEntities.createdAt)),
    db
      .select({
        id: mediaAssets.id,
        capturedAt: mediaAssets.capturedAt,
        timestampMs: mediaAssets.timestampMs,
      })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.meetingId, meeting.id),
          or(
            eq(mediaAssets.type, "screenshot"),
            eq(mediaAssets.type, "video_frame"),
          ),
        ),
      )
      .orderBy(asc(mediaAssets.timestampMs), asc(mediaAssets.createdAt)),
    accessScope === "workspace"
      ? listTeamSpeakerAliases(meeting.teamId)
      : Promise.resolve([]),
  ]);
  const displaySegments = applySpeakerAliasesToSegments(
    segments,
    speakerAliases,
  );

  return {
    id: meeting.id,
    title: getMeetingDisplayTitle({
      title: meeting.title,
      attendeeEmails: meeting.calendarAttendeeEmails,
      workspaceDomain: workspace.domain,
    }),
    platform: meeting.platform,
    status: meeting.status,
    startedAt:
      (meeting.startedAt ?? meeting.createdAt)?.toISOString() ?? null,
    endedAt: meeting.endedAt?.toISOString() ?? null,
    durationMs: getTranscriptDurationMs(meeting.transcriptDurationMs) ?? null,
    transcriptJobStatus: meeting.transcriptJobStatus,
    translationSummary: buildMeetingTranslationSummary({
      errorMessage: meeting.translationErrorMessage,
      status: meeting.translationStatus,
      totalSegments: displaySegments.length,
      translatedSegments: displaySegments.filter((segment) =>
        Boolean(segment.translatedText?.trim()),
      ).length,
    }),
    audioUrl:
      meeting.audioObjectKey || meeting.recallRecordingId
        ? `/api/meetings/${meeting.id}/audio`
        : null,
    visualAssets: visualAssets.map((asset) => ({
      id: asset.id,
      capturedAt: asset.capturedAt?.toISOString() ?? null,
      timestampMs: asset.timestampMs,
      url: `/api/meetings/${meeting.id}/images/${asset.id}`,
    })),
    segments: displaySegments.map((segment) => ({
      ...segment,
      emotionLabel: normalizeEmotionLabel(segment.emotionLabel),
    })),
    speakerAliases,
    speakerSuggestions,
    accessScope,
    canManage: Boolean(meeting.canManage),
    accessPeople,
    entities: normalizeMeetingTranscriptEntities(entities),
  };
}

export async function listMeetingDetailRelatedMeetingsForWorkspace(
  workspace: WorkspaceContext,
  meetingId: string,
): Promise<MeetingDetailRelatedMeeting[]> {
  const parsedMeetingId = uuidSchema.safeParse(meetingId);

  if (!parsedMeetingId.success) {
    return [];
  }

  const rows = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      startedAt: meetings.startedAt,
      createdAt: meetings.createdAt,
      calendarAttendeeEmails: calendarEvents.attendeeEmails,
    })
    .from(meetings)
    .leftJoin(calendarEvents, eq(calendarEvents.id, meetings.calendarEventId))
    .where(
      and(
        getReadableMeetingsCondition(workspace),
        ne(meetings.status, "cancelled"),
      ),
    )
    .orderBy(desc(meetings.startedAt), desc(meetings.createdAt));
  const meetingItems = rows.map((meeting) => ({
    id: meeting.id,
    title: getMeetingDisplayTitle({
      title: meeting.title,
      attendeeEmails: meeting.calendarAttendeeEmails,
      workspaceDomain: workspace.domain,
    }),
    startedAt: (meeting.startedAt ?? meeting.createdAt).toISOString(),
    externalParticipantKeys: getExternalParticipantKeys(
      meeting.calendarAttendeeEmails,
      workspace.domain,
    ),
  }));
  const itemById = new Map(
    meetingItems.map((meeting) => [meeting.id, meeting]),
  );
  const relatedMeetingIds = getRelatedMeetingIdsForDetail(
    meetingItems,
    parsedMeetingId.data,
  );

  if (relatedMeetingIds.length === 0) {
    return [];
  }

  const transcriptPreviewEntries = await Promise.all(
    relatedMeetingIds.map(async (relatedMeetingId) => {
      const segments = await db
        .select({
          id: transcriptSegments.id,
          speaker: transcriptSegments.speaker,
          startMs: transcriptSegments.startMs,
          text: transcriptSegments.text,
        })
        .from(transcriptSegments)
        .where(
          and(
            eq(transcriptSegments.meetingId, relatedMeetingId),
            eq(
              transcriptSegments.jobId,
              currentTranscriptJobIdSubquery(relatedMeetingId),
            ),
          ),
        )
        .orderBy(asc(transcriptSegments.startMs))
        .limit(MEETING_DETAIL_RELATED_TRANSCRIPT_SEGMENT_LIMIT + 1);

      return [relatedMeetingId, segments] as const;
    }),
  );
  const transcriptPreviewByMeetingId = new Map(transcriptPreviewEntries);

  return relatedMeetingIds.flatMap((relatedMeetingId) => {
    const meeting = itemById.get(relatedMeetingId);

    if (!meeting) {
      return [];
    }

    const segments = transcriptPreviewByMeetingId.get(relatedMeetingId) ?? [];

    return [
      {
        id: meeting.id,
        title: meeting.title,
        startedAt: meeting.startedAt,
        transcriptPreview: segments.slice(
          0,
          MEETING_DETAIL_RELATED_TRANSCRIPT_SEGMENT_LIMIT,
        ),
        hasMoreTranscriptSegments:
          segments.length > MEETING_DETAIL_RELATED_TRANSCRIPT_SEGMENT_LIMIT,
      },
    ];
  });
}

function getRelatedMeetingIdsForDetail(
  meetingsForGrouping: Array<{
    externalParticipantKeys: string[];
    id: string;
    startedAt: string;
    title: string;
  }>,
  meetingId: string,
) {
  const relatedGroup = groupRelatedMeetings(meetingsForGrouping, {
    includeTitleKeys: true,
  }).find(
    (group) =>
      group.id === meetingId ||
      group.relatedMeetings.some((meeting) => meeting.id === meetingId),
  );

  if (!relatedGroup) {
    return [];
  }

  return [
    relatedGroup.id,
    ...relatedGroup.relatedMeetings.map((meeting) => meeting.id),
  ].filter((relatedMeetingId) => relatedMeetingId !== meetingId);
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
    entities.push({
      aliases: normalizeMeetingEntityAliases(row.aliases),
      normalizedValue,
      type,
      value,
    });
  }

  return entities;
}

function normalizeMeetingEntityAliases(aliases: string[]) {
  if (!Array.isArray(aliases)) {
    return [];
  }

  return aliases
    .filter((alias): alias is string => typeof alias === "string")
    .map((alias) => alias.trim())
    .filter(Boolean);
}

function isDisplayableMeetingEntityType(type: string) {
  return type === "organization" || type === "name" || type === "money";
}

function isDashboardPrimaryEntityType(type: string) {
  return type === "organization";
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
      type: meetingEntities.type,
    })
    .from(meetingEntities)
    .where(inArray(meetingEntities.meetingId, meetingIds))
    .orderBy(asc(meetingEntities.createdAt));

  for (const row of rows) {
    const normalizedValue = row.normalizedValue.trim().toLowerCase();
    const type = row.type.trim().toLowerCase();

    if (
      !primaryEntityByMeetingId.has(row.meetingId) &&
      normalizedValue &&
      isDashboardPrimaryEntityType(type) &&
      !nonInformativePrimaryEntities.has(normalizedValue)
    ) {
      primaryEntityByMeetingId.set(row.meetingId, normalizedValue);
    }
  }

  return primaryEntityByMeetingId;
}

async function listMeetingSpeakerSuggestions(
  meetingId: string,
  calendarAttendeeEmails: unknown,
): Promise<SpeakerSuggestion[]> {
  const [rows, participantRows] = await Promise.all([
    db
      .select({
        email: meetingAttendees.email,
        name: users.name,
      })
      .from(meetingAttendees)
      .leftJoin(users, eq(users.email, meetingAttendees.email))
      .where(eq(meetingAttendees.meetingId, meetingId))
      .orderBy(asc(meetingAttendees.email))
      .limit(100),
    db
      .select({
        email: meetingParticipantTimeline.email,
        name: meetingParticipantTimeline.name,
      })
      .from(meetingParticipantTimeline)
      .where(eq(meetingParticipantTimeline.meetingId, meetingId))
      .orderBy(asc(meetingParticipantTimeline.startMs))
      .limit(200),
  ]);
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
  const uniqueFullNameByFirstName = getUniqueFullNameByFirstName(
    participantRows.flatMap((row) => (row.name ? [row.name] : [])),
  );

  return Array.from(attendeeEmails)
    .sort()
    .map((email) => {
      const fallbackName = formatNameFromEmail(email);

      return {
        email,
        name:
          namesByEmail.get(email) ||
          getUniqueFullNameForFirstNameAlias(
            fallbackName,
            uniqueFullNameByFirstName,
          ) ||
          fallbackName,
      };
    });
}

async function listMeetingAccessPeople(
  meetingId: string,
  ownerUserId: string,
): Promise<MeetingAccessPerson[]> {
  const rows = await db
    .select({
      email: users.email,
      id: users.id,
      name: users.name,
    })
    .from(meetingAccess)
    .innerJoin(users, eq(meetingAccess.userId, users.id))
    .where(
      and(
        eq(meetingAccess.meetingId, meetingId),
        isNull(meetingAccess.revokedAt),
      ),
    )
    .orderBy(asc(users.email))
    .limit(100);

  return Array.from(
    new Map(
      rows
        .filter(({ id }) => id !== ownerUserId)
        .map(({ email, name }) => [email, { email, name }]),
    ).values(),
  ).slice(0, 20);
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
        ne(teamMemberships.role, "external"),
      ),
    )
    .orderBy(asc(users.email))
    .limit(100);
}
