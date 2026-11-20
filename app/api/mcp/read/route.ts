import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { withDatabaseWorkspace } from "@/db/rls-context";
import { meetings, transcriptSegments, users, workspacePeople } from "@/db/schema";
import { normalizeEmailDomain } from "@/lib/access";
import { currentTranscriptJobIdsSubquery } from "@/lib/current-transcript-job";
import { mcpBackendAuthErrorResponse, verifyMcpBackendRequest } from "@/lib/mcp-backend-auth";
import { getReadableMeetingsCondition } from "@/lib/meeting-access-policy";
import { getComposedMeetingForFollowup } from "@/lib/meeting-composition";
import { getCurrentMeetingFollowup, storedFollowupSchema } from "@/lib/meeting-followup-source";
import { getMeetingTodoControls, getPersonIdentity } from "@/lib/people";
import { getStoredPersonProfile } from "@/lib/person-profile";

export const runtime = "nodejs";

const readSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("transcript"),
    meetingId: z.uuid(),
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().min(0).max(1_000_000),
  }),
  z.strictObject({
    operation: z.literal("todos"), start: z.iso.date().nullable(), end: z.iso.date().nullable(),
    status: z.enum(["todo", "done", "cancelled"]).nullable(), assignee: z.string().trim().nullable(),
    meetingId: z.uuid().nullable(), limit: z.int().min(1).max(25), offset: z.int().min(0).max(1_000_000),
  }),
  z.strictObject({ operation: z.literal("ongoing_transcript"), meetingId: z.uuid() }),
  z.strictObject({ operation: z.literal("followup"), meetingId: z.uuid() }),
  z.strictObject({
    operation: z.literal("search_people"),
    query: z.string().trim().min(1).max(254),
    limit: z.number().int().min(1).max(25),
  }),
  z.strictObject({ operation: z.literal("person_profile"), personId: z.uuid() }),
]);

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  try {
    const { input, user } = verifyMcpBackendRequest(await request.text(), request.headers);
    const parsed = readSchema.safeParse(input);
    if (!parsed.success) {
      return Response.json({ error: "Invalid Tape read request" }, { status: 400 });
    }
    const domain = normalizeEmailDomain(user.email);
    const [caller] = await db.select({ id: users.id }).from(users)
      .where(eq(users.authUserId, user.id)).limit(1);
    if (!caller || !domain) {
      return Response.json({ error: "Tape user not found" }, { status: 403 });
    }

    const read = parsed.data;
    if (read.operation === "search_people") {
      const people = await db.select({
        id: workspacePeople.id,
        name: workspacePeople.preferredName,
        team_id: workspacePeople.teamId,
      }).from(workspacePeople).where(and(
        isNull(workspacePeople.mergedIntoId),
        sql`app_private.is_internal_member(${workspacePeople.teamId})`,
        sql`(
          strpos(lower(${workspacePeople.preferredName}), lower(${read.query})) > 0
          or exists (
            select 1 from person_names n
            where n.person_id = ${workspacePeople.id}
              and strpos(lower(n.name), lower(${read.query})) > 0
          )
          or exists (
            select 1 from person_emails e
            where e.person_id = ${workspacePeople.id} and e.email = lower(${read.query})
          )
        )`,
      )).orderBy(asc(workspacePeople.preferredName), asc(workspacePeople.id)).limit(read.limit + 1);
      return Response.json({
        people: people.slice(0, read.limit),
        has_more: people.length > read.limit,
      }, { headers: privateHeaders });
    }

    if (read.operation === "person_profile") {
      const [person] = await db.select({ teamId: workspacePeople.teamId }).from(workspacePeople)
        .where(and(eq(workspacePeople.id, read.personId), sql`app_private.is_internal_member(${workspacePeople.teamId})`))
        .limit(1);
      if (!person) return Response.json({ error: "Person not found" }, { status: 404 });
      const workspace = { userId: caller.id, teamId: person.teamId, domain };
      const result = await withDatabaseWorkspace(workspace, async () => {
        let lookup = await getPersonIdentity(workspace, read.personId);
        if (lookup.kind === "merged") lookup = await getPersonIdentity(workspace, lookup.personId);
        if (lookup.kind !== "found") return null;
        const profile = await getStoredPersonProfile(workspace, lookup.data.person.id);
        return { person: lookup.data.person, profile };
      });
      if (!result) return Response.json({ error: "Person not found" }, { status: 404 });
      return Response.json(result, { headers: privateHeaders });
    }

    const readFollowup = async (meeting: { id: string; teamId: string }) => {
      const workspace = { userId: caller.id, teamId: meeting.teamId, domain };
      return withDatabaseWorkspace(workspace, async () => {
        const composed = await getComposedMeetingForFollowup(workspace, meeting.id);
        if (!composed || composed.status === "cancelled") return null;
        const result = getCurrentMeetingFollowup(composed);
        if (!result) return { followup: null };
        const saved = storedFollowupSchema.parse(composed.aiFollowup);
        const controls = await getMeetingTodoControls(meeting.id, saved.result.todos);
        return { followup: { ...result, todos: result.todos.map((item, index) => ({
          ...item, ...(controls[index] && { status: controls[index].status }),
        })) } };
      });
    };

    if (read.operation === "todos") {
      const meetingAt = sql`coalesce(${meetings.startedAt}, ${meetings.createdAt})`;
      const candidates = await db.select({
        id: meetings.id, teamId: meetings.teamId, title: meetings.title, at: meetingAt,
      }).from(meetings).where(and(
        getReadableMeetingsCondition({ userId: caller.id }),
        sql`app_private.is_internal_member(${meetings.teamId})`,
        eq(meetings.status, "ready"),
        sql`(${meetings.aiFollowup} #> '{result,todos,0}') is not null`,
        read.meetingId ? eq(meetings.id, read.meetingId) : undefined,
        read.start ? sql`${meetingAt} >= (${read.start}::date::timestamp at time zone 'UTC')` : undefined,
        read.end ? sql`${meetingAt} < ((${read.end}::date + 1)::timestamp at time zone 'UTC')` : undefined,
      )).orderBy(desc(meetingAt), meetings.id).limit(read.limit + 1).offset(read.offset);
      const todos = [];
      for (const meeting of candidates.slice(0, read.limit)) {
        const current = await readFollowup(meeting);
        for (const item of current?.followup?.todos ?? []) {
          if (!item.status || (read.status && item.status !== read.status)) continue;
          if (read.assignee && item.person.toLowerCase() !== read.assignee.toLowerCase()) continue;
          todos.push({ meeting_id: meeting.id, meeting_title: meeting.title, meeting_at: meeting.at,
            action: item.text, assignee: item.person, timing: item.timing, status: item.status, evidence: item.evidence });
        }
      }
      return Response.json({ todos, next_offset: candidates.length > read.limit ? read.offset + read.limit : null }, { headers: privateHeaders });
    }

    const meetingCondition = and(
      eq(meetings.id, read.meetingId),
      ne(meetings.status, "cancelled"),
      getReadableMeetingsCondition({ userId: caller.id }),
    );
    const [meeting] = await db.select({
      id: meetings.id,
      teamId: meetings.teamId,
      title: meetings.title,
      bot_id: meetings.recallBotId,
      status: meetings.status,
    }).from(meetings).where(meetingCondition).limit(1);
    if (!meeting) return Response.json({ error: "Meeting not found" }, { status: 404 });
    const summary = { id: meeting.id, title: meeting.title, status: meeting.status };

    if (read.operation === "ongoing_transcript") {
      if (meeting.status !== "recording") {
        const message = meeting.status === "scheduled"
          ? "Recording has not started."
          : "Recording has ended. Use get_meeting_transcript for the saved transcript once processing completes.";
        return Response.json({ error: message }, { status: 409, headers: privateHeaders });
      }
      return Response.json({ meeting: summary, bot_id: meeting.bot_id }, { headers: privateHeaders });
    }

    if (read.operation === "followup") {
      const current = await readFollowup(meeting);
      if (!current) return Response.json({ error: "Meeting not found" }, { status: 404 });
      return Response.json({ meeting: summary, ...current }, { headers: privateHeaders });
    }

    const rows = await db.select({
      id: transcriptSegments.id,
      speaker: sql<string | null>`coalesce(app_private.speaker_name(${transcriptSegments.meetingSpeakerId}), ${transcriptSegments.speaker})`,
      start_ms: transcriptSegments.startMs,
      end_ms: transcriptSegments.endMs,
      text: transcriptSegments.text,
      polished_text: transcriptSegments.polishedText,
      translated_text: transcriptSegments.translatedText,
    }).from(transcriptSegments).innerJoin(meetings, eq(transcriptSegments.meetingId, meetings.id))
      .where(and(meetingCondition, inArray(transcriptSegments.jobId, currentTranscriptJobIdsSubquery(meeting.id))))
      .orderBy(asc(transcriptSegments.startMs), asc(transcriptSegments.endMs), asc(transcriptSegments.id))
      .limit(read.limit + 1).offset(read.offset);
    return Response.json({
      meeting: summary,
      segments: rows.slice(0, read.limit),
      next_offset: rows.length > read.limit ? read.offset + read.limit : null,
    }, { headers: privateHeaders });
  } catch (error) {
    const authResponse = mcpBackendAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("mcp_read_failed", { error: error instanceof Error ? error.name : "unknown" });
    return Response.json({ error: "Tape read unavailable" }, { status: 500 });
  }
}
