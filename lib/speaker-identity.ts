import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { withDatabaseWorkspace } from "@/db/rls-context";

export const speakerUpdateSchema = z.strictObject({
  segmentId: z.uuid().optional(),
  meetingSpeakerId: z.uuid().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  applyTo: z.enum(["matching_speaker", "segment"]).default("matching_speaker"),
  speaker: z.string().trim().min(1).max(80),
  currentSpeaker: z.string().trim().nullable().optional(),
  currentSpeakerAliases: z.array(z.string().max(80)).max(20).optional(),
  linkAction: z.enum(["preserve", "link", "create", "unlink"]).optional(),
  personId: z.uuid().optional(),
  participantEmail: z.email().max(254).optional(),
  preferredName: z.string().trim().min(1).max(80).optional(),
  rememberName: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (value.linkAction && (!value.segmentId || value.expectedRevision === undefined))
    ctx.addIssue({ code: "custom", message: "A current speaker revision and segment are required" });
  if (value.applyTo === "segment" && !value.segmentId)
    ctx.addIssue({ code: "custom", message: "Segment is required" });
  if (value.linkAction === "link" && !value.personId)
    ctx.addIssue({ code: "custom", message: "Select a person" });
  if (value.personId && value.linkAction !== "link")
    ctx.addIssue({ code: "custom", message: "Choose the link action to select a person" });
});
export type SpeakerUpdateInput = z.infer<typeof speakerUpdateSchema>;
export type SpeakerIdentitySegment = {
  id: string; meetingSpeakerId: string | null; personId: string | null;
  speaker: string | null; sourceSpeaker: string | null;
  participantEmail: string | null; speakerRevision: number;
};
export type SpeakerPerson = { id: string; name: string; emails: string[] };
export type SpeakerUpdateResult = { updated: true; segments: SpeakerIdentitySegment[]; person: SpeakerPerson | null };
export type SpeakerSuggestions = { people: Array<SpeakerPerson & { inMeeting: boolean }>; participants: Array<{name: string | null; email: string}> };

export async function mutateSpeakerIdentity(meetingId: string, input: SpeakerUpdateInput): Promise<SpeakerUpdateResult> {
  // Legacy remembering cannot create or infer a durable person association.
  const payload = { ...input };
  if (!input.linkAction) delete payload.participantEmail;
  const result = await db.execute(sql`select app_private.mutate_speaker(${meetingId}::uuid, ${JSON.stringify(payload)}::jsonb) as result`);
  return result.rows[0].result as SpeakerUpdateResult;
}
export async function getSpeakerSuggestions(meetingId: string): Promise<SpeakerSuggestions> {
  const result = await db.execute(sql`select app_private.speaker_people(${meetingId}::uuid) as result`);
  return result.rows[0].result as SpeakerSuggestions;
}
export async function attachSpeakerIdentities<T extends {id:string; speaker:string|null; meetingSpeakerId?:string|null}>(
  meetingId: string, segments: T[], options?: {includeEmails?:boolean; workspace?:{teamId:string;userId:string}},
): Promise<Array<T & {sourceSpeaker:string|null; personId:string|null; participantEmail:string|null; speakerRevision:number}>> {
  const identities = new Map<string, SpeakerIdentitySegment>();
  if (segments.some(segment => segment.meetingSpeakerId)) {
    const query = () => db.execute(sql`select * from app_private.speaker_display(${meetingId}::uuid, ${options?.includeEmails ?? false})`);
    const result = await (options?.workspace ? withDatabaseWorkspace(options.workspace, query) : query());
    for (const row of result.rows as SpeakerIdentitySegment[]) identities.set(row.id, row);
  }
  return segments.map(segment => {
    const identity = identities.get(segment.id);
    return { ...segment, sourceSpeaker: segment.speaker, personId: null, participantEmail: null, speakerRevision: 0, ...(identity ?? {}) };
  });
}
export function speakerIdentityError(error: unknown): Response | null {
  const cause = error as {code?:string; cause?:{code?:string}};
  const code = cause?.code ?? cause?.cause?.code;
  if (code === "40001") return Response.json({error:"This speaker changed. Refresh the transcript and try again."}, {status:409});
  if (code === "42501") return Response.json({error:"Meeting not found"}, {status:404});
  if (code === "22023" || code === "23514" || code === "22P02") return Response.json({error:"Select a valid workspace person or meeting participant."}, {status:400});
  return null;
}

export async function attachSpeakerIdentitiesForMeetings<
  S extends {id:string; speaker:string|null; meetingSpeakerId?:string|null},
  M extends {id:string;segments:S[]},
>(meetings: M[], workspace: {teamId:string;userId:string}) {
  const ids = meetings.filter(m => m.segments.some(s => s.meetingSpeakerId)).map(m => m.id);
  const identities = new Map<string,SpeakerIdentitySegment>();
  if (ids.length) {
    const result = await withDatabaseWorkspace(workspace, () => db.execute(sql`
      select d.* from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) m(id)
      cross join lateral app_private.speaker_display(m.id::uuid,false) d
    `));
    for (const row of result.rows as SpeakerIdentitySegment[]) identities.set(row.id,row);
  }
  return meetings.map(meeting => ({...meeting, segments: meeting.segments.map(segment => ({
    ...segment, sourceSpeaker: segment.speaker, personId: null as string|null,
    participantEmail: null as string|null, speakerRevision: 0, ...(identities.get(segment.id) ?? {}),
  }))}));
}
