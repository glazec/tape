import { createHash } from "node:crypto";
import { getCurrentMeetingFollowup, getCurrentMeetingConnections, getCurrentMeetingConnectionIds } from "@/lib/meeting-followup-source";
import { intelExtractionSchema, rankingSchema, type IntelMeeting, type IntelCard, type Person, type Evidence, type SearchInput, type Match, type Segment } from "./types";

export function intelSourceHash(meeting: IntelMeeting) {
  // Preserve the original store projection and property order for existing hashes.
  const segments = meeting.segments.map(s => ({ id: s.id, speaker: s.sourceSpeaker !== undefined ? s.sourceSpeaker : s.speaker, text: s.text, startMs: s.startMs }));
  const source: unknown[] = [1, meeting.title, meeting.startedAt, segments];
  if (meeting.attributionRevision) source.push(["attribution", meeting.attributionRevision]);
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}
export function validateExtraction(value: unknown, meeting: IntelMeeting) {
  const result = intelExtractionSchema.parse(value);
  const segments = new Map(meeting.segments.map(s => [s.id, s]));
  for (const item of result.items) {
    if (!segments.get(item.speakerSegmentId)?.speaker || !item.segmentIds.includes(item.speakerSegmentId) || item.segmentIds.some(id => !segments.has(id))) {
      throw new Error("Intel contains unsupported attribution or evidence");
    }
  }
  return result;
}
export function currentIntel(meeting: IntelMeeting) {
  const stored = meeting.aiIntel as { sourceHash?: string; result?: unknown } | null;
  if (!stored || stored.sourceHash !== intelSourceHash(meeting)) return null;
  try { return validateExtraction(stored.result, meeting); } catch { return null; }
}
export function evidenceFor(meeting: IntelMeeting, segmentId: string): Evidence {
  const segment = meeting.segments.find(s => s.id === segmentId);
  if (!segment) throw new Error("Source passage unavailable");
  return { ...segment, meetingId: meeting.id, meetingTitle: meeting.title, date: meeting.date };
}
export function personId(meetingId: string, speaker: string) {
  const label = speaker.trim();
  // A name, calendar attendee, or inferred affiliation is never an identity binding.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(label)
    ? `email:${label.toLowerCase()}`
    : `speaker:${meetingId}:${createHash("sha256").update(label).digest("hex").slice(0, 20)}`;
}
export function segmentPersonId(meetingId: string, segment: Segment) {
  if (segment.personId) return `person:${segment.personId}`;
  if (segment.meetingSpeakerId) return `meeting-speaker:${segment.meetingSpeakerId}`;
  return personId(meetingId, segment.speaker ?? "");
}
export function buildCatalog(meetings: IntelMeeting[], now = new Date()) {
  const since = new Date(now); since.setMonth(since.getMonth() - 6);
  const sourceMeetings = new Map(meetings.flatMap(m => m.segments.map(s => [s.id, m] as const)));
  const people = new Map<string, Person>();
  const intel: IntelCard[] = [];
  for (const meeting of meetings) {
    for (const segment of meeting.segments) {
      if (!segment.speaker || /^(?:unknown(?:\s+speaker)?|speaker(?:[\s_-]*(?:\d+|[a-z]))?)$/i.test(segment.speaker.trim())) continue;
      const id = segmentPersonId(meeting.id, segment);
      let person = people.get(id);
      if (!person) {
        person = { id, name: segment.speaker, detail: meeting.title, kind: "participant", meetingIds: [], segmentIds: [], sourceDate: meeting.date, sourceMeetingId: meeting.id, sourceSegmentId: segment.id };
        people.set(id, person);
      }
      if (!person.meetingIds.includes(meeting.id)) person.meetingIds.push(meeting.id);
      person.segmentIds.push(segment.id);
    }
    const connectionIds = getCurrentMeetingConnectionIds(meeting);
    for (const [index, connection] of getCurrentMeetingConnections(meeting).entries()) {
      if (connection.kind !== "person") continue;
      const anchorMeeting = sourceMeetings.get(connection.speakerSegmentId) ?? meeting;
      const id = `contact:${anchorMeeting.id}:${createHash("sha256").update(JSON.stringify([connectionIds[index], connection])).digest("hex")}`;
      const evidenceMeetings = [...new Set(connection.evidence.flatMap(e => { const source = sourceMeetings.get(e.segmentId); return source ? [source.id] : []; }))];
      people.set(id, { id, name: connection.name ?? "Unnamed contact", detail: [connection.company, connection.title, connection.context].filter(Boolean).join(" · "), kind: "mentioned", relationship: connection.relationship, sourceDate: anchorMeeting.date, sourceMeetingId: anchorMeeting.id, sourceSegmentId: connection.speakerSegmentId, meetingIds: evidenceMeetings, segmentIds: connection.evidence.map(e => e.segmentId) });
    }
    const extracted = currentIntel(meeting);
    const sourceHash = extracted ? intelSourceHash(meeting) : "";
    if (new Date(meeting.date) >= since) {
      for (const item of extracted?.items ?? []) {
        intel.push({ ...item, id: `intel:${meeting.id}:${createHash("sha256").update(JSON.stringify([sourceHash, item])).digest("hex")}`, date: meeting.date,
          speaker: meeting.segments.find(s => s.id === item.speakerSegmentId)!.speaker!,
          evidence: item.segmentIds.map(id => evidenceFor(meeting, id)) });
      }
    }
  }
  return { intel: intel.sort((a,b) => b.date.localeCompare(a.date)), people: [...people.values()],
    pending: meetings.filter(m => new Date(m.date) >= since && !currentIntel(m)).length,
    coverage: `${meetings.length} accessible meetings. Intel from the past six months; searches rank participants from the past three months. Only confirmed person links combine speaker histories across meetings.` };
}

