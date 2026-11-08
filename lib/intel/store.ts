import { and, asc, desc, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db/client";
import { meetings, meetingNotes, meetingParts, transcriptSegments, intelSearches } from "@/db/schema";
import { getComposedMeetingForFollowup } from "@/lib/meeting-composition";
import { attachSpeakerIdentitiesForMeetings } from "@/lib/speaker-identity";
import { currentTranscriptJobIdsSubquery } from "@/lib/current-transcript-job";
import { getPersonalReadableMeetingsCondition } from "@/lib/meeting-access-policy";
import type { WorkspaceContext } from "@/lib/workspace";
import { IntelCapacityError } from "./content";
import { buildCatalog } from "./provenance";
import { searchInputSchema, type Segment, type IntelMeeting, type SearchInput, type HistoryEntry } from "./types";

export async function loadIntelMeetings(workspace: WorkspaceContext, meetingId?: string): Promise<IntelMeeting[]> {
  const rows = await db.select({ id: meetings.id, title: meetings.title, startedAt: meetings.startedAt,
    notes: { content: meetingNotes.content, blocks: meetingNotes.blocks },
    createdAt: meetings.createdAt, attributionRevision: meetings.attributionRevision, status: meetings.status, aiIntel: meetings.aiIntel, aiFollowup: meetings.aiFollowup,
  }).from(meetings).leftJoin(meetingNotes, and(eq(meetingNotes.meetingId, meetings.id), eq(meetingNotes.userId, workspace.userId))).where(and(
    eq(meetings.teamId, workspace.teamId), getPersonalReadableMeetingsCondition(workspace),
    eq(meetings.status, "ready"), meetingId ? eq(meetings.id, meetingId) : undefined,
  )).orderBy(desc(meetings.startedAt), desc(meetings.createdAt), asc(meetings.id)).limit(1001);
  if (rows.length > 1000) throw new IntelCapacityError("Intel currently supports up to 1,000 accessible meetings. This workspace exceeds that limit.");
  if (!rows.length) return [];
  // Page the transcript rows so large archives do not hit a response-size limit.
  // Keep the existing chronological order: stored extraction hashes depend on it.
  const segments: (Segment & { meetingId: string })[] = [];
  const pageSize = 10000;
  // Limit each scan to a small meeting group. Global pagination otherwise
  // repeatedly scans and sorts the entire archive for every 10,000 rows.
  async function loadGroup(group: typeof rows) {
    let cursor: { id: string; startMs: number } | undefined;
    while (true) {
      const page = await db.select({ id: transcriptSegments.id, meetingId: transcriptSegments.meetingId,
        meetingSpeakerId: transcriptSegments.meetingSpeakerId, speaker: transcriptSegments.speaker, text: transcriptSegments.text, startMs: transcriptSegments.startMs,
      }).from(transcriptSegments).innerJoin(meetings, eq(meetings.id, transcriptSegments.meetingId))
        .where(and(eq(meetings.teamId, workspace.teamId),
          inArray(meetings.id, group.map(m => m.id)), getPersonalReadableMeetingsCondition(workspace),
          inArray(transcriptSegments.jobId, currentTranscriptJobIdsSubquery(meetings.id)),
          cursor ? or(gt(transcriptSegments.startMs, cursor.startMs),
            and(eq(transcriptSegments.startMs, cursor.startMs), gt(transcriptSegments.id, cursor.id))) : undefined))
        .orderBy(asc(transcriptSegments.startMs), asc(transcriptSegments.id)).limit(pageSize);
      segments.push(...page);
      if (page.length < pageSize) break;
      cursor = page[page.length - 1];
    }
  }
  // Bound database pressure while avoiding a waterfall across independent groups.
  // Each group is a network round trip per page; six at a time loads a 325
  // meeting archive in three waves instead of five.
  const GROUP_SIZE = 25, PARALLEL_GROUPS = 6;
  for (let offset = 0; offset < rows.length; offset += GROUP_SIZE * PARALLEL_GROUPS) {
    await Promise.all(Array.from({ length: PARALLEL_GROUPS }, (_, i) => offset + i * GROUP_SIZE).filter(start => start < rows.length)
      .map(start => loadGroup(rows.slice(start, start + GROUP_SIZE))));
  }
  const byMeeting = new Map<string, typeof segments>();
  for (const segment of segments) {
    const group = byMeeting.get(segment.meetingId) ?? []; group.push(segment); byMeeting.set(segment.meetingId, group);
  }
  let corpus: IntelMeeting[] = rows.map(row => ({ ...row, startedAt: (row.startedAt ?? row.createdAt).toISOString(),
    date: (row.startedAt ?? row.createdAt).toISOString(), transcriptJobStatus: null,
    segments: (byMeeting.get(row.id) ?? []).map(({ id, speaker, text, startMs, meetingSpeakerId }) => ({ id, speaker, text, startMs, meetingSpeakerId })),
  })).filter(m => m.segments.length > 0);
  corpus = await attachSpeakerIdentitiesForMeetings(corpus, workspace);
  const parts = await db.select({ meetingId: meetingParts.meetingId, sourceMeetingId: meetingParts.sourceMeetingId }).from(meetingParts)
    .where(inArray(meetingParts.meetingId, rows.map(m => m.id)));
  const authorizedSegments = new Set(corpus.flatMap(m => m.segments.map(s => s.id)));
  for (const meeting of corpus) {
    if (!parts.some(p => p.meetingId === meeting.id)) continue;
    const composed = await getComposedMeetingForFollowup(workspace, meeting.id);
    const source = composed?.followupSource;
    if (composed?.status === "ready" && source && source.segments.every(s => authorizedSegments.has(s.id))) {
      meeting.followupSource = source;
    } else {
      // Never reuse a combined summary containing a source outside personal scope.
      meeting.aiFollowup = null;
    }
  }
  return corpus;
}
export function resolveInputLabel(input: SearchInput, corpus: IntelMeeting[], catalog = buildCatalog(corpus)) {
  if (input.kind === "content") return input.text.slice(0, 100);
  if (input.kind === "intel") return catalog.intel.find(i => i.id === input.id)?.text ?? null;
  const people = input.ids.map(id => catalog.people.find(p => p.id === id));
  return people.every(Boolean) ? [...new Set(people.map(p => p!.name))].join(", ") : null;
}
function loadHistoryRows(workspace: WorkspaceContext) {
  return db.select({ id: intelSearches.id, input: intelSearches.input, status: intelSearches.status, createdAt: intelSearches.createdAt }).from(intelSearches).where(and(eq(intelSearches.teamId, workspace.teamId), eq(intelSearches.userId, workspace.userId), or(isNull(intelSearches.status), ne(intelSearches.status, "preview"))))
    .orderBy(desc(intelSearches.createdAt)).limit(50);
}

// Typed searches label themselves, so their history needs no transcripts and
// returns in one query. Selections of people or intel are labelled from current
// authorized sources by the full catalog load.
export async function loadTypedIntelHistory(workspace: WorkspaceContext): Promise<HistoryEntry[]> {
  return (await loadHistoryRows(workspace)).flatMap(row => {
    const input = searchInputSchema.safeParse(row.input);
    if (!input.success || input.data.kind !== "content") return [];
    return [{ id: row.id, input: input.data, label: input.data.text.slice(0, 100), ...(row.status ? { savedJob: true } : {}), createdAt: row.createdAt.toISOString() }];
  });
}

export async function loadIntelHistory(workspace: WorkspaceContext, corpus: IntelMeeting[], catalog = buildCatalog(corpus)): Promise<HistoryEntry[]> {
  const rows = await loadHistoryRows(workspace);
  return rows.flatMap(row => {
    const input = searchInputSchema.safeParse(row.input);
    if (!input.success) return [];
    const label = resolveInputLabel(input.data, corpus, catalog);
    // Selection labels are always rebuilt from currently authorized sources.
    return label ? [{ id: row.id, input: input.data, label, ...(row.status ? { savedJob: true } : {}), createdAt: row.createdAt.toISOString() }] : [];
  });
}
