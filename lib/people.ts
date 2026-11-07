import { sql } from "drizzle-orm";
import { z } from "zod";

import { createHash } from "node:crypto";

import { db } from "@/db/client";
import { applyConnectionEdits, connectionRelationshipLabels, type MeetingConnection } from "@/lib/meeting-connections";
import { storedFollowupSchema } from "@/lib/meeting-followup-source";
import { personNameKey } from "@/lib/person-names";
import { summarizeColleagues } from "@/lib/person-relationship";
import { getOrCreateWorkspaceForSessionUser, type WorkspaceContext } from "@/lib/workspace";
import type { SessionUser } from "@/lib/auth";

export { personNameKey, summarizeColleagues };

export const PERSON_MEETING_LIMIT = 200;

export type PersonSummary = {
  id: string;
  name: string;
  emails: string[];
  names: string[];
  isTeammate: boolean;
};

export type PersonMeeting = {
  id: string;
  title: string;
  at: string;
  ownerName: string;
  /** Colleagues in the meeting, by name. */
  colleagues: string[];
  /** Whether this viewer can open the meeting itself. */
  canOpen: boolean;
  spoke: boolean;
  talkMs: number;
  totalMs: number;
  durationMs: number;
};

export type TodoStatus = "todo" | "in_progress" | "done";
export type TodoState = { status: TodoStatus; updatedBy: string | null; updatedAt: string | null };

export type PersonFollowupItem = {
  kind: "todo" | "dynamic";
  text: string;
  timing: string | null;
  meetingId: string;
  meetingTitle: string;
  meetingAt: string;
  segmentId: string;
  todoKey: string;
  state?: TodoState;
};

export type PersonConnection = {
  kind: MeetingConnection["kind"];
  name: string | null;
  company: string | null;
  title: string | null;
  relationship: string;
  context: string;
  meetingId: string;
  meetingTitle: string;
  meetingAt: string;
  segmentId: string;
};

export type PersonColleague = { name: string; meetings: number; durationMs: number; lastAt: string };

export type PersonPageData = {
  person: PersonSummary;
  canMerge: boolean;
  meetings: PersonMeeting[];
  todos: PersonFollowupItem[];
  dynamics: PersonFollowupItem[];
  connections: PersonConnection[];
  colleagues: PersonColleague[];
  truncated: boolean;
  /** How the viewer appears in colleague lists, for "With me" and to do credit. */
  viewerName: string;
};

export type PersonLookup =
  | { kind: "found"; data: PersonPageData }
  | { kind: "merged"; personId: string }
  | { kind: "missing" };

const uuidSchema = z.uuid();

