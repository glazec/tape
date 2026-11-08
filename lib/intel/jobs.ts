import { createHash } from "node:crypto";
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { intelSearches as jobs, providerUsageEvents, users } from "@/db/schema";
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

// The estimate request loads and plans the exact search that usually starts a few
// seconds later in this process under the same id. Reuse that work instead of
// loading the archive again. The saved result is still fingerprinted with this
// archive and compared with a fresh load before it is shown, so anything changed
// since the estimate is never displayed.
type PlannedSearch = { at: number; teamId: string; userId: string; corpus: IntelMeeting[]; plan: Awaited<ReturnType<typeof prepareIntelSearch>> };
const PLAN_REUSE_MS = 120_000;
const plannedSearches = new Map<string, PlannedSearch>();
function rememberPlan(id: string, planned: PlannedSearch) {
  for (const [key, value] of plannedSearches) if (Date.now() - value.at > PLAN_REUSE_MS) plannedSearches.delete(key);
  // Each entry holds an archive in memory; keep only the newest few.
  while (plannedSearches.size >= 4) plannedSearches.delete(plannedSearches.keys().next().value!);
  plannedSearches.set(id, planned);
}
function takePlan(w: WorkspaceContext, id: string) {
  const planned = plannedSearches.get(id);
  plannedSearches.delete(id);
  if (!planned || Date.now() - planned.at > PLAN_REUSE_MS || planned.teamId !== w.teamId || planned.userId !== w.userId) return null;
  return planned;
}

async function intelViewer(w: WorkspaceContext) {
  const [row] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, w.userId)).limit(1);
  return row ?? null;
}

export async function previewIntelSearch(w: WorkspaceContext, input: SearchInput) {
  const began = Date.now();
  const corpus = await loadIntelMeetings(w);
  const loadMs = Date.now() - began;
  const prepared = await prepareIntelSearch(input, corpus, undefined, await intelViewer(w));
  const { source, batches } = prepared;
  console.info("intel.preview.timing", JSON.stringify({ meetings: corpus.length, batches: batches.length, loadMs, planMs: Date.now() - began - loadMs }));
  const estimate = estimateSearchCost(batches, await intelPricing(w));
  const preview: Preview = { estimate };
  if ("url" in source && typeof source.url === "string") preview.linkSource = { text: source.text, url: source.url };
  await db.delete(jobs).where(and(owner(w), eq(jobs.status, "preview"), sql`${jobs.createdAt} < now() - interval '1 hour'`));
  const [row] = await db.insert(jobs).values({ teamId: w.teamId, userId: w.userId, input, status: "preview", result: preview }).returning({ id: jobs.id });
  rememberPlan(row.id, { at: Date.now(), teamId: w.teamId, userId: w.userId, corpus, plan: prepared });
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

function userMessage(error: unknown) {
  return error instanceof IntelInputError || error instanceof ProviderCreditExhaustedError ? error.message : null;
}
export class IntelStepStopped extends Error {}
export async function failIntelJob(w: WorkspaceContext, id: string, error: unknown) {
  const message = userMessage(error);
  if (message) await markIntelJobInterrupted(w, id, message);
  return !!message;
}

// A running job belongs to the runner that claimed it. Another runner may take it
// over only after this long without progress: longer than any single Jev call
// (180 seconds), so a live run is never duplicated.
const STALE_RUN_SECONDS = 200;
const heartbeat = sql`jsonb_set(coalesce(${jobs.result}, '{}'::jsonb), '{heartbeatAt}', to_jsonb(now()))`;

async function claimIntelJob(w: WorkspaceContext, id: string, takeover: boolean) {
  const stale = sql`(${jobs.status} = 'running' and coalesce((${jobs.result}->>'heartbeatAt')::timestamptz, ${jobs.createdAt}) < now() - make_interval(secs => ${STALE_RUN_SECONDS}))`;
  const [row] = await db.update(jobs).set({ status: "running", result: heartbeat })
    .where(and(owner(w), eq(jobs.id, id), takeover ? sql`(${jobs.status} = 'queued' or ${stale})` : eq(jobs.status, "queued")))
    .returning({ input: jobs.input, result: jobs.result });
  return row ?? null;
}
// Let another runner take over at once after an unexpected failure.
async function releaseIntelJob(w: WorkspaceContext, id: string) {
  await db.update(jobs).set({ result: sql`jsonb_set(coalesce(${jobs.result}, '{}'::jsonb), '{heartbeatAt}', to_jsonb('1970-01-01T00:00:00Z'::timestamptz))` })
    .where(and(owner(w), eq(jobs.id, id), eq(jobs.status, "running")));
}

// What a backup runner should do: nothing ("done"), keep waiting ("running"),
// or run the search ("claimable": never started, or its runner stopped responding).
export async function intelJobState(w: WorkspaceContext, id: string) {
  const [row] = await db.select({ status: jobs.status, claimable: sql<boolean>`(${jobs.status} = 'queued' or coalesce((${jobs.result}->>'heartbeatAt')::timestamptz, ${jobs.createdAt}) < now() - make_interval(secs => ${STALE_RUN_SECONDS}))` })
    .from(jobs).where(and(owner(w), eq(jobs.id, id)));
  if (!row || !["queued", "running"].includes(row.status ?? "")) return "done" as const;
  return row.claimable ? "claimable" as const : "running" as const;
}

// The whole search in one pass: load and plan the archive once, score batches in
// parallel while publishing each batch's candidates, then save the result with a
// fingerprint of the archive it read. Reading the result rechecks that fingerprint
// against a fresh load, so access or content changed at any point since the search
// started is never shown. Scoring calls take seconds, so loading the archive is the
// dominant cost and happens once.
export async function runIntelJob(w: WorkspaceContext, id: string, options: { takeover?: boolean } = {}) {
  const began = Date.now();
  const claimed = await claimIntelJob(w, id, options.takeover ?? false);
  if (!claimed) return false;
  const scope = and(owner(w), eq(jobs.id, id));
  // Phase durations only; no search text or meeting content.
  const timing: Record<string, number> = { claimMs: Date.now() - began };
  const mark = (name: string, since: number) => { timing[name] = Date.now() - since; return Date.now(); };
  try {
    const input = searchInputSchema.parse(claimed.input);
    const preview = claimed.result as Preview | null;
    let at = Date.now();
    const planned = takePlan(w, id);
    timing.reusedPlan = planned ? 1 : 0;
    const corpus = planned?.corpus ?? await loadIntelMeetings(w);
    at = mark("loadMs", at);
    const plan = planned?.plan ?? await prepareIntelSearch(input, corpus, preview?.linkSource, await intelViewer(w));
    at = mark("planMs", at);
    const estimate = preview?.estimate ?? estimateSearchCost(plan.batches, await intelPricing(w));
    const linkSource = preview?.linkSource ?? ("url" in plan.source && typeof plan.source.url === "string" ? { text: plan.source.text, url: plan.source.url } : undefined);
    const started: Preview = { estimate, linkSource, startedAt: new Date().toISOString(), partial: [], batchesDone: 0 };
    const [still] = await db.update(jobs).set({ completed: 0, total: plan.batches.length, result: sql`jsonb_set(${JSON.stringify(started)}::jsonb, '{heartbeatAt}', to_jsonb(now()))` })
      .where(and(scope, eq(jobs.status, "running"))).returning({ id: jobs.id });
    if (!still) throw new IntelStepStopped();
    if (plan.batches.length) await assertWorkspaceHasProviderCredit(w);
    at = mark("startMs", at);
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
        const [running] = await db.update(jobs).set({
          completed: sql`least(${jobs.completed} + 1, ${jobs.total})`,
          result: sql`jsonb_set(jsonb_set(jsonb_set(coalesce(${jobs.result}, '{}'::jsonb), '{partial}', coalesce(${jobs.result}->'partial', '[]'::jsonb) || ${JSON.stringify(matched)}::jsonb), '{batchesDone}', to_jsonb(coalesce((${jobs.result}->>'batchesDone')::int, 0) + 1)), '{heartbeatAt}', to_jsonb(now()))`,
        }).where(and(scope, eq(jobs.status, "running"))).returning({ id: jobs.id });
        // Stopped or failed elsewhere: make no further provider calls.
        if (!running) stopped = true;
      }
    }
    await Promise.all(Array.from({ length: Math.min(INTEL_SEARCH_PARALLEL_BATCHES, plan.batches.length) },
      () => worker().catch(error => { stopped = true; throw error; })));
    if (stopped) throw new IntelStepStopped();
    at = mark("scoreMs", at);
    await finalizeIntelJob(w, id, input, candidates, corpus, { source: plan.source, coverage: plan.coverage, preview: started });
    mark("finalizeMs", at);
    console.info("intel.search.timing", JSON.stringify({ searchId: id, meetings: corpus.length, batches: plan.batches.length, totalMs: Date.now() - began, ...timing }));
    return true;
  } catch (error) {
    if (!(error instanceof IntelStepStopped) && !userMessage(error)) await releaseIntelJob(w, id).catch(() => undefined);
    throw error;
  }
}

