import { createHash } from "node:crypto";
import { z } from "zod";
import { buildRecentPeopleBatches } from "./search-batches";
import { INTEL_SEARCH_PARALLEL_BATCHES } from "./limits";
import type { WorkspaceContext } from "@/lib/workspace";
import { assertWorkspaceHasProviderCredit } from "@/lib/provider-credit";
import { scoreIntelBatch } from "./scoring";
import { JevRequestTooLargeError } from "./tokens";
import { buildCatalog, buildMatchingContext, segmentPersonId, validateMatches } from "./provenance";
import { loadIntelMeetings, resolveInputLabel } from "./store";
import { IntelInputError, resolveIntelContent } from "./content";
import { type IntelMeeting, type Match, type SearchInput } from "./types";

// Only emit the stage and a bounded failure category. Provider and validation
// errors may contain private search text or transcript passages.
async function searchStage<T>(stage: string, perform: () => Promise<T>) {
  try { return await perform(); }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    const kind = /token limit/i.test(message) ? "token_limit" : /timeout|timed out/i.test(message) ? "timeout"
      : error instanceof z.ZodError || error instanceof SyntaxError ? "invalid_response" : "failed";
    const { emitTelemetryLog } = await import("@/lib/telemetry/server");
    emitTelemetryLog({ eventName: "intel.search.failure", severity: "ERROR",
      error: new Error(`Intel search ${stage}: ${kind}`), attributes: { "operation.name": stage } });
    throw error;
  }
}

// The person searching is never a useful recipient of their own idea. Identify
// them by a speaker linked to their email, or an unlinked speaker with exactly
// their full name; other same-name identities stay separate as before.
export type IntelViewer = { email?: string | null; name?: string | null };
function viewerIdentities(corpus: IntelMeeting[], viewer?: IntelViewer | null) {
  const ids = new Set<string>();
  const email = viewer?.email?.trim().toLowerCase();
  const name = viewer?.name?.trim().replace(/\s+/g, " ").toLowerCase();
  if (email) ids.add(`email:${email}`);
  for (const meeting of corpus) for (const segment of meeting.segments) {
    const linked = email && segment.participantEmail?.trim().toLowerCase() === email;
    const named = name && name.includes(" ") && !segment.personId && segment.speaker?.trim().replace(/\s+/g, " ").toLowerCase() === name;
    if (linked || named) ids.add(segmentPersonId(meeting.id, segment));
  }
  return ids;
}

export async function prepareIntelSearch(input: SearchInput, corpus: IntelMeeting[], linkSource?: { text: string; url: string }, viewer?: IntelViewer | null) {
  const catalog = buildCatalog(corpus);
  const label = resolveInputLabel(input, corpus, catalog);
  if (!label) throw new IntelInputError("This selection is no longer available. Choose it again.");
  const source = input.kind === "content" ? linkSource ?? await resolveIntelContent(input.text) : { text: label };
  const since = new Date();
  const day = since.getUTCDate();
  since.setUTCDate(1); since.setUTCMonth(since.getUTCMonth() - 3);
  const lastDay = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + 1, 0)).getUTCDate();
  since.setUTCDate(Math.min(day, lastDay)); since.setUTCHours(0, 0, 0, 0);
  const recent = corpus.filter(m => new Date(m.date) >= since && new Date(m.date) <= new Date());
  const recentCatalog = buildCatalog(recent);
  // Keep selected older source material as input, never as an extra candidate.
  const required = input.kind === "person" ? catalog.people.filter(p => input.ids.includes(p.id)).flatMap(p => p.meetingIds)
    : input.kind === "intel" ? catalog.intel.find(i => i.id === input.id)?.evidence.map(e => e.meetingId) ?? [] : [];
  const context = corpus.filter(m => recent.includes(m) || required.includes(m.id));
  const selected = new Set(input.kind === "person" ? input.ids : []);
  const self = viewerIdentities(corpus, viewer);
  const candidateCatalog = { ...recentCatalog, intel: catalog.intel,
    people: [...recentCatalog.people.filter(p => selected.has(p.id) || !self.has(p.id)),
      ...catalog.people.filter(p => selected.has(p.id) && !recentCatalog.people.some(r => r.id === p.id))] };
  const report = { trimmed: [] as string[], skipped: [] as string[] };
  const batches = buildRecentPeopleBatches(context, candidateCatalog, input, source, undefined, report);
  const count = batches.reduce((n, b) => n + b.people.length, 0);
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  const limits = [
    report.trimmed.length ? `For ${people(report.trimmed.length)} with very long histories, only their own statements from their most recent meetings were read.` : "",
    report.skipped.length ? `${people(report.skipped.length)} could not be ranked because a single recent meeting was too long.` : "",
  ].filter(Boolean).join(" ");
  const coverage = `Ranked ${count} participant identities from ${recent.length} accessible meetings in the past three months. Full meeting notes and transcript background; no keyword filtering or acceptance cutoff. Unconfirmed same-name identities remain separate.${limits ? ` ${limits}` : ""}`;
  return { catalog, coverage, batches, source };
}