type Row = Record<string, unknown>;
async function rows<T extends Row>(query: ReturnType<typeof sql>) {
  return (await db.execute(query)).rows as T[];
}
export async function getPersonPage(workspace: WorkspaceContext, personId: string, language: string): Promise<PersonLookup> {
  if (!uuidSchema.safeParse(personId).success) return { kind: "missing" };
  const [person] = await rows<{ id: string; name: string; mergedIntoId: string | null }>(sql`
    with recursive chain as (
      select id, preferred_name, merged_into_id, 0 as depth from workspace_people
      where id = ${personId} and team_id = ${workspace.teamId}
      union all
      select p.id, p.preferred_name, p.merged_into_id, chain.depth + 1 from workspace_people p
      join chain on p.id = chain.merged_into_id where chain.depth < 10
    )
    select id, preferred_name as name, merged_into_id as "mergedIntoId" from chain order by depth desc limit 1`);
  if (!person) return { kind: "missing" };
  if (person.id !== personId) return { kind: "merged", personId: person.id };
  // External guests can see a meeting's speakers but not the workspace directory.
  const [access] = await rows<{ internal: boolean; canMerge: boolean }>(sql`
    select app_private.is_internal_member(${workspace.teamId}) as internal, app_private.can_merge_person(${personId}) as "canMerge"`);
  if (!access?.internal) return { kind: "missing" };

  const [identity] = await rows<{ emails: string[] | null; names: string[] | null }>(sql`
    select
      (select array_agg(email order by confirmed_at, email) from person_emails where person_id = ${personId}) as emails,
      (select array_agg(name order by created_at, name) from person_names where person_id = ${personId}) as names`);
  const emails = identity?.emails ?? [];
  const isTeammate = await isPersonColleague(personId);

  // Team-wide: every workspace meeting with the person (gated to colleagues in SQL).
  const meetingRows = await rows<{
    id: string; title: string; at: Date | string; ownerName: string; canOpen: boolean;
    aiFollowup: unknown; talkMs: number | string | null; totalMs: number | string | null; wallMs: number | string | null;
    colleagues: string[] | null;
  }>(sql`select * from app_private.person_team_meetings(${personId}::uuid)`);
  const truncated = meetingRows.length > PERSON_MEETING_LIMIT;
  const visible = meetingRows.slice(0, PERSON_MEETING_LIMIT);
  const meetingList: PersonMeeting[] = visible.map(row => {
    const totalMs = Number(row.totalMs ?? 0);
    const wallMs = Math.max(0, Number(row.wallMs ?? 0));
    return {
      id: row.id, title: row.title, at: new Date(row.at).toISOString(),
      ownerName: row.ownerName,
      colleagues: (row.colleagues ?? []).sort(),
      canOpen: Boolean(row.canOpen),
      talkMs: Number(row.talkMs ?? 0), totalMs, spoke: Number(row.talkMs ?? 0) > 0,
      // Recorded length when there is a transcript, else the call's own length.
      durationMs: totalMs > 0 ? Math.max(totalMs, wallMs) : wallMs,
    };
  });

  const spokenIds = meetingList.filter(meeting => meeting.spoke).map(meeting => meeting.id);
  const personSegments = spokenIds.length ? await rows<{ id: string; meetingId: string; names: string[] }>(sql`
    select id, "meetingId", names from app_private.person_team_segments(${personId}::uuid, ${`{${spokenIds.join(",")}}`}::uuid[], true)`) : [];
  const segmentsById = new Map(personSegments.map(segment => [segment.id, segment]));
  const personNames = new Set([person.name, ...(identity?.names ?? [])].map(name => personNameKey(name)).filter(Boolean));

  const todos: PersonFollowupItem[] = [];
  const dynamics: PersonFollowupItem[] = [];
  const connections: PersonConnection[] = [];
  for (const row of visible) {
    const meeting = meetingList.find(item => item.id === row.id)!;
    if (!meeting.spoke) continue;
    const found = collectPersonFollowup({ meeting, aiFollowup: row.aiFollowup, segmentsById, personNames, language });
    todos.push(...found.todos);
    dynamics.push(...found.dynamics);
    connections.push(...found.connections);
  }
  const [states, [viewer]] = await Promise.all([
    getTodoStates(todos.map(todo => todo.meetingId)),
    rows<{ name: string }>(sql`select coalesce(nullif(btrim(name), ''), email) as name from users where id = ${workspace.userId}`),
  ]);
  for (const todo of todos) todo.state = states.get(`${todo.meetingId}:${todo.todoKey}`);

  return {
    kind: "found",
    data: {
      person: { id: person.id, name: person.name, emails, names: identity?.names ?? [], isTeammate },
      canMerge: Boolean(access.canMerge),
      meetings: meetingList,
      todos, dynamics, connections,
      colleagues: summarizeColleagues(meetingList),
      truncated,
      viewerName: viewer?.name ?? "You",
    },
  };
}

/** Workspace colleagues (members or the team's email domains) get no AI profile. */
export async function isPersonColleague(personId: string) {
  const [row] = await rows<{ colleague: boolean }>(sql`select app_private.is_person_colleague(${personId}::uuid) as colleague`);
  return Boolean(row?.colleague);
}

async function getTodoStates(meetingIds: string[]) {
  const states = new Map<string, TodoState>();
  if (!meetingIds.length) return states;
  const found = await rows<{ meetingId: string; todoKey: string; status: TodoStatus; updatedBy: string | null; updatedAt: Date | string }>(sql`
    select s.meeting_id as "meetingId", s.todo_key as "todoKey", s.status, s.updated_at as "updatedAt",
      coalesce(nullif(btrim(u.name), ''), u.email) as "updatedBy"
    from followup_todo_states s left join users u on u.id = s.updated_by
    where s.meeting_id in (select jsonb_array_elements_text(${JSON.stringify([...new Set(meetingIds)])}::jsonb)::uuid)`);
  for (const row of found) states.set(`${row.meetingId}:${row.todoKey}`, { status: row.status, updatedBy: row.updatedBy, updatedAt: new Date(row.updatedAt).toISOString() });
  return states;
}

/** Stable identity of a followup to do within its meeting. */
export function todoKey(item: { text: string; evidence: Array<{ segmentId: string }> }) {
  return createHash("sha256").update(`${item.evidence[0]?.segmentId ?? ""}\n${item.text.trim()}`).digest("hex").slice(0, 32);
}

