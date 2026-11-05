import { createHash } from "node:crypto";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { intelSearches as jobs } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { ProviderCreditExhaustedError } from "@/lib/provider-credit";
import type { WorkspaceContext } from "@/lib/workspace";
import { IntelInputError } from "./content";
import { browserCatalog, buildCatalog, buildMatchingContext } from "./provenance";
import { estimateSearchCost } from "./cost";
import { prepareIntelSearch, searchIntel } from "./search";
import { loadIntelMeetings } from "./store";
import { searchInputSchema, type IntelMeeting, type SearchInput, type SearchResult } from "./types";

function owner(w: WorkspaceContext) {
  return and(eq(jobs.teamId, w.teamId), eq(jobs.userId, w.userId));
}
type Preview = {
  estimate: ReturnType<typeof estimateSearchCost>;
  linkSource?: { text: string; url: string };
};

export async function previewIntelSearch(w: WorkspaceContext, input: SearchInput) {
  const corpus = await loadIntelMeetings(w);
  const { source, batches } = await prepareIntelSearch(input, corpus);
  const estimate = estimateSearchCost(batches);
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
  return createHash("sha256").update(JSON.stringify([catalog.people, catalog.intel.filter(i => ids.has(i.id)), buildMatchingContext(corpus, catalog.people)])).digest("hex");
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
    }, plan);
    await db.update(jobs).set({ status: "complete", result: { ...result, estimate, fingerprint: fingerprint(corpus, catalog, input, result) } }).where(scope);
  } catch (error) {
    await db.update(jobs).set({ status: "failed", error: error instanceof IntelInputError || error instanceof ProviderCreditExhaustedError ? error.message : "Could not complete this search. Please try again." }).where(scope);
  }
  await db.delete(jobs).where(and(owner(w), sql`${jobs.id} in (select id from intel_searches where team_id = ${w.teamId} and user_id = ${w.userId} and (status is null or status in ('complete','failed')) order by created_at desc offset 50)`));
}
export async function readIntelJob(w: WorkspaceContext, id?: string) {
  const [row] = await db.select().from(jobs).where(and(owner(w), isNotNull(jobs.status), sql`${jobs.status} <> 'preview'`, id ? eq(jobs.id, id) : undefined)).orderBy(desc(jobs.createdAt)).limit(1);
  if (!row) return null;
  const { id: jobId, status, input, completed, total, error, createdAt, result: stored } = row;
  const job = { id: jobId, status, input, completed, total, error, createdAt, estimate: (stored as Preview | null)?.estimate };
  if (job.status !== "complete") return job;
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

export async function markIntelJobInterrupted(w: WorkspaceContext, id: string) {
  await db.update(jobs).set({ status: "failed", error: "Your search was interrupted. Please try again." })
    .where(and(owner(w), eq(jobs.id, id), sql`${jobs.status} in ('queued','running')`));
}
