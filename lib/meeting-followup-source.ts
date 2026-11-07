import { createHash } from "node:crypto";
import { z } from "zod";
import { applyConnectionEdits, connectionEditsSchema, parseMeetingConnections } from "@/lib/meeting-connections";

import {
  FOLLOWUP_PROMPT_VERSION,
  type FollowupSource,
  meetingFollowupSchema,
  parseMeetingFollowup,
} from "@/lib/meeting-followup";

type FollowupMeeting = FollowupSource & { followupSource?: FollowupSource };

export function getFollowupSource(meeting: FollowupMeeting): FollowupSource {
  // Display titles and team aliases may differ for a shared reader.
  const source = meeting.followupSource ?? meeting;
  return {
    title: source.title,
    startedAt: source.startedAt,
    ...attributionBinding(source),
    segments: source.segments.map(({ id, speaker, startMs, text, sourceSpeaker, meetingSpeakerId, personId, speakerRevision }) => ({
      id, speaker, startMs, text,
      ...(sourceSpeaker !== undefined ? { sourceSpeaker } : {}),
      ...(meetingSpeakerId ? { meetingSpeakerId } : {}),
      ...(personId ? { personId } : {}),
      ...(speakerRevision !== undefined ? { speakerRevision } : {}),
    })),
  };
}

// Omit the binding entirely at zero to preserve deployed hashes byte for byte.
export function attributionBinding(source: FollowupSource) {
  if (source.attributionRevisions?.some(item => item.revision > 0)) {
    return { attributionRevisions: [...source.attributionRevisions].sort((a, b) => a.meetingId.localeCompare(b.meetingId)) };
  }
  return source.attributionRevision ? { attributionRevision: source.attributionRevision } : {};
}

function canonicalSource(meeting: FollowupMeeting) {
  const source = getFollowupSource(meeting);
  return { title: source.title, startedAt: source.startedAt,
    segments: source.segments.map(({ id, speaker, sourceSpeaker, startMs, text }) => ({
      id, speaker: sourceSpeaker !== undefined ? sourceSpeaker : speaker, startMs, text,
    })), ...attributionBinding(source) };
}

// Renaming a meeting must not discard its followup, so hashes bind the
// transcript and date but not the title. Hashes saved before that change
// included the title; they stay valid until the title changes, and renames
// upgrade them (see upgradeFollowupHashesForRename).
export function getFollowupSourceHash(meeting: FollowupMeeting) {
  return hashSource(meeting, FOLLOWUP_PROMPT_VERSION);
}

function hashSource(meeting: FollowupMeeting, version: number) {
  const canonical = canonicalSource(meeting);
  const source = { startedAt: canonical.startedAt, segments: canonical.segments, ...attributionBinding(canonical) };
  return createHash("sha256")
    .update(JSON.stringify(["untitled", version, source]))
    .digest("hex");
}

function hashTitledSource(meeting: FollowupMeeting, version: number) {
  return createHash("sha256")
    .update(
      JSON.stringify([version, canonicalSource(meeting)]),
    )
    .digest("hex");
}

function getMatchingFollowupVersion(
  meeting: FollowupMeeting,
  saved: z.infer<typeof storedFollowupSchema>,
) {
  // Keep existing summaries visible until a manager chooses to regenerate.
  const legacy = !("research" in saved.result);
  const versions = legacy ? [1] : saved.result.connections === undefined ? [2, 3, 4, 5, FOLLOWUP_PROMPT_VERSION] : [4, 5, FOLLOWUP_PROMPT_VERSION];
  for (const version of versions) {
    if (saved.sourceHash === hashSource(meeting, version)) return { version, titled: false };
    if (saved.sourceHash === hashTitledSource(meeting, version)) return { version, titled: true };
  }
  return null;
}

