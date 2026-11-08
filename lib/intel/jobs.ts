import { createHash } from "node:crypto";
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { intelSearches as jobs, providerUsageEvents } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { ProviderCreditExhaustedError } from "@/lib/provider-credit";
import type { WorkspaceContext } from "@/lib/workspace";
import { IntelInputError } from "./content";
import { browserCatalog, buildCatalog, buildMatchingContext } from "./provenance";
import { estimateSearchCost, pricingFromUsage, type SearchEstimate } from "./cost";
import { assertWorkspaceHasProviderCredit } from "@/lib/provider-credit";
import { corpusSnapshot, finalizeIntelSearch, matchBatch, prepareIntelSearch, searchIntel } from "./search";
import { INTEL_SEARCH_PARALLEL_BATCHES } from "./limits";
import { loadIntelMeetings } from "./store";
import { searchInputSchema, type IntelMeeting, type Match, type SearchInput, type SearchResult } from "./types";

function owner(w: WorkspaceContext) {
  return and(eq(jobs.teamId, w.teamId), eq(jobs.userId, w.userId));
}
type Preview = {
  estimate: SearchEstimate;
  linkSource?: { text: string; url: string };
  startedAt?: string;
  partial?: Match[];
  batchesDone?: number;
  actualUsd?: number;
  stage?: "finalizing";
};

// Per-token prices from this team's recent tagged Intel calls; the static
// calibration applies until enough history exists.
async function intelPricing(w: WorkspaceContext) {
  const rows = await db.select({ costUsdMicros: providerUsageEvents.costUsdMicros, quantity: providerUsageEvents.quantity }).from(providerUsageEvents)
    .where(and(eq(providerUsageEvents.teamId, w.teamId), eq(providerUsageEvents.operation, "decisions"),
      sql`${providerUsageEvents.metadata} ? 'intelSearchId'`, gt(providerUsageEvents.occurredAt, sql`now() - interval '30 days'`)))
    .orderBy(desc(providerUsageEvents.occurredAt)).limit(200);
  return pricingFromUsage(rows);
}

async function actualCost(w: WorkspaceContext, id: string) {
  const [row] = await db.select({ micros: sql<string | null>`sum(${providerUsageEvents.costUsdMicros})` }).from(providerUsageEvents)
    .where(and(eq(providerUsageEvents.teamId, w.teamId), sql`${providerUsageEvents.metadata}->>'intelSearchId' = ${id}`));
  return Number(row?.micros ?? 0) / 1_000_000;
}

export async function previewIntelSearch(w: WorkspaceContext, input: SearchInput) {
  const corpus = await loadIntelMeetings(w);
  const { source, batches } = await prepareIntelSearch(input, corpus);
  const estimate = estimateSearchCost(batches, await intelPricing(w));
  const preview: Preview = { estimate };
  if ("url" in source && typeof source.url === "string") preview.linkSource = { text: source.text, url: source.url };
  await db.delete(jobs).where(and(owner(w), eq(jobs.status, "preview"), sql`${jobs.createdAt} < now() - interval '1 hour'`));
  const [row] = await db.insert(jobs).values({ teamId: w.teamId, userId: w.userId, input, status: "preview", result: preview }).returning({ id: jobs.id });
  return { id: row.id, estimate };
}

export async function enqueueIntelSearch(w: WorkspaceContext, input: SearchInput, previewId?: string) {
  let row: { id: string };
  if (previewId) {
    const [claimed] = await db.update(jobs).set({ status: "queued" }).where(and(owner(w), eq(jobs.id, previewId), eq(jobs.input, input),
      eq(jobs.status, "preview"), sql`${jobs.createdAt} >= now() - interval '1 hour'`)).returning({ id: jobs.id });
    if (!claimed) throw new IntelInputError("This estimate has expired or was already used. Get a new estimate.");
    row = claimed;
  } else {
    // Older clients submit directly, without previewing the price.
    [row] = await db.insert(jobs).values({ teamId: w.teamId, userId: w.userId, input, status: "queued" }).returning({ id: jobs.id });
  }
  try {
    await inngest.send({ id: row.id, name: "intel/search.requested", data: { id: row.id, teamId: w.teamId, userId: w.userId } });
  } catch (error) {
    await db.update(jobs).set({ status: "failed", error: "Could not queue this search. Please try again." }).where(and(owner(w), eq(jobs.id, row.id), eq(jobs.status, "queued")));
    throw error;
  }
  return row;
}

