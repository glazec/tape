import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { withDatabaseWorkspace } from "@/db/rls-context";
import { currentTranscriptJobIdsSubquery } from "@/lib/current-transcript-job";
import { getCurrentUser } from "@/lib/auth";
import { getPersonIdentity, getPersonWorkspace } from "@/lib/people";
import { exportTranscriptSection, sanitizeFilename } from "@/lib/transcript-export";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ personId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { personId } = await context.params;
  const missing = () => Response.json({ error: "Person not found" }, { status: 404 });
  if (!z.uuid().safeParse(personId).success) return missing();
  const workspace = await getPersonWorkspace(user, personId);
  const identity = await getPersonIdentity(workspace, personId);
  if (identity.kind !== "found") return missing();
  const { person } = identity.data;

  // The directory summary stops at 201 meetings. Select all readable sources
  // here, deduplicating a composed source that also matches the person directly.
  const result = await db.execute(sql`
    with emails as (select email from person_emails where person_id = ${person.id}),
    matched as (
      select meeting_id from meeting_speakers where person_id = ${person.id}
      union select meeting_id from meeting_attendees where lower(email) in (select email from emails)
      union select meeting_id from meeting_participant_timeline where lower(email) in (select email from emails)
      union select m.id from meetings m join calendar_events c on c.id = m.calendar_event_id
        where m.team_id = ${workspace.teamId} and exists (
          select 1 from jsonb_array_elements_text(c.attendee_emails) e where lower(e) in (select email from emails))
    ), readable as (
      select m.id from meetings m join matched on matched.meeting_id = m.id
      where m.team_id = ${workspace.teamId} and m.status <> 'cancelled' and app_private.can_read_meeting(m.id)
    ), sources as (
      select id from readable union select p.source_meeting_id from meeting_parts p join readable r on r.id = p.meeting_id
    )
    select m.id, m.title, coalesce(m.started_at, c.starts_at, m.created_at) as at
    from sources s join meetings m on m.id = s.id left join calendar_events c on c.id = m.calendar_event_id
    where m.team_id = ${workspace.teamId} and app_private.can_read_meeting(m.id)
      and exists (select 1 from transcript_segments s where s.meeting_id = m.id
        and s.job_id in ${currentTranscriptJobIdsSubquery(sql`m.id`)})
    order by at, m.id`);
  const meetings = result.rows as Array<{ id: string; title: string; at: string | Date }>;
  let index = 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index === meetings.length) {
        if (!index) controller.enqueue(encoder.encode("No transcripts available from meetings you can open.\n"));
        controller.close();
        return;
      }
      const meeting = meetings[index++];
      const title = `${new Date(meeting.at).toISOString().slice(0, 10)} · ${meeting.title}`;
      const section = await withDatabaseWorkspace(workspace, () => exportTranscriptSection(workspace, meeting.id, title));
      controller.enqueue(encoder.encode(section + "\n"));
    },
  });
  return new Response(stream, { headers: {
    "content-type": "text/plain; charset=utf-8",
    "content-disposition": `attachment; filename="${sanitizeFilename(person.name)} transcripts.txt"; filename*=UTF-8''${encodeURIComponent(person.name + " transcripts.txt").replace(/['()*]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase())}`,
    "cache-control": "private, no-store",
  } });
}