export const storedFollowupSchema = z.strictObject({
  sourceHash: z.string(),
  speakerNames: z.record(z.string(), z.string().nullable()).optional(),
  translations: z.object({ en: meetingFollowupSchema.optional(), "zh-CN": meetingFollowupSchema.optional() }).optional(),
  connectionsSourceHash: z.string().optional(),
  connectionEdits: connectionEditsSchema.optional(),
  result: z.union([meetingFollowupSchema, meetingFollowupSchema.omit({ research: true })]),
});

export function getCurrentMeetingFollowup(
  meeting: FollowupMeeting & {
    aiFollowup?: unknown;
    status: string;
    transcriptJobStatus: string | null;
  },
) {
  if (!isFollowupReady(meeting)) return null;
  const saved = storedFollowupSchema.safeParse(meeting.aiFollowup);
  if (!saved.success) return null;
  if (!getMatchingFollowupVersion(meeting, saved.data)) return null;
  try {
    const source = getFollowupSource(meeting);
    const validationSource = { ...source, segments: source.segments.map(segment => ({ ...segment,
      speaker: saved.data.speakerNames && segment.id in saved.data.speakerNames
        ? saved.data.speakerNames[segment.id]
        : segment.sourceSpeaker !== undefined ? segment.sourceSpeaker : segment.speaker,
    })) };
    const result = parseMeetingFollowup(
      JSON.stringify({ research: [], ...saved.data.result }),
      validationSource,
    );
    resolveFollowupDisplayNames(result, source, validationSource);
    if (result.connections) result.connections = getCurrentMeetingConnections(meeting);
    return result;
  } catch {
    return null;
  }
}

// Only update the subject when cited segments bind the saved name to one identity.
// Ambiguous historical labels remain as saved rather than inventing an assignment.
export function resolveFollowupDisplayNames(
  result: z.infer<typeof meetingFollowupSchema>, source: FollowupSource, validationSource: FollowupSource,
) {
  const current = new Map(source.segments.map(segment => [segment.id, segment]));
  const previous = new Map(validationSource.segments.map(segment => [segment.id, segment]));
  for (const item of [...result.todos, ...result.dynamics]) {
    const candidates = item.evidence.flatMap(({ segmentId }) => {
      const segment = current.get(segmentId);
      return segment && (previous.get(segmentId)?.speaker || "Unknown speaker") === item.person ? [segment] : [];
    });
    const identities = new Set(candidates.map(segment => segment.personId ?? segment.meetingSpeakerId ?? segment.id));
    const names = new Set(candidates.map(segment => segment.speaker || "Unknown speaker"));
    if (identities.size !== 1 || names.size !== 1) continue;
    const name = [...names][0];
    if (name === item.person) continue;
    item.text = name + item.text.slice(item.person.length);
    item.person = name;
  }
  return result;
}

// Connections store their speaker's segment ID, so labels can change without
// rerunning the model. All content, membership and timestamps still bind the
// saved connections to the transcript and its access-filtered composition.
export function getConnectionsSourceHash(meeting: FollowupMeeting) {
  const { startedAt, segments } = getFollowupSource(meeting);
  return createHash("sha256").update(JSON.stringify([2, {
    startedAt,
    segments: segments.map(({ id, startMs, text }) => ({ id, startMs, text })),
    ...attributionBinding(getFollowupSource(meeting)),
  }])).digest("hex");
}

function getTitledConnectionsSourceHash(meeting: FollowupMeeting) {
  const source = canonicalSource(meeting);
  return createHash("sha256").update(JSON.stringify([1, {
    ...source,
    segments: source.segments.map(({ id, startMs, text }) => ({ id, startMs, text })),
  }])).digest("hex");
}

export function matchesConnectionsSourceHash(meeting: FollowupMeeting, hash: string | undefined) {
  return hash !== undefined &&
    (hash === getConnectionsSourceHash(meeting) || hash === getTitledConnectionsSourceHash(meeting));
}

/**
 * A saved followup whose hashes still include the old title, rewritten to the
 * title-free hashes so a rename keeps it. Null when nothing needs upgrading.
 */
