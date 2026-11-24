import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import type { WorkspaceContext } from "@/lib/workspace";

export const personNoteInput = z.strictObject({ body: z.string().trim().min(1).max(4000) });

export type PersonNote = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
};

type NoteRow = Omit<PersonNote, "createdAt" | "updatedAt"> & {
  createdAt: Date | string;
  updatedAt: Date | string;
};
function formatNote(note: NoteRow): PersonNote {
  return { ...note, createdAt: new Date(note.createdAt).toISOString(), updatedAt: new Date(note.updatedAt).toISOString() };
}

// Resolve notes through the current merge chain so merging and undoing a merge
// preserve note ownership without moving or copying the underlying records.
function personTree(teamId: string, personId?: string) {
  return sql`with recursive person_tree(id, canonical_id, canonical_name) as (
    select id, id, preferred_name from workspace_people
    where team_id = ${teamId} and merged_into_id is null
    ${personId ? sql`and id = ${personId}` : sql.empty()}
    union all
    select child.id, parent.canonical_id, parent.canonical_name
    from workspace_people child join person_tree parent on child.merged_into_id = parent.id
    where child.team_id = ${teamId}
  )`;
}

const noteFields = sql`n.id, n.body, n.created_at as "createdAt", n.updated_at as "updatedAt",
  coalesce(nullif(btrim((select u.name from users u where u.id = n.author_id)), ''), 'Workspace member') as "authorName",
  coalesce(n.author_id = app_private.current_user_id(), false) as "canEdit"`;

export async function listPersonNotes(workspace: WorkspaceContext, personId: string): Promise<PersonNote[]> {
  const { rows } = await db.execute<NoteRow>(sql`
    ${personTree(workspace.teamId, personId)}
    select ${noteFields}
    from person_notes n join person_tree p on p.id = n.person_id
    where n.team_id = ${workspace.teamId}
    order by n.created_at desc, n.id`);
  return rows.map(formatNote);
}

export async function createPersonNote(workspace: WorkspaceContext, personId: string, body: string) {
  const { rows } = await db.execute<NoteRow>(sql`
    insert into person_notes as n (team_id, person_id, author_id, body)
    select ${workspace.teamId}, p.id, ${workspace.userId}, ${body}
    from workspace_people p where p.team_id = ${workspace.teamId} and p.id = ${personId} and p.merged_into_id is null
    returning ${noteFields}`);
  return rows[0] ? formatNote(rows[0]) : null;
}

export async function updatePersonNote(workspace: WorkspaceContext, personId: string, noteId: string, body: string) {
  const { rows } = await db.execute<NoteRow>(sql`
    ${personTree(workspace.teamId, personId)}
    update person_notes n set body = ${body}, updated_at = now()
    where n.id = ${noteId} and n.team_id = ${workspace.teamId} and n.author_id = ${workspace.userId}
      and n.person_id in (select id from person_tree)
    returning ${noteFields}`);
  return rows[0] ? formatNote(rows[0]) : null;
}

export async function deletePersonNote(workspace: WorkspaceContext, personId: string, noteId: string) {
  const { rows } = await db.execute(sql`
    ${personTree(workspace.teamId, personId)}
    delete from person_notes n
    where n.id = ${noteId} and n.team_id = ${workspace.teamId} and n.author_id = ${workspace.userId}
      and n.person_id in (select id from person_tree)
    returning n.id`);
  return rows.length > 0;
}

export type IntelPersonNote = { id: string; personId: string; personName: string; body: string; authorName: string; createdAt?: string; updatedAt: string; viewerIsSubject?: boolean };

export async function listIntelPersonNotes(workspace: WorkspaceContext): Promise<IntelPersonNote[]> {
  const { rows } = await db.execute<NoteRow & { personId: string; personName: string; viewerIsSubject: boolean }>(sql`
    ${personTree(workspace.teamId)}
    select ${noteFields}, p.canonical_id as "personId", p.canonical_name as "personName", exists (
      select 1 from person_emails e
      join person_tree identity on identity.id = e.person_id
      join users viewer on viewer.id = ${workspace.userId} and lower(viewer.email) = e.email
      where e.team_id = ${workspace.teamId} and identity.canonical_id = p.canonical_id
    ) as "viewerIsSubject"
    from person_notes n join person_tree p on p.id = n.person_id
    where n.team_id = ${workspace.teamId}
    order by n.updated_at desc, n.id`);
  return rows.map(({ id, personId, personName, body, authorName, createdAt, updatedAt, viewerIsSubject }) =>
    ({ id, personId, personName, body, authorName, createdAt: createdAt ? new Date(createdAt).toISOString() : undefined, updatedAt: new Date(updatedAt).toISOString(), viewerIsSubject }));
}
