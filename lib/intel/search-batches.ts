import { IntelInputError } from "./content";
import { getCurrentMeetingFollowup } from "@/lib/meeting-followup-source";
import { buildMatchingContext } from "./provenance";
import type { IntelCatalog, IntelMeeting, SearchInput } from "./types";

// Keep every meeting for an identity together so a later reversal is available
// both to matching and to the independent verifier.
export function buildSearchBatches(corpus: IntelMeeting[], catalog: IntelCatalog, input: SearchInput,
  source: { text: string; url?: string }, maxCharacters = 400_000) {
  const context = buildMatchingContext(corpus, catalog.people);
  const parent = new Map(context.map(m => [m.id, m.id]));
  function root(id: string): string {
    const next = parent.get(id);
    if (!next || next === id) return id;
    const result = root(next); parent.set(id, result); return result;
  }
  for (const person of catalog.people) {
    const ids = person.meetingIds.filter(id => parent.has(id));
    for (const id of ids.slice(1)) parent.set(root(id), root(ids[0]));
  }
  const groups = new Map<string, Set<string>>();
  for (const meeting of context) {
    const key = root(meeting.id);
    const group = groups.get(key) ?? new Set<string>();
    group.add(meeting.id); groups.set(key, group);
  }
  const selected = new Set<string>();
  if (input.kind === "person") {
    for (const person of catalog.people.filter(p => input.ids.includes(p.id)))
      for (const id of person.meetingIds) selected.add(root(id));
  } else if (input.kind === "intel") {
    for (const evidence of catalog.intel.find(i => i.id === input.id)?.evidence ?? []) selected.add(root(evidence.meetingId));
  }
  const required = new Set([...selected].flatMap(id => [...(groups.get(id) ?? [])]));
  function batch(ids: Set<string>) {
    return { input, source,
      // Membership distinguishes people who share a display name.
      people: catalog.people.filter(p => p.meetingIds.some(id => ids.has(id))),
      intel: catalog.intel.filter(i => i.evidence.every(e => ids.has(e.meetingId))),
      meetings: context.filter(m => ids.has(m.id)),
    };
  }
  const result: ReturnType<typeof batch>[] = [];
  let ids = new Set(required);
  for (const group of groups.values()) {
    const combined = new Set([...ids, ...group]);
    if (JSON.stringify(batch(combined)).length <= maxCharacters) { ids = combined; continue; }
    if (ids.size > required.size) result.push(batch(ids));
    ids = new Set([...required, ...group]);
    if (JSON.stringify(batch(ids)).length > maxCharacters)
      throw new IntelInputError("This person's meeting history is too large for one search. Try another person or idea.");
  }
  if (ids.size) result.push(batch(ids));
  return result;
}

// Verification needs the target's complete supplied history, not every other
// participant's transcript. Keep neighboring turns so short answers retain context.
export function buildVerificationContext(batch: ReturnType<typeof buildSearchBatches>[number],
  matches: Pick<import("./types").Match, "id" | "type" | "segmentIds" | "counterEvidenceIds">[]) {
  const peopleIds = new Set(matches.filter(m => m.type === "person").map(m => m.id));
  if (batch.input.kind === "person") for (const id of batch.input.ids) peopleIds.add(id);
  const intelIds = new Set(matches.filter(m => m.type === "intel").map(m => m.id));
  if (batch.input.kind === "intel") intelIds.add(batch.input.id);
  const intel = batch.intel.filter(i => intelIds.has(i.id));
  const cited = new Set([...matches.flatMap(m => [...m.segmentIds, ...m.counterEvidenceIds]), ...intel.flatMap(i => i.segmentIds)]);
  for (const item of intel) {
    const meeting = batch.meetings.find(m => m.segments.some(s => s.id === item.speakerSegmentId));
    const speaker = meeting?.segments.find(s => s.id === item.speakerSegmentId)?.speaker;
    for (const p of batch.people) {
      if (p.kind === "participant" && p.name === speaker && meeting && p.meetingIds.includes(meeting.id)) peopleIds.add(p.id);
    }
  }
  const people = batch.people.filter(p => peopleIds.has(p.id));
  const meetings = batch.meetings.flatMap(meeting => {
    const linked = people.filter(p => p.meetingIds.includes(meeting.id));
    // A mentioned contact's history can be described by any speaker.
    if (linked.some(p => p.kind === "mentioned")) return [meeting];
    const speakers = new Set(linked.map(p => p.name));
    const keep = meeting.segments.map(s => cited.has(s.id) || (s.speaker !== null && speakers.has(s.speaker)));
    const segments = meeting.segments.filter((_, index) => keep[index] || keep[index - 1] || keep[index + 1]);
    return segments.length ? [{ ...meeting, segments }] : [];
  });
  return { ...batch, people, intel, meetings };
}

// Every recent participant is a candidate. Batch by person, not connected meetings:
// a recurring host must not pull the entire archive into one oversized request.
export function buildRecentPeopleBatches(corpus: IntelMeeting[], catalog: IntelCatalog, input: SearchInput,
  source: { text: string; url?: string }, maxCharacters = 400_000) {
  const selectedPeople = input.kind === "person" ? catalog.people.filter(p => input.ids.includes(p.id)) : [];
  const selectedIntel = input.kind === "intel" ? catalog.intel.filter(i => i.id === input.id) : [];
  const sourceAnchor = selectedIntel[0]?.speakerSegmentId;
  const candidates = catalog.people.filter(p => p.kind === "participant" && !selectedPeople.some(s => s.id === p.id)
    && !(sourceAnchor && p.segmentIds.includes(sourceAnchor)));
  const context = corpus.map(m => {
    const followup = getCurrentMeetingFollowup(m);
    const notes = m.notes ?? null;
    // Notes may omit requests or later reversals. Preserve the transcript so
    // every candidate can be evaluated against the actual conversation.
    return { id: m.id, title: m.title, date: m.date, notes, followup, segments: m.segments };
  });
  function batch(people: typeof candidates) {
    const ids = new Set([...people, ...selectedPeople].flatMap(p => p.meetingIds));
    for (const item of selectedIntel) for (const e of item.evidence) ids.add(e.meetingId);
    return { input, source, people,
      selectedPeople, intel: selectedIntel, meetings: context.filter(m => ids.has(m.id)) };
  }
  const batches: ReturnType<typeof batch>[] = [];
  let people: typeof candidates = [];
  for (const person of candidates) {
    if (people.length && (people.length === 12 || JSON.stringify(batch([...people, person])).length > maxCharacters)) {
      batches.push(batch(people)); people = [];
    }
    people.push(person);
    if (JSON.stringify(batch(people)).length > maxCharacters)
      throw new IntelInputError("This person's meeting history is too large for one search. Try another person or idea.");
  }
  if (people.length) batches.push(batch(people));
  return batches;
}