export function upgradeFollowupHashesForRename(
  meeting: Parameters<typeof getCurrentMeetingFollowup>[0],
) {
  const saved = storedFollowupSchema.safeParse(meeting.aiFollowup);
  if (!saved.success) return null;
  const match = getMatchingFollowupVersion(meeting, saved.data);
  const titledConnections = saved.data.connectionsSourceHash !== undefined &&
    saved.data.connectionsSourceHash === getTitledConnectionsSourceHash(meeting);
  if (!match?.titled && !titledConnections) return null;
  return {
    ...saved.data,
    ...(match?.titled ? { sourceHash: hashSource(meeting, match.version) } : {}),
    ...(titledConnections ? { connectionsSourceHash: getConnectionsSourceHash(meeting) } : {}),
  };
}

export function getCurrentMeetingConnectionEntries(
  meeting: Parameters<typeof getCurrentMeetingFollowup>[0],
) {
  if (!isFollowupReady(meeting)) return [];
  const saved = storedFollowupSchema.safeParse(meeting.aiFollowup);
  if (!saved.success || !matchesConnectionsSourceHash(meeting, saved.data.connectionsSourceHash)) return [];
  try {
    const source = getFollowupSource(meeting);
    const connections = parseMeetingConnections(saved.data.result.connections ?? [], source, { validateSpeakerLabels: false });
    const segmentIds = new Set(source.segments.map(segment => segment.id));
    const edits = (saved.data.connectionEdits ?? []).filter(edit =>
      segmentIds.has(edit.changes.speakerSegmentId) && segmentIds.has(edit.original.speakerSegmentId) &&
      edit.original.evidence.every(evidence => segmentIds.has(evidence.segmentId)));
    return applyConnectionEdits(connections, edits, source);
  } catch {
    return [];
  }
}

export function isFollowupReady(
  meeting: FollowupSource & {
    status: string;
    transcriptJobStatus: string | null;
  },
) {
  return (
    meeting.status === "ready" &&
    meeting.segments.length > 0 &&
    (meeting.transcriptJobStatus === null ||
      meeting.transcriptJobStatus === "completed")
  );
}


export function getCurrentMeetingConnections(meeting: Parameters<typeof getCurrentMeetingFollowup>[0]) {
  return getCurrentMeetingConnectionEntries(meeting).map(entry => entry.connection);
}

export function getConnectionsRevision(meeting: FollowupMeeting & { aiFollowup?: unknown }) {
  // PostgreSQL JSONB reorders object keys. Schema parsing gives revisions the
  // same field order before saving, in the response and after database readback.
  const saved = storedFollowupSchema.safeParse(meeting.aiFollowup);
  const revisionData = saved.success ? { ...saved.data, translations: undefined } : null;
  return createHash("sha256").update(JSON.stringify([getConnectionsSourceHash(meeting), revisionData])).digest("hex");
}


export function getCurrentMeetingConnectionIds(meeting: Parameters<typeof getCurrentMeetingFollowup>[0]) {
  return getCurrentMeetingConnectionEntries(meeting).map(({ original }) =>
    createHash("sha256").update(JSON.stringify(original)).digest("hex"));
}

// Translations retain item order and exact evidence from the shared result.
// Match evidence rather than names, which can collide or change between copies.
export function resolveTranslatedFollowupSubjects(copy: z.infer<typeof meetingFollowupSchema>, current: z.infer<typeof meetingFollowupSchema>) {
  const result = structuredClone(copy);
  for (const key of ["todos", "dynamics"] as const) {
    for (const item of result[key]) {
      const matches = current[key].filter(candidate => JSON.stringify(candidate.evidence) === JSON.stringify(item.evidence));
      if (matches.length !== 1 || !item.text.startsWith(item.person)) continue;
      item.text = matches[0].person + item.text.slice(item.person.length);
      item.person = matches[0].person;
    }
  }
  return result;
}
