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
  source: { text: string; url?: string }, maxCharacters = 400_000,
  report?: { trimmed: string[]; skipped: string[] }) {
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
  type Context = (typeof context)[number];
  // The selected input travels in full with every batch.
  const required = new Set(selectedPeople.flatMap(p => p.meetingIds));
  for (const item of selectedIntel) for (const e of item.evidence) required.add(e.meetingId);
  const size = (value: unknown) => JSON.stringify(value).length;
  function assemble(people: typeof candidates, meetings: Context[]) {
    return { input, source, people, selectedPeople, intel: selectedIntel, meetings };
  }
  function batch(people: typeof candidates) {
    const ids = new Set([...people.flatMap(p => p.meetingIds), ...required]);
    return assemble(people, context.filter(m => ids.has(m.id)));
  }
  if (size(batch([])) > maxCharacters)
    throw new IntelInputError("This person's meeting history is too large for one search. Try another person or idea.");
  // A participant in many long meetings, such as a recurring host, cannot fit with
  // full transcripts. Keep their own turns with one neighbouring turn on each side,
  // adding meetings newest first and stopping at the first that does not fit, so a
  // recent reversal is never dropped while an older request survives.
  function focusedBatch(person: (typeof candidates)[number]) {
    const own = new Set(person.segmentIds);
    const focused = new Map<string, Context>();
    for (const m of context) {
      if (!person.meetingIds.includes(m.id) || required.has(m.id)) continue;
      const keep = m.segments.map(s => own.has(s.id));
      const segments = m.segments.filter((_, i) => keep[i] || keep[i - 1] || keep[i + 1]);
      if (segments.length) focused.set(m.id, { ...m, segments });
    }
    const build = (kept: Set<string>) => assemble([person],
      context.flatMap(m => required.has(m.id) ? [m] : kept.has(m.id) ? [focused.get(m.id)!] : []));
    const kept = new Set<string>();
    for (const m of [...focused.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))) {
      kept.add(m.id);
      if (size(build(kept)) > maxCharacters) { kept.delete(m.id); break; }
    }
    return kept.size || person.meetingIds.some(id => required.has(id)) ? build(kept) : null;
  }
  const batches: ReturnType<typeof batch>[] = [];
  let people: typeof candidates = [];
  for (const person of candidates) {
    if (size(batch([person])) > maxCharacters) {
      const focused = focusedBatch(person);
      if (focused) { batches.push(focused); report?.trimmed.push(person.id); }
      else report?.skipped.push(person.id);
      continue;
    }
    if (people.length && (people.length === 12 || size(batch([...people, person])) > maxCharacters)) {
      batches.push(batch(people)); people = [];
    }
    people.push(person);
  }
  if (people.length) batches.push(batch(people));
  return batches;
}