type UsageScope = { meetingId: string; searchId?: string };
type Batch = Awaited<ReturnType<typeof prepareIntelSearch>>["batches"][number];

// Fingerprint of the people and transcript evidence a search reads. Intel ids
// are content hashes, so a changed intel record already gets a new id.
export function corpusSnapshot(corpus: IntelMeeting[]) {
  const catalog = buildCatalog(corpus);
  return createHash("sha256").update(JSON.stringify([catalog.people, buildMatchingContext(corpus, catalog.people), corpus.map(m => [m.id, m.notes ?? null, m.aiFollowup])])).digest("hex");
}

// Keep only the meetings these people, and the selected input, need.
function narrowBatch(batch: Batch, people: Batch["people"]): Batch {
  const ids = new Set([...people, ...batch.selectedPeople].flatMap(p => p.meetingIds));
  for (const item of batch.intel) for (const e of item.evidence) ids.add(e.meetingId);
  return { ...batch, people, meetings: batch.meetings.filter(m => ids.has(m.id)) };
}

// Batches are sized from an estimate. If Jev still refuses one for its size,
// score halves; a single person keeps their newest meetings. A person who cannot
// fit even then is skipped and reported, so one oversized request never fails
// the whole search.
async function scoreWithinLimits(batch: Batch, scope: UsageScope): Promise<{ matches: Awaited<ReturnType<typeof scoreIntelBatch>>["matches"]; skipped: string[] }> {
  try { return { ...(await scoreIntelBatch(batch, scope)), skipped: [] }; }
  catch (error) {
    if (!(error instanceof JevRequestTooLargeError)) throw error;
    if (batch.people.length > 1) {
      const half = Math.ceil(batch.people.length / 2);
      const parts = await Promise.all([batch.people.slice(0, half), batch.people.slice(half)]
        .map(people => scoreWithinLimits(narrowBatch(batch, people), scope)));
      return { matches: parts.flatMap(p => p.matches), skipped: parts.flatMap(p => p.skipped) };
    }
    const required = new Set(narrowBatch(batch, []).meetings.map(m => m.id));
    const own = batch.meetings.filter(m => !required.has(m.id)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    if (own.length > 1) {
      const keep = new Set(own.slice(0, Math.ceil(own.length / 2)).map(m => m.id));
      return scoreWithinLimits({ ...batch, meetings: batch.meetings.filter(m => required.has(m.id) || keep.has(m.id)) }, scope);
    }
    const { emitTelemetryLog } = await import("@/lib/telemetry/server");
    emitTelemetryLog({ eventName: "intel.search.candidate_skipped", severity: "WARN",
      error: new Error("Intel candidate exceeds the Jev request limit"), attributes: { "operation.name": "matching" } });
    return { matches: [], skipped: batch.people.map(p => p.id) };
  }
}

export async function matchBatch(input: SearchInput, batch: Batch, corpus: IntelMeeting[], scope: UsageScope): Promise<Match[]> {
  const matches: Match[] = [];
  let remaining = batch.people;
  const batchMeetings = new Set(batch.meetings.map(m => m.id));
  const batchCorpus = corpus.filter(m => batchMeetings.has(m.id));
  for (let attempt = 0; attempt < 2 && remaining.length; attempt++) {
    const expected = new Set(remaining.map(p => p.id));
    const parsed = await searchStage("matching", () => scoreWithinLimits({ ...batch, people: remaining }, scope));
    if (new Set(parsed.matches.map(m => m.id)).size !== parsed.matches.length
      || parsed.matches.some(m => m.type !== "person" || !expected.has(m.id)))
      throw new Error("Invalid candidate scores. Please retry the search.");
    matches.push(...validateMatches({ matches: parsed.matches }, input, batchCorpus));
    const scored = new Set(matches.map(m => m.id));
    remaining = remaining.filter(p => !scored.has(p.id) && !parsed.skipped.includes(p.id));
  }
  if (remaining.length) throw new Error("Incomplete candidate scores. Please retry the search.");
  return matches;
}

export async function finalizeIntelSearch(workspace: WorkspaceContext, input: SearchInput, source: { text: string; url?: string }, candidates: Match[][], snapshot: string, freshCorpus?: IntelMeeting[]) {
  const ranked = [...new Map(candidates.flat().map(m => [m.id, m])).values()]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.id.localeCompare(b.id));
  const parsed = { matches: ranked.map(({ id, type, score, relevance, reason, caveat, segmentIds, counterEvidenceIds }) =>
    ({ id, type, score, relevance, reason, caveat, segmentIds, counterEvidenceIds })) };
  // Recheck access, replacement transcripts and identities after the provider calls.
  const fresh = freshCorpus ?? await loadIntelMeetings(workspace);
  const freshCatalog = buildCatalog(fresh);
  const referenced = ranked.filter(match => match.type === "intel").map(match => match.id);
  if (corpusSnapshot(fresh) !== snapshot || (input.kind === "intel" && !freshCatalog.intel.some(i => i.id === input.id))
    || referenced.some(id => !freshCatalog.intel.some(i => i.id === id))) {
    throw new IntelInputError("Meeting access or content changed during this search. Please try again.");
  }
  return { matches: validateMatches(parsed, input, fresh), catalog: freshCatalog };
}

