import { IntelInputError } from "./content";
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
