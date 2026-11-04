import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { meetings, meetingParts, transcriptSegments, intelSearches } from "@/db/schema";
import { getComposedMeetingForFollowup } from "@/lib/meeting-composition";
import { currentTranscriptJobIdsSubquery } from "@/lib/current-transcript-job";
import { getPersonalReadableMeetingsCondition } from "@/lib/meeting-access-policy";
import type { WorkspaceContext } from "@/lib/workspace";
import { IntelCapacityError } from "./content";
import { buildCatalog } from "./provenance";
import { searchInputSchema, type IntelMeeting, type SearchInput, type HistoryEntry } from "./types";

export async function loadIntelMeetings(workspace: WorkspaceContext, meetingId?: string): Promise<IntelMeeting[]> {
  const rows = await db.select({ id: meetings.id, title: meetings.title, startedAt: meetings.startedAt,
    createdAt: meetings.createdAt, status: meetings.status, aiIntel: meetings.aiIntel, aiFollowup: meetings.aiFollowup,
  }).from(meetings).where(and(
    eq(meetings.teamId, workspace.teamId), getPersonalReadableMeetingsCondition(workspace),
    eq(meetings.status, "ready"), meetingId ? eq(meetings.id, meetingId) : undefined,
  )).orderBy(desc(meetings.startedAt), desc(meetings.createdAt), asc(meetings.id)).limit(1001);
  if (rows.length > 1000) throw new IntelCapacityError("Intel currently supports up to 1,000 accessible meetings. This workspace exceeds that limit.");
  if (!rows.length) return [];
  const segments = await db.select({ id: transcriptSegments.id, meetingId: transcriptSegments.meetingId,
    speaker: transcriptSegments.speaker, text: transcriptSegments.text, startMs: transcriptSegments.startMs,
  }).from(transcriptSegments).innerJoin(meetings, eq(meetings.id, transcriptSegments.meetingId))
    .where(and(inArray(meetings.id, rows.map(m => m.id)), getPersonalReadableMeetingsCondition(workspace),
      inArray(transcriptSegments.jobId, currentTranscriptJobIdsSubquery(meetings.id))))
    .orderBy(asc(transcriptSegments.startMs), asc(transcriptSegments.id)).limit(100001);
  if (segments.length > 100000) throw new IntelCapacityError("Intel currently supports up to 100,000 transcript segments. This workspace exceeds that limit.");
  const byMeeting = new Map<string, typeof segments>();
  for (const segment of segments) {
    const group = byMeeting.get(segment.meetingId) ?? []; group.push(segment); byMeeting.set(segment.meetingId, group);
  }
  const corpus: IntelMeeting[] = rows.map(row => ({ ...row, startedAt: (row.startedAt ?? row.createdAt).toISOString(),
    date: (row.startedAt ?? row.createdAt).toISOString(), transcriptJobStatus: null,
    segments: (byMeeting.get(row.id) ?? []).map(({ id, speaker, text, startMs }) => ({ id, speaker, text, startMs })),
  })).filter(m => m.segments.length > 0);
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
export async function loadIntelHistory(workspace: WorkspaceContext, corpus: IntelMeeting[]): Promise<HistoryEntry[]> {
  const rows = await db.select().from(intelSearches).where(and(eq(intelSearches.teamId, workspace.teamId), eq(intelSearches.userId, workspace.userId)))
    .orderBy(desc(intelSearches.createdAt)).limit(50);
  const catalog = buildCatalog(corpus);
  return rows.flatMap(row => {
    const input = searchInputSchema.safeParse(row.input);
    if (!input.success) return [];
    const label = resolveInputLabel(input.data, corpus, catalog);
    // Selection labels are always rebuilt from currently authorized sources.
    return label ? [{ id: row.id, input: input.data, label, createdAt: row.createdAt.toISOString() }] : [];
  });
}
export async function saveIntelHistory(workspace: WorkspaceContext, input: SearchInput) {
  const [saved] = await db.insert(intelSearches).values({ teamId: workspace.teamId, userId: workspace.userId, input }).returning({ id: intelSearches.id });
  await db.delete(intelSearches).where(and(eq(intelSearches.teamId, workspace.teamId), eq(intelSearches.userId, workspace.userId),
    sql`${intelSearches.id} in (select id from intel_searches where team_id = ${workspace.teamId} and user_id = ${workspace.userId} order by created_at desc offset 50)`));
  return saved.id;
}