// A saved explanation can reference evidence beyond the passages shown. Recheck
// the matching context, including selected intel, before returning any saved text.
function fingerprint(corpus: IntelMeeting[], catalog: ReturnType<typeof buildCatalog>, input: SearchInput, result: SearchResult) {
  const ids = new Set([...(input.kind === "intel" ? [input.id] : []), ...result.matches.map(m => m.id)]);
  return createHash("sha256").update(JSON.stringify([catalog.people, catalog.intel.filter(i => ids.has(i.id)), buildMatchingContext(corpus, catalog.people), corpus.map(m => [m.id, m.notes ?? null, m.aiFollowup])])).digest("hex");
}
export async function executeIntelSearch(w: WorkspaceContext, id: string) {
  const scope = and(owner(w), eq(jobs.id, id));
  const [row] = await db.select({ input: jobs.input, status: jobs.status, result: jobs.result }).from(jobs).where(scope);
  if (!row || !["queued", "running"].includes(row.status ?? "")) return;
  const input = searchInputSchema.parse(row.input);
  await db.update(jobs).set({ status: "running", completed: 0, total: 0 }).where(scope);
  try {
    const corpus = await loadIntelMeetings(w);
    const preview = row.result as Preview | null;
    const plan = await prepareIntelSearch(input, corpus, preview?.linkSource);
    const estimate = preview?.estimate ?? estimateSearchCost(plan.batches);
    if (!preview?.estimate) await db.update(jobs).set({ result: { estimate } }).where(scope);
    const { catalog, ...result } = await searchIntel(w, input, corpus, async (completed, total) => {
      await db.update(jobs).set({ completed: sql`greatest(${jobs.completed}, ${completed})`, total }).where(scope);
    }, plan, id);
    await db.update(jobs).set({ status: "complete", result: { ...result, estimate, actualUsd: await actualCost(w, id), fingerprint: fingerprint(corpus, catalog, input, result) } }).where(scope);
  } catch (error) {
    await db.update(jobs).set({ status: "failed", error: error instanceof IntelInputError || error instanceof ProviderCreditExhaustedError ? error.message : "Could not complete this search. Please try again." }).where(scope);
  }
  await db.delete(jobs).where(and(owner(w), sql`${jobs.id} in (select id from intel_searches where team_id = ${w.teamId} and user_id = ${w.userId} and (status is null or status in ('complete','failed')) order by created_at desc offset 50)`));
}
export async function readIntelJob(w: WorkspaceContext, id?: string) {
  const [row] = await db.select().from(jobs).where(and(owner(w), isNotNull(jobs.status), sql`${jobs.status} <> 'preview'`, id ? eq(jobs.id, id) : undefined)).orderBy(desc(jobs.createdAt)).limit(1);
  if (!row) return null;
  const { id: jobId, status, input, completed, total, error, createdAt, result: stored } = row;
  const saved = stored as Preview | null;
  const job = { id: jobId, status, input, completed, total, error, createdAt, estimate: saved?.estimate, startedAt: saved?.startedAt,
    batchesDone: saved?.batchesDone ?? 0, stage: saved?.stage, actualUsd: saved?.actualUsd };
  if (job.status !== "complete") return { ...job, partial: status === "complete" ? undefined : saved?.partial ?? [] };
  let corpus: IntelMeeting[];
  try { corpus = await loadIntelMeetings(w); }
  catch (error) {
    if (error instanceof IntelInputError) return { ...job, status: "failed", error: error.message };
    throw error;
  }
  const catalog = buildCatalog(corpus);
  const { fingerprint: digest, ...result } = stored as SearchResult & { fingerprint: string };
  if (digest !== fingerprint(corpus, catalog, searchInputSchema.parse(row.input), result)) {
    return { ...job, status: "failed", error: "Meeting access or content changed. Run this search again for current matches." };
  }
  return { ...job, result: { ...result, catalog: browserCatalog(catalog) } };
}

export async function markIntelJobInterrupted(w: WorkspaceContext, id: string, error = "Your search was interrupted. Please try again.") {
  const [row] = await db.update(jobs).set({ status: "failed", error })
    .where(and(owner(w), eq(jobs.id, id), sql`${jobs.status} in ('queued','running')`)).returning({ id: jobs.id });
  return !!row;
}

// Step functions for the durable Inngest run. Each one finishes well inside
// the platform's HTTP request limit, and completed steps are not repeated on retry.
function userMessage(error: unknown) {
  return error instanceof IntelInputError || error instanceof ProviderCreditExhaustedError ? error.message : null;
}
async function stepScope(w: WorkspaceContext, id: string) {
  const scope = and(owner(w), eq(jobs.id, id));
  const [row] = await db.select({ input: jobs.input, status: jobs.status, result: jobs.result }).from(jobs).where(scope);
  return { scope, row, active: !!row && ["queued", "running"].includes(row.status ?? "") };
}
async function loadPlan(w: WorkspaceContext, input: SearchInput, preview: Preview | null) {
  const corpus = await loadIntelMeetings(w);
  return { corpus, plan: await prepareIntelSearch(input, corpus, preview?.linkSource) };
}
export class IntelStepStopped extends Error {}
export async function failIntelJob(w: WorkspaceContext, id: string, error: unknown) {
  const message = userMessage(error);
  if (message) await markIntelJobInterrupted(w, id, message);
  return !!message;
}