// Runs a search in this server process right after it is queued, avoiding the
// background queue's pickup delay. The durable Inngest run is the backup: it
// takes over a job this process never claimed or stopped advancing.
export async function runIntelJobNow(w: WorkspaceContext, id: string) {
  try { await runIntelJob(w, id); }
  catch (error) {
    if (error instanceof IntelStepStopped) return;
    if (await failIntelJob(w, id, error).catch(() => false)) return;
    console.error("Intel search will continue in the background worker", { searchId: id });
  }
}

async function finalizeIntelJob(w: WorkspaceContext, id: string, input: SearchInput, candidates: Match[][], corpus: IntelMeeting[],
  plan: { source: SearchResult["source"]; coverage: string; preview: Preview }) {
  const scope = and(owner(w), eq(jobs.id, id));
  const { matches, catalog } = candidates.length
    ? await finalizeIntelSearch(w, input, plan.source, candidates, corpusSnapshot(corpus), corpus)
    : { matches: [], catalog: buildCatalog(corpus) };
  const result: SearchResult = { matches, source: plan.source, coverage: plan.coverage };
  await db.update(jobs).set({ status: "complete", completed: sql`${jobs.total}`, result: {
    ...result, estimate: plan.preview.estimate, startedAt: plan.preview.startedAt, actualUsd: await actualCost(w, id), fingerprint: fingerprint(corpus, catalog, input, result),
  } }).where(and(scope, eq(jobs.status, "running")));
  await db.delete(jobs).where(and(owner(w), sql`${jobs.id} in (select id from intel_searches where team_id = ${w.teamId} and user_id = ${w.userId} and (status is null or status in ('complete','failed')) order by created_at desc offset 50)`));
}