export function buildMatchingContext(meetings: IntelMeeting[], people: Person[], now = new Date()) {
  const since = new Date(now); since.setMonth(since.getMonth() - 6);
  const included = new Set(meetings.filter(m => new Date(m.date) >= since).map(m => m.id));
  for (const person of people) {
    const chronological = meetings.filter(m => person.meetingIds.includes(m.id)).sort((a,b) => a.date.localeCompare(b.date));
    if (chronological[0]) included.add(chronological[0].id);
    if (chronological.at(-1)) included.add(chronological.at(-1)!.id);
  }
  return meetings.filter(m => included.has(m.id)).map(m => ({
    id: m.id, title: m.title, date: m.date, segments: m.segments,
    ...(m.attributionRevision ? { attributionRevision: m.attributionRevision } : {}),
    dynamics: new Date(m.date) >= since ? getCurrentMeetingFollowup(m)?.dynamics ?? [] : [],
    connections: new Date(m.date) >= since ? getCurrentMeetingConnections(m) : [],
  }));
}

export function validateMatches(value: unknown, input: SearchInput, meetings: IntelMeeting[]): Match[] {
  const result = rankingSchema.parse(value);
  const catalog = buildCatalog(meetings);
  const evidence = new Map(meetings.flatMap(m => m.segments.map(s => [s.id, { ...s, meetingId: m.id, meetingTitle: m.title, date: m.date }] as const)));
  const seen = new Set<string>();
  return result.matches.map(match => {
    const target = match.type === "person" ? catalog.people.find(p => p.id === match.id) : catalog.intel.find(i => i.id === match.id);
    if (!target || seen.has(match.id) || (input.kind !== "person" && match.type !== "person")) throw new Error("Invalid matching target");
    if (input.kind === "intel") {
      const selectedIntel = catalog.intel.find(i => i.id === input.id);
      const anchor = selectedIntel?.evidence.find(s => s.id === selectedIntel.speakerSegmentId);
      if (anchor && match.id === segmentPersonId(anchor.meetingId, anchor)) throw new Error("Do not recommend the source speaker");
    }
    if (input.kind === "person" && input.ids.includes(match.id)) throw new Error("A person cannot match themselves");
    seen.add(match.id);
    const cited = [...match.segmentIds, ...match.counterEvidenceIds];
    if (cited.some(id => !evidence.has(id))) throw new Error("Unsupported match evidence");
    if (match.type === "person") {
      const person = target as Person;
      if (!match.segmentIds.some(id => person.segmentIds.includes(id))) throw new Error("Evidence does not support this person");
      if (person.kind === "mentioned" && match.relevance === "expressed_interest") throw new Error("A mentioned contact cannot directly express interest");
    } else if (!match.segmentIds.some(id => (target as IntelCard).segmentIds.includes(id))) {
      throw new Error("Evidence does not support this intel");
    }
    if (input.kind === "person") {
      const selected = catalog.people.filter(p => input.ids.includes(p.id));
      if (!match.segmentIds.some(id => selected.some(p => p.segmentIds.includes(id)))) throw new Error("Missing evidence for selected person");
    }
    return { ...match, title: "name" in target ? target.name : target.text,
      detail: "detail" in target ? target.detail : `${target.speaker} · ${target.kind}`,
      evidence: match.segmentIds.map(id => evidence.get(id)!), counterEvidence: match.counterEvidenceIds.map(id => evidence.get(id)!) };
  });
}

// Evidence membership is needed only on the server, not by the browsing UI.
export function browserCatalog(catalog: ReturnType<typeof buildCatalog>) {
  return { ...catalog, people: catalog.people.map(person => {
    const { segmentIds, ...visible } = person;
    void segmentIds;
    return visible;
  }) };
}