export async function setTodoStatus(meetingId: string, key: string, status: TodoStatus) {
  const result = await db.execute(sql`select app_private.set_todo_status(${meetingId}::uuid, ${key}, ${status}) as state`);
  return (result.rows[0] as { state: TodoState }).state;
}

type PersonSegment = { id: string; meetingId: string; names: string[] };

/**
 * A followup item is this person's when it cites their own line and names them
 * as its subject. Matching identity, not a bare name, keeps two people called
 * Alex apart. A connection is theirs when its speaker segment is theirs.
 */
export function collectPersonFollowup(input: {
  meeting: Pick<PersonMeeting, "id" | "title" | "at">;
  aiFollowup: unknown;
  segmentsById: Map<string, PersonSegment>;
  personNames: Set<string | null>;
  language: string;
}) {
  const todos: PersonFollowupItem[] = [];
  const dynamics: PersonFollowupItem[] = [];
  const connections: PersonConnection[] = [];
  const saved = storedFollowupSchema.safeParse(input.aiFollowup);
  if (!saved.success) return { todos, dynamics, connections };
  const { meeting, segmentsById, personNames } = input;
  // Match on the source language; a translation may also translate names.
  const source = saved.data.result;
  const translated = saved.data.translations?.[input.language as "en" | "zh-CN"];
  // Translations keep the source order; use one only when it lines up.
  const textOf = <T,>(list: T[] | undefined, sourceList: T[], index: number) =>
    list && list.length === sourceList.length ? list[index] : sourceList[index];
  const speakerNames = saved.data.speakerNames ?? {};
  const base = { meetingId: meeting.id, meetingTitle: meeting.title, meetingAt: meeting.at };
  const ownSegment = (item: { person: string; evidence: Array<{ segmentId: string }> }) => item.evidence.find(({ segmentId }) => {
    const segment = segmentsById.get(segmentId);
    if (!segment || segment.meetingId !== meeting.id) return false;
    const subject = personNameKey(item.person);
    if (!subject) return false;
    const labels = [...segment.names, speakerNames[segmentId] ?? null, ...personNames].map(name => personNameKey(name)).filter((name): name is string => Boolean(name));
    // The cited line is theirs, so a first name used as the subject is them too.
    return labels.some(label => label === subject || (!subject.includes(" ") && label.split(" ")[0] === subject));
  })?.segmentId;
  source.todos.forEach((item, index) => {
    const segmentId = ownSegment(item);
    const shown = textOf(translated?.todos, source.todos, index);
    if (segmentId) todos.push({ ...base, kind: "todo", text: shown.text, timing: shown.timing, segmentId, todoKey: todoKey(item) });
  });
  source.dynamics.forEach((item, index) => {
    const segmentId = ownSegment(item);
    if (segmentId) dynamics.push({ ...base, kind: "dynamic", text: textOf(translated?.dynamics, source.dynamics, index).text, timing: null, segmentId, todoKey: todoKey(item) });
  });
  for (const { connection } of applyConnectionEdits(saved.data.result.connections ?? [], saved.data.connectionEdits ?? [])) {
    const segment = segmentsById.get(connection.speakerSegmentId);
    if (!segment || segment.meetingId !== meeting.id) continue;
    connections.push({
      ...base, kind: connection.kind, name: connection.name, company: connection.company, title: connection.title,
      relationship: connectionRelationshipLabels[connection.relationship], context: connection.context,
      segmentId: connection.speakerSegmentId,
    });
  }
  return { todos, dynamics, connections };
}

export type MergeCandidate = { id: string; name: string; emails: string[]; meetingCount: number; likely: boolean };

/** Other active people in the workspace, likely duplicates first. */
export async function listMergeCandidates(workspace: WorkspaceContext, personId: string): Promise<MergeCandidate[]> {
  const people = await rows<{ id: string; name: string; emails: string[] | null; names: string[] | null; meetingCount: number | string }>(sql`
    select p.id, p.preferred_name as name,
      (select array_agg(e.email order by e.email) from person_emails e where e.person_id = p.id) as emails,
      (select array_agg(n.name) from person_names n where n.person_id = p.id) as names,
      (select count(distinct g.meeting_id) from meeting_speakers g where g.person_id = p.id) as "meetingCount"
    from workspace_people p
    where p.team_id = ${workspace.teamId} and p.merged_into_id is null
    order by p.preferred_name, p.id
    limit 2000`);
  const self = people.find(person => person.id === personId);
  if (!self) return [];
  const selfKeys = identityKeys(self.name, self.names ?? [], self.emails ?? []);
  return people.filter(person => person.id !== personId).map(person => {
    const keys = identityKeys(person.name, person.names ?? [], person.emails ?? []);
    return {
      id: person.id, name: person.name, emails: person.emails ?? [], meetingCount: Number(person.meetingCount),
      likely: [...keys].some(key => selfKeys.has(key)),
    };
  }).sort((a, b) => Number(b.likely) - Number(a.likely) || b.meetingCount - a.meetingCount || a.name.localeCompare(b.name));
}