export async function searchIntel(workspace: WorkspaceContext, input: SearchInput, corpus: IntelMeeting[], onProgress?: (completed: number, total: number) => Promise<void>, plan?: Awaited<ReturnType<typeof prepareIntelSearch>>, searchId?: string) {
  const { catalog, coverage, batches, source } = plan ?? await prepareIntelSearch(input, corpus);
  if (!batches.length) return { matches: [], source, coverage, catalog };
  const snapshot = corpusSnapshot(corpus);
  const scope = { meetingId: corpus[0].id, searchId };
  await assertWorkspaceHasProviderCredit(workspace);
  const candidates: Match[][] = new Array(batches.length);
  let completed = 0;
  const totalSteps = batches.length;
  await onProgress?.(0, totalSteps);
  let nextBatch = 0;
  let failed = false;
  async function worker() {
    while (!failed && nextBatch < batches.length) {
      const index = nextBatch++;
      const validated = await matchBatch(input, batches[index], corpus, scope);
      await onProgress?.(++completed, totalSteps);
      candidates[index] = validated;
    }
  }
  await Promise.all(Array.from({ length: Math.min(INTEL_SEARCH_PARALLEL_BATCHES, batches.length) }, () => worker().catch(error => { failed = true; throw error; })));
  const { matches, catalog: freshCatalog } = await finalizeIntelSearch(workspace, input, source, candidates, snapshot);
  return { matches, source, coverage, catalog: freshCatalog };
}