// The whole search in one pass: load and plan the archive once, score batches in
// parallel while publishing each batch's candidates, then recheck access against
// one fresh load. Scoring calls take seconds, so per-batch durable steps that each
// reloaded the archive cost far more than the scoring itself.
export async function runIntelJob(w: WorkspaceContext, id: string) {
  const { scope, row, active } = await stepScope(w, id);
  if (!active) return;
  const input = searchInputSchema.parse(row!.input);
  const preview = row!.result as Preview | null;
  const { corpus, plan } = await loadPlan(w, input, preview);
  const estimate = preview?.estimate ?? estimateSearchCost(plan.batches, await intelPricing(w));
  const linkSource = preview?.linkSource ?? ("url" in plan.source && typeof plan.source.url === "string" ? { text: plan.source.text, url: plan.source.url } : undefined);
  const started: Preview = { estimate, linkSource, startedAt: new Date().toISOString(), partial: [], batchesDone: 0 };
  await db.update(jobs).set({ status: "running", completed: 0, total: plan.batches.length, result: started }).where(scope);
  if (plan.batches.length) await assertWorkspaceHasProviderCredit(w);
  const snapshot = corpusSnapshot(corpus);
  const scoreScope = { meetingId: corpus[0]?.id ?? "", searchId: id };
  const candidates: Match[][] = new Array(plan.batches.length);
  let nextBatch = 0;
  let stopped = false;
  async function worker() {
    while (!stopped && nextBatch < plan.batches.length) {
      const index = nextBatch++;
      const matched = await matchBatch(input, plan.batches[index], corpus, scoreScope);
      candidates[index] = matched;
      // Publish scored candidates as each batch finishes. No acceptance threshold.
      const [still] = await db.update(jobs).set({
        completed: sql`least(${jobs.completed} + 1, ${jobs.total})`,
        result: sql`jsonb_set(jsonb_set(coalesce(${jobs.result}, '{}'::jsonb), '{partial}', coalesce(${jobs.result}->'partial', '[]'::jsonb) || ${JSON.stringify(matched)}::jsonb), '{batchesDone}', to_jsonb(coalesce((${jobs.result}->>'batchesDone')::int, 0) + 1))`,
      }).where(and(scope, eq(jobs.status, "running"))).returning({ id: jobs.id });
      // Stopped or failed elsewhere: make no further provider calls.
      if (!still) stopped = true;
    }
  }
  await Promise.all(Array.from({ length: Math.min(INTEL_SEARCH_PARALLEL_BATCHES, plan.batches.length) },
    () => worker().catch(error => { stopped = true; throw error; })));
  if (stopped) throw new IntelStepStopped();
  await finalizeIntelJob(w, id, candidates, snapshot, { source: plan.source, coverage: plan.coverage, preview: started });
}

export async function finalizeIntelJob(w: WorkspaceContext, id: string, candidates: Match[][], snapshot: string,
  known?: { source: SearchResult["source"]; coverage: string; preview: Preview }) {
  const { scope, row, active } = await stepScope(w, id);
  if (!active) return;
  const input = searchInputSchema.parse(row!.input);
  const preview = known?.preview ?? row!.result as Preview | null;
  await db.update(jobs).set({ result: sql`jsonb_set(coalesce(${jobs.result}, '{}'::jsonb), '{stage}', '"finalizing"'::jsonb)` }).where(scope);
  // One fresh load serves the access recheck and the saved fingerprint.
  const corpus = await loadIntelMeetings(w);
  const plan = known ?? await prepareIntelSearch(input, corpus, preview?.linkSource);
  const { matches, catalog } = candidates.length
    ? await finalizeIntelSearch(w, input, plan.source, candidates, snapshot, corpus)
    : { matches: [], catalog: buildCatalog(corpus) };
  const result: SearchResult = { matches, source: plan.source, coverage: plan.coverage };
  await db.update(jobs).set({ status: "complete", completed: sql`${jobs.total}`, result: {
    ...result, estimate: preview?.estimate, startedAt: preview?.startedAt, actualUsd: await actualCost(w, id), fingerprint: fingerprint(corpus, catalog, input, result),
  } }).where(and(scope, eq(jobs.status, "running")));
  await db.delete(jobs).where(and(owner(w), sql`${jobs.id} in (select id from intel_searches where team_id = ${w.teamId} and user_id = ${w.userId} and (status is null or status in ('complete','failed')) order by created_at desc offset 50)`));
}
