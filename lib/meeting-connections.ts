import { z } from "zod";
import type { FollowupSource } from "@/lib/meeting-followup";

export const connectionRelationshipLabels = {
  knows: "Knows",
  works_with: "Works with",
  met: "Met",
  offered_introduction: "Offered introduction",
  promised_introduction: "Promised introduction",
  requested_introduction: "Requested introduction",
  introduced: "Already introduced",
  in_discussion: "In discussion",
  reviewed: "Reviewed",
  invested: "Invested",
  mentioned: "Mentioned only",
} as const;

export const meetingConnectionSchema = z.strictObject({
  kind: z.enum(["person", "team", "project"]),
  name: z.string().trim().min(1).max(200).nullable(),
  company: z.string().trim().min(1).max(200).nullable(),
  title: z.string().trim().min(1).max(200).nullable(),
  mutual: z.boolean().optional(),
  relationship: z.enum(Object.keys(connectionRelationshipLabels) as [keyof typeof connectionRelationshipLabels, ...Array<keyof typeof connectionRelationshipLabels>]),
  context: z.string().trim().min(1).max(600),
  speakerSegmentId: z.string().min(1),
  evidence: z.array(z.strictObject({
    segmentId: z.string().min(1),
  })).min(1).max(4),
});
export const meetingConnectionsSchema = z.array(meetingConnectionSchema).max(80);

export type MeetingConnection = z.infer<typeof meetingConnectionsSchema>[number];

export function parseMeetingConnections(
  input: unknown,
  source: FollowupSource,
  { lenient = false, validateSpeakerLabels = true }: { lenient?: boolean; validateSpeakerLabels?: boolean } = {},
): MeetingConnection[] {
  const connections = meetingConnectionsSchema.parse(input);
  const segments = new Map(source.segments.map(segment => [segment.id, segment]));
  const speakers = new Set(source.segments.flatMap(segment => segment.speaker ? [segment.speaker] : []));
  return connections.filter(connection => {
    try {
      if (validateSpeakerLabels && [...speakers].some(speaker => connection.context.includes(speaker))) {
        throw new Error("Connection context must not repeat any transcript speaker names. Describe the contact and relationship without naming meeting participants; the UI supplies current names.");
      }
      if (!segments.has(connection.speakerSegmentId) ||
        !connection.evidence.some(evidence => evidence.segmentId === connection.speakerSegmentId)) {
        throw new Error("Connection speaker must reference a cited transcript segment");
      }
      for (const evidence of connection.evidence) {
        if (!segments.has(evidence.segmentId)) {
          throw new Error("Connection evidence must reference an existing transcript segment");
        }
      }
      return true;
    } catch (error) {
      if (!lenient) throw error;
      return false;
    }
  }).map(connection => {
    const evidenceText = connection.evidence.map(evidence => segments.get(evidence.segmentId)!.text).join("\n").toLowerCase();
    const supported = (value: string | null) => value && evidenceText.includes(value.toLowerCase()) ? value : null;
    return { ...connection, ...(connection.mutual ? { mutual: false } : {}), name: supported(connection.name), company: supported(connection.company), title: supported(connection.title) };
  });
}

// Segment IDs are globally unique, including within composed meetings.
export const SPEAKER_LABELS_CHANGED = "tape:speaker-labels-changed";
export type SpeakerLabelsChanged = Array<{ id: string; speaker: string | null; participantEmail?: string | null }>;


export const connectionChangesSchema = meetingConnectionSchema.omit({ evidence: true }).extend({ mutual: z.boolean() });
export type ConnectionChanges = z.infer<typeof connectionChangesSchema>;
export const connectionEditsSchema = z.array(z.strictObject({
  original: meetingConnectionSchema,
  changes: connectionChangesSchema,
})).max(80);
export type ConnectionEdit = z.infer<typeof connectionEditsSchema>[number];

// Match only a unique lead with the same identity and overlapping source evidence.
// Ambiguous unnamed leads keep their manual entry rather than overwriting a neighbour.
export function applyConnectionEdits(connections: MeetingConnection[], edits: ConnectionEdit[], source?: FollowupSource) {
  const speakers = new Map(source?.segments.map(segment => [segment.id, segment.speaker]) ?? []);
  const entries = connections.map(original => ({ original, connection: original }));
  const claimed = new Set<number>();
  for (const edit of edits) {
    const matches = entries.filter(({ original }, index) => !claimed.has(index) && original.kind === edit.original.kind &&
      original.name === edit.original.name && original.company === edit.original.company &&
      original.speakerSegmentId === edit.original.speakerSegmentId &&
      original.evidence.some(evidence => edit.original.evidence.some(other => other.segmentId === evidence.segmentId)));
    const exact = matches.find(({ original }) => JSON.stringify(original) === JSON.stringify(edit.original));
    const namedMatches = edit.original.name ? entries.filter(({ original }, index) => !claimed.has(index) &&
      original.kind === edit.original.kind && original.name === edit.original.name && original.company === edit.original.company &&
      original.evidence.some(evidence => edit.original.evidence.some(other => other.segmentId === evidence.segmentId)) &&
      speakers.get(original.speakerSegmentId) && speakers.get(original.speakerSegmentId) === speakers.get(edit.original.speakerSegmentId)) : [];
    const entry = exact ?? (matches.length === 1 ? matches[0] : namedMatches.length === 1 ? namedMatches[0] : undefined);
    const corrected = { original: edit.original, connection: { ...edit.original, ...edit.changes } };
    if (entry) {
      const index = entries.indexOf(entry);
      entries[index] = corrected;
      claimed.add(index);
    } else {
      claimed.add(entries.length);
      entries.push(corrected);
    }
  }
  return entries;
}

export function isOrganizationSpeaker(
  speaker: string | null,
  participants: Array<{ name: string | null; email: string }>,
  domains: string[],
) {
  if (!speaker) return false;
  const label = speaker.trim().toLowerCase();
  const emails = new Set(participants.filter(person => person.email.toLowerCase() === label || person.name?.trim().toLowerCase() === label).map(person => person.email.toLowerCase()));
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(label)) emails.add(label);
  if (emails.size !== 1) return false;
  const domain = [...emails][0].split("@")[1];
  return domains.some(own => own.toLowerCase() === domain);
}