/**
 * Keys two records of the same human tend to share: full name, first name plus
 * last initial, an email's name part, and a lone first name only against
 * another lone first name or a full name with that first name.
 */
export function identityKeys(name: string, names: string[], emails: string[]) {
  const keys = new Set<string>();
  for (const label of [name, ...names, ...emails.map(email => email.split("@")[0] ?? "")]) {
    const key = personNameKey(label);
    if (!key) continue;
    const words = key.split(" ");
    keys.add(`full:${words.join("")}`);
    keys.add(`first:${words[0]}`);
    if (words.length > 1) keys.add(`initial:${words[0]}${words.at(-1)![0]}`);
  }
  return keys;
}

export async function mergePeople(personId: string, sourceIds: string[], keepName: string | null) {
  await db.execute(sql`select app_private.merge_people(${personId}::uuid, ${`{${sourceIds.join(",")}}`}::uuid[], ${keepName})`);
}

export async function unmergePeople(personId: string) {
  const result = await db.execute(sql`select app_private.unmerge_people(${personId}::uuid) as result`);
  return (result.rows[0] as { result: { restored: string[] } }).result;
}

export async function openSpeakerPerson(meetingId: string, meetingSpeakerId: string) {
  const result = await db.execute(sql`select app_private.open_speaker_person(${meetingId}::uuid, ${meetingSpeakerId}::uuid) as id`);
  return (result.rows[0] as { id: string }).id;
}

export async function openParticipantPerson(meetingId: string, email: string, name: string | null) {
  const result = await db.execute(sql`select app_private.open_participant_person(${meetingId}::uuid, ${email}, ${name}) as id`);
  return (result.rows[0] as { id: string }).id;
}

/** Existing people for a meeting's participant emails, for linking without side effects. */
export async function findPeopleByEmail(teamId: string, emails: string[]) {
  if (!emails.length) return new Map<string, string>();
  const found = await rows<{ email: string; personId: string }>(sql`
    select distinct on (e.email) e.email, p.id as "personId"
    from person_emails e join workspace_people p on p.id = e.person_id and p.merged_into_id is null
    where e.team_id = ${teamId} and e.email in (select lower(jsonb_array_elements_text(${JSON.stringify(emails)}::jsonb)))
    order by e.email, e.confirmed_at, p.id`);
  return new Map(found.map(row => [row.email, row.personId]));
}

/** Only members of the meeting's workspace can open its people. */
export async function isMeetingWorkspaceMember(meetingId: string) {
  const result = await db.execute(sql`select app_private.is_workspace_member(team_id) as member from meetings where id = ${meetingId}`);
  return Boolean((result.rows[0] as { member?: boolean } | undefined)?.member);
}

/** The workspace a person belongs to, when the viewer can see them. */
export async function findPersonTeam(personId: string) {
  if (!uuidSchema.safeParse(personId).success) return null;
  const [row] = await rows<{ teamId: string }>(sql`select team_id as "teamId" from workspace_people where id = ${personId}`);
  return row?.teamId ?? null;
}

/**
 * Opens the person's own workspace so links from any of the viewer's teams
 * work. Falls back to the viewer's current workspace, where the person is
 * then simply not found.
 */
export async function getPersonWorkspace(user: SessionUser, personId: string) {
  const teamId = await findPersonTeam(personId);
  if (teamId) {
    try { return await getOrCreateWorkspaceForSessionUser(user, { teamId }); } catch { /* not selectable */ }
  }
  return getOrCreateWorkspaceForSessionUser(user);
}

export function personDatabaseError(error: unknown): Response | null {
  const cause = error as { code?: string; cause?: { code?: string; message?: string }; message?: string };
  const code = cause?.code ?? cause?.cause?.code;
  const message = cause?.cause?.message ?? cause?.message ?? "";
  if (code === "42501") return Response.json({ error: "Not found" }, { status: 404 });
  if (code === "40001") return Response.json({ error: "This speaker changed. Refresh the page and try again." }, { status: 409 });
  if (code === "22023") return Response.json({ error: message.replace(/^error:\s*/i, "") || "That change is not allowed." }, { status: 400 });
  return null;
}
