"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { startSearchTiming } from "@/lib/sentry/search-timing";
import type { ReactNode } from "react";
import { ArrowUpRight, Check, Clock3, Plus, Users, X, LoaderCircle, ChevronDown } from "lucide-react";
import { connectionRelationshipLabels } from "@/lib/meeting-connections";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { INTEL_SEARCH_PARALLEL_BATCHES } from "@/lib/intel/limits";
import { kindLabels, relevanceLabels, type Evidence, type HistoryEntry, type IntelBrowserCatalog as IntelCatalog, type IntelBrowserPerson as Person, type Match, type SearchInput, type SearchResult } from "@/lib/intel/types";

function dateLabel(date: string) { return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); }
function timestamp(ms: number) { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  return <div className="space-y-4">{evidence.map(e => <blockquote key={e.id} className="border-l-2 border-border pl-4">
    <p className="text-sm leading-6">“{e.text}”</p>
    <a className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" href={`/meetings/${e.meetingId}#${e.id}`}>
      {e.speaker ?? "Unknown speaker"} · {e.meetingTitle} · {dateLabel(e.date)} · {timestamp(e.startMs)} <ArrowUpRight aria-hidden="true" className="size-3" />
    </a>
  </blockquote>)}</div>;
}
const emptyCatalog: IntelCatalog = { people: [], intel: [], pending: 0, coverage: "" };
type Estimate = { lowUsd: number; highUsd: number; expectedUsd?: number; seconds?: number; batches?: number };
// Searches expected to cost less than this start without a confirmation step.
const CONFIRM_ABOVE_USD = 1;
function dollars(n: number) {
  if (!n) return "$0";
  if (n < 0.01) return "under $0.01";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n);
}
function minutesLabel(seconds: number) { return seconds < 60 ? "under a minute" : `about ${Math.round(seconds / 60)} min`; }
function expected(estimate: Estimate) { return estimate.expectedUsd ?? (estimate.lowUsd + estimate.highUsd) / 2; }
function estimateLabel(estimate: Estimate) {
  const parts = [`About ${dollars(expected(estimate))}`];
  if (estimate.seconds) parts.push(minutesLabel(estimate.seconds));
  return parts.join(" · ");
}
function clock(ms: number) { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
type Job = { estimate?: Estimate; id: string; status: string; input: SearchInput; completed: number; total: number; result?: SearchResult & { actualUsd?: number }; error?: string; createdAt: string;
  startedAt?: string; batchesDone?: number; stage?: string; partial?: Match[]; actualUsd?: number };
function MatchCard({ match, onOpen, fresh }: { match: Match; onOpen: (match: Match) => void; fresh?: boolean }) {
  return <article className={cn("py-6 first:pt-0", fresh && "animate-in fade-in duration-150 motion-reduce:animate-none")}>
    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><span>{match.score === 0 ? "No clear connection" : match.score !== undefined && match.score < 25 ? "Limited relevance" : relevanceLabels[match.relevance]}</span>{match.score !== undefined && <span title="Relevance score, not a probability">Relevance {match.score}/100</span>}<span aria-hidden="true">·</span><span>{dateLabel(match.evidence.reduce((date,e) => e.date > date ? e.date : date, match.evidence[0].date))}</span></div>
    <h3 className="text-lg font-medium leading-7"><button type="button" className="text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(match)}>{match.title} <ArrowUpRight aria-hidden="true" className="inline size-4" /></button></h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{match.detail}</p>
    <p className="mt-3 text-sm leading-6">{match.reason}</p>
    {match.caveat && <p className="mt-2 text-sm leading-6 text-muted-foreground">{match.caveat}</p>}
    <details className="mt-4"><summary className="flex min-h-11 w-fit cursor-pointer items-center text-xs font-medium underline underline-offset-4">View evidence · {match.evidence.length} {match.evidence.length === 1 ? "passage" : "passages"}</summary><div className="mt-4"><EvidenceList evidence={match.evidence} />{match.counterEvidence.length > 0 && <div className="mt-5"><p className="mb-3 text-xs font-medium">Changed or conflicting evidence</p><EvidenceList evidence={match.counterEvidence} /></div>}</div></details>
  </article>;
}
function SkeletonCard() {
  return <div aria-hidden="true" className="space-y-3 py-6 first:pt-0"><div className="h-3 w-28 animate-pulse rounded bg-muted motion-reduce:animate-none" /><div className="h-5 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" /><div className="h-3 w-full animate-pulse rounded bg-muted motion-reduce:animate-none" /><div className="h-3 w-5/6 animate-pulse rounded bg-muted motion-reduce:animate-none" /></div>;
}
function Stage({ state, children }: { state: "done" | "active" | "waiting"; children: ReactNode }) {
  return <li className={cn("flex items-start gap-3 text-sm leading-6", state === "waiting" && "text-muted-foreground")}>
    <span className="mt-1 flex size-4 shrink-0 items-center justify-center">{state === "done" ? <Check aria-hidden="true" className="size-4 text-muted-foreground" /> : state === "active" ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <span aria-hidden="true" className="size-1.5 rounded-full bg-muted-foreground/40" />}</span>
    <span className="min-w-0">{children}</span>
  </li>;
}
export function IntelSearch() {
  const [catalog, setCatalog] = useState(emptyCatalog);
  const [catalogState, setCatalogState] = useState("loading");
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [watch, setWatch] = useState<string | null>("latest");
  const [watchVersion, setWatchVersion] = useState(0);
  const [quote, setQuote] = useState<{ id: string; estimate: Estimate; input: SearchInput } | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<SearchInput | null>(null);
  const [tab, setTab] = useState<"intel" | "people">("intel");
  const [sort, setSort] = useState("important");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeHistory, setActiveHistory] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const [identityIds, setIdentityIds] = useState<string[]>([]);
  const [identityQuery, setIdentityQuery] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const sequence = useRef(0);
  const catalogRevision = useRef(0);
  const finishSearch = useRef<ReturnType<typeof startSearchTiming> | null>(null);
  useEffect(() => {
    if (!busy && finishSearch.current) {
      finishSearch.current(result ? "complete" : "failed");
      finishSearch.current = null;
    }
  }, [busy, result]);
  useEffect(() => () => { finishSearch.current?.("cancelled"); }, []);
  const controller = useRef<AbortController | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const labelFor = (input: SearchInput, available = catalog) => input.kind === "content" ? input.text : input.kind === "intel"
    ? available.intel.find(i => i.id === input.id)?.text ?? "Unavailable intel"
    : [...new Set(available.people.filter(p => input.ids.includes(p.id)).map(p => p.name))].join(", ");
  useEffect(() => {
    const abort = new AbortController();
    const revision = catalogRevision.current;
    async function load() {
      try {
        const response = await fetch("/api/intel/catalog", { signal: abort.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load starting points.");
        if (abort.signal.aborted) return;
        if (revision === catalogRevision.current) setCatalog(data.catalog);
        setHistory(current => [...current, ...data.history.filter((h: HistoryEntry) => !current.some(c => c.id === h.id))].slice(0, 50));
        setCatalogState("ready");
      } catch (e) {
        if (!abort.signal.aborted) setCatalogState(e instanceof Error ? e.message : "Could not load starting points.");
      }
    }
    void load();
    return () => abort.abort();
  }, [catalogAttempt]);
  useEffect(() => {
    if (!watch) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let id = watch;
    const current = sequence.current;
    const stale = () => abort.signal.aborted || current !== sequence.current;
    async function poll() {
      try {
        const response = await fetch(id === "latest" ? "/api/intel/search" : "/api/intel/search?id=" + id, { signal: abort.signal, cache: "no-store" });
        if (stale()) return;
        if (!response.ok) {
          if (response.status >= 500) throw new Error();
          setError(response.status === 401 ? "Sign in again to view your search." : "This search is no longer available.");
          setBusy(false); setWatch(null); return;
        }
        const { job: next }: { job: Job | null } = await response.json();
        if (stale()) return;
        setReconnecting(false);
        if (!next) { setWatch(null); setBusy(false); return; }
        id = next.id;
        setJob(next); setActiveHistory(next.id);
        if (next.input.kind === "content") { setSelected(null); setText(next.input.text); } else { setSelected(next.input); setText(""); }
        if (next.status === "failed") { setError(next.error ?? "Search failed."); setBusy(false); setWatch(null); setConfirmStop(false); return; }
        if (next.result) {
          setResult(next.result);
          if (next.result.catalog) { catalogRevision.current++; setCatalog(next.result.catalog); setCatalogState("ready"); }
          setBusy(false); setWatch(null); return;
        }
        setBusy(true);
        timer = setTimeout(poll, 1500);
      } catch {
        if (!stale()) { setReconnecting(true); timer = setTimeout(poll, 3000); }
      }
    }
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [watch, watchVersion]);
  const running = busy && !!job && !["complete", "failed"].includes(job.status);
  // Elapsed time ticks locally; only stage changes are announced.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  // A backgrounded tab still signals progress and completion.
  useEffect(() => {
    const base = "Intel";
    if (running && job) document.title = job.total ? `Matching ${job.batchesDone ?? 0} of ${job.total} · ${base}` : `Searching · ${base}`;
    else if (result) document.title = `Results ready · ${base}`;
    else document.title = base;
  }, [running, job, result]);
  function detach() {
    finishSearch.current?.("cancelled"); finishSearch.current = null;
    setWatchVersion(n => n + 1); sequence.current++; controller.current?.abort(); setWatch(null); setJob(null); setQuote(null); setReconnecting(false); setBusy(false); setConfirmStop(false);
  }
  async function stop() {
    if (!job) return;
    setConfirmStop(false);
    try {
      const response = await fetch("/api/intel/search?id=" + job.id, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setWatchVersion(n => n + 1); setWatch(job.id);
    } catch { setError("Could not stop this search. Try again."); }
  }
  function reset() {
    detach(); setSelected(null); setText(""); setResult(null); setError(""); setActiveHistory(null); field.current?.focus();
  }
  async function run(input: SearchInput, historyId?: string, useEstimate = false) {
    let accepted = useEstimate && quote && JSON.stringify(quote.input) === JSON.stringify(input) ? quote : null;
    detach();
    const abort = new AbortController(); controller.current = abort;
    const requestId = sequence.current;
    setBusy(true); setError(""); setResult(null); setActiveHistory(historyId ?? null); setHistoryOpen(false);
    if (input.kind === "content") { setSelected(null); setText(input.text); } else { setSelected(input); setText(""); }
    if (historyId && history.some(h => h.id === historyId && h.savedJob)) { setWatch(historyId); return; }
    try {
      const post = async (url: string) => {
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: abort.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Search failed. Please try again.");
        return data;
      };
      if (!accepted) {
        const quoted = await post("/api/intel/search?estimate=1");
        if (requestId !== sequence.current) return;
        const next = { id: quoted.id, estimate: quoted.estimate as Estimate, input };
        // Only expensive searches pause for confirmation; the rest start right away.
        if (expected(next.estimate) >= CONFIRM_ABOVE_USD) { setQuote(next); setBusy(false); return; }
        accepted = next;
      }
      finishSearch.current = startSearchTiming("intel");
      const data = await post("/api/intel/search?quote=" + accepted.id);
      if (requestId !== sequence.current) return;
      setJob({ id: data.id, estimate: accepted.estimate, input, status: "queued", completed: 0, total: 0, createdAt: new Date().toISOString(), partial: [] });
      setWatch(data.id); setActiveHistory(data.id);
      setHistory(current => [{ id: data.id, savedJob: true, input, label: labelFor(input), createdAt: new Date().toISOString() }, ...current.filter(h => h.id !== data.id)].slice(0,50));
    } catch (caught) {
      if (requestId === sequence.current && !abort.signal.aborted) {
        setError(caught instanceof Error ? caught.message : "Search failed. Please try again."); setBusy(false);
      }
    }
  }
  function openMatch(match: Match) {
    if (match.type === "person") { const candidate = catalog.people.find(p => p.id === match.id); if (candidate) choosePerson(candidate); }
    else void run({ kind: "intel", id: match.id }, undefined, true);
  }
  function choosePerson(candidate: Person) { setPerson(candidate); setIdentityIds([candidate.id]); setIdentityQuery(""); }
  const filterText = useDeferredValue(text.toLowerCase());
  const filteredPeople = useMemo(() => catalog.people.filter(p => `${p.name} ${p.detail}`.toLowerCase().includes(filterText)), [catalog.people, filterText]);
  const filteredIntel = useMemo(() => catalog.intel.filter(i => `${i.text} ${i.speaker}`.toLowerCase().includes(filterText)).sort((a,b) => sort === "important" ? Number(b.importance === "high") - Number(a.importance === "high") || b.date.localeCompare(a.date) : b.date.localeCompare(a.date)), [catalog.intel, filterText, sort]);
  const sameName = person ? catalog.people.filter(p => p.kind === "participant" && (p.name.toLowerCase() === person.name.toLowerCase() || (identityQuery.trim() && `${p.name} ${p.detail}`.toLowerCase().includes(identityQuery.toLowerCase())))) : [];
  return <div className="flex min-h-[calc(100dvh-9rem)] flex-col md:flex-row md:gap-10 lg:gap-14">
    <aside aria-label="Search history" className="shrink-0 md:w-52 md:pr-6">
      <div className="mb-5 flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-muted-foreground">SEARCH HISTORY</span>
        <Button variant="ghost" size="icon" onClick={reset} aria-label="New search" className="size-11"><Plus className="size-4" /></Button>
        <Button variant="ghost" size="icon" onClick={() => setHistoryOpen(!historyOpen)} aria-label="Toggle search history" aria-expanded={historyOpen} className="size-11 md:hidden"><ChevronDown className={cn("size-4 transition-transform motion-reduce:transition-none", historyOpen && "rotate-180")} /></Button>
      </div>
      <div className={cn("space-y-1 md:block", !historyOpen && "hidden")}>
        {history.length ? history.map(entry => <button type="button" key={entry.id} onClick={() => void run(entry.input, entry.id)} aria-current={activeHistory === entry.id ? "true" : undefined}
          className={cn("flex w-full items-start gap-2 rounded-lg px-2 py-3 text-left text-sm leading-5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", activeHistory === entry.id && "bg-muted")}>
          <Clock3 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span className="line-clamp-2 break-words">{entry.label}</span>
        </button>) : <p className="px-2 text-sm leading-6 text-muted-foreground">Your searches will appear here.</p>}
        {history.length > 0 && <button type="button" className="mt-5 px-2 py-2 text-xs text-muted-foreground underline underline-offset-4" onClick={async () => {
          setHistoryError("");
          try { const r = await fetch("/api/intel/history", { method: "DELETE" }); if (!r.ok) throw new Error(); setHistory([]); reset(); }
          catch { setHistoryError("Could not clear history. Try clearing it again."); }
        }}>Clear history</button>}
        {historyError && <p role="alert" className="px-2 text-xs leading-5 text-muted-foreground">{historyError}</p>}
      </div>
    </aside>
    <section aria-label="Intel search" className="min-w-0 flex-1 pt-2 md:pt-8">
      <header className="mb-7">
        <p className="mb-3 text-xs font-medium tracking-[0.16em] text-muted-foreground">INTEL</p>
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">Who should know?</h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">Find the right person for an idea. Or the right idea for a person.</p>
      </header>
      <form onSubmit={event => { event.preventDefault(); if (busy) return; if (selected) void run(selected, undefined, true); else if (text.trim().length >= 3) void run({ kind: "content", text: text.trim() }, undefined, true); }}
        className="rounded-2xl border border-border bg-background shadow-[0_3px_20px_-12px_rgba(40,25,20,0.2)] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15">
        {selected && <div className="px-4 pt-4 pb-1"><div className="inline-flex max-w-full items-center gap-1 rounded-lg bg-muted py-1 pl-3 pr-1 text-sm"><span className="line-clamp-2">{labelFor(selected)}</span>
          <button type="button" onClick={reset} aria-label="Remove selection" className="flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-background"><X className="size-3.5" /></button></div></div>}
        {!selected && <><label htmlFor="intel-query" className="sr-only">Search intel or people, or paste content or a link</label>
        <textarea ref={field} id="intel-query" value={text} maxLength={20000} rows={2} readOnly={running} aria-describedby="intel-cost"
          onChange={event => { if (running) return; detach(); setText(event.target.value); setResult(null); setError(""); setActiveHistory(null); }}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
          placeholder="Search intel or people, or paste content or a link…"
          className="block w-full resize-none bg-transparent px-5 pb-2 pt-5 text-base leading-6 outline-none placeholder:text-muted-foreground read-only:text-muted-foreground" /></>}
        <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-2">
          <span id="intel-cost" className="text-xs leading-5 text-muted-foreground">{quote
            ? <>{estimateLabel(quote.estimate)}{quote.estimate.batches ? ` · ${quote.estimate.batches} ${quote.estimate.batches === 1 ? "group" : "groups"} of meetings` : ""}. This search is larger than usual.</>
            : busy && !job ? "Estimating…"
            : job?.estimate && running ? `${estimateLabel(job.estimate)} AI cost`
            : selected?.kind === "person" ? "Find people with relevant requests or offers" : "Find people who may be interested"}</span>
          {quote ? <span className="flex shrink-0 gap-1"><Button type="button" variant="ghost" className="min-h-11" onClick={() => setQuote(null)}>Cancel</Button><Button type="submit" className="min-h-11 rounded-xl">Run anyway</Button></span>
            : <Button type="submit" disabled={busy || (!selected && text.trim().length < 3)} className="min-h-11 shrink-0 rounded-xl px-4">{busy ? <><LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />{job ? "Searching…" : "Preparing…"}</> : "Find people"}</Button>}
        </div>
      </form>
      {quote?.input.kind === "content" && /^https:\/\//i.test(quote.input.text) && <p className="mt-2 text-xs text-muted-foreground">Estimate excludes reading the link.</p>}
      {error && <div role="alert" className="mt-5 rounded-lg border border-destructive/30 p-4 text-sm">{error}<button type="button" className="ml-2 underline" onClick={() => { if (selected) void run(selected, undefined, true); else if (text.trim()) void run({ kind: "content", text: text.trim() }, undefined, true); }}>{job?.partial?.length ? "Run again" : "Try again"}</button></div>}
      {busy && !job && !watch && <p role="status" className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />Preparing your search and estimating cost…</p>}
      {(running || reconnecting || (busy && watch && !job)) && <div className="mt-8 max-w-xl">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="line-clamp-1 text-base font-medium">{selected || job ? labelFor(job?.input ?? selected!) : text}</h2>
          {job?.startedAt && <span aria-live="off" className="text-xs tabular-nums text-muted-foreground">Started {clock(now - Date.parse(job.startedAt))} ago{job.estimate?.seconds ? ` · ${(() => { const left = job.estimate.seconds * 1000 - (now - Date.parse(job.startedAt)); return left > 60_000 ? `${minutesLabel(left / 1000)} left` : left > 0 ? "less than a minute estimated" : "taking longer than estimated"; })()}` : ""}</span>}
        </div>
        {(() => {
          const groups = job?.total ? job.total : 0;
          const done = job?.batchesDone ?? 0;
          const matched = Math.min(groups, job?.completed ?? 0);
          const finalizing = job?.stage === "finalizing" || (groups > 0 && done === groups);
          const queued = job?.status === "queued";
          const status = reconnecting ? "Reconnecting to your search…" : queued ? "Waiting for a search worker…" : !groups ? "Reading your meetings…" : finalizing ? "Final check on matches…" : `Matching ${groups} ${groups === 1 ? "group" : "groups"} of meetings · ${done} checked`;
          return <>
            <p role="status" className="sr-only">{status}</p>
            <ol className="mt-4 space-y-3">
              <Stage state={groups ? "done" : "active"}>{groups ? `Read your meetings and grouped them into ${groups} ${groups === 1 ? "batch" : "batches"}` : queued ? "Waiting for a search worker" : "Reading your meetings"}</Stage>
              <Stage state={!groups ? "waiting" : matched < groups ? "active" : "done"}>Scoring everyone from the past three months{groups ? ` · ${matched} of ${groups}` : ""}
                {groups > 0 && matched === 0 && <span className="block text-xs text-muted-foreground">Each batch takes 1 to 4 minutes. {Math.min(INTEL_SEARCH_PARALLEL_BATCHES, groups)} run at once.</span>}</Stage>
              <Stage state={finalizing ? "active" : "waiting"}>Ranking scores and checking access</Stage>
            </ol>
            <progress aria-label="Search progress" aria-valuetext={groups ? `${matched} of ${groups} groups scored; final access check pending` : status} className="mt-5 block h-1 w-full accent-primary" max={groups ? groups + 1 : 1} value={groups ? Math.min(job?.completed ?? 0, groups) : undefined} />
          </>;
        })()}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>You can close this tab. Your search keeps running.</span>
          {job && (confirmStop
            ? <span className="flex items-center gap-1"><span>Stop now? Matches found so far stay.</span><Button variant="ghost" size="sm" className="min-h-11" onClick={() => void stop()}>Stop</Button><Button variant="ghost" size="sm" className="min-h-11" onClick={() => setConfirmStop(false)}>Keep going</Button></span>
            : <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setConfirmStop(true)}>Stop search</Button>)}
        </div>
      </div>}
      {!result && job && (running || job.partial?.length) ? <div className="mt-8 max-w-3xl">
        <p className="mb-4 text-xs font-medium tracking-wide text-muted-foreground">{running ? `PRELIMINARY MATCHES · ${job.batchesDone ?? 0} OF ${(job.total || 0) || "?"} BATCHES SCORED` : `MATCHES FOUND BEFORE THE SEARCH STOPPED`}</p>
        <div className="space-y-2">
          {[...new Map((job.partial ?? []).map(m => [m.id, m])).values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map(match => <MatchCard key={match.id} match={match} fresh onOpen={openMatch} />)}
          {running && !job.partial?.length && <><SkeletonCard /><SkeletonCard /></>}
        </div>
        {running && (job.batchesDone ?? 0) > 0 && !job.partial?.length && <p className="text-sm text-muted-foreground">No scores yet. Still processing the remaining batches.</p>}
      </div> : null}
      {result && <div className="mt-9">
        <div className="mb-1 flex items-center justify-between gap-3"><h2 aria-live="polite" className="text-base font-semibold">{result.matches.length ? `${result.matches.length} ${result.matches.length === 1 ? "person" : "people"} ranked` : "No people to rank"}</h2><Button variant="ghost" className="min-h-11" onClick={reset}>New search</Button></div>
        <p className="mb-6 text-xs leading-5 text-muted-foreground">{result.coverage}{result.actualUsd ? ` AI cost ${dollars(result.actualUsd)}.` : ""}</p>
        {result.historyWarning && <p role="status" className="mb-5 text-sm text-muted-foreground">{result.historyWarning}</p>}
        {result.source.url && <details className="mb-6 text-sm"><summary className="cursor-pointer text-muted-foreground">Content read from the link</summary><a href={result.source.url} target="_blank" rel="noreferrer" className="mt-2 block break-all underline">{result.source.url}</a><p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap leading-6">{result.source.text}</p></details>}
        {!result.matches.length && <p className="text-sm leading-6 text-muted-foreground">No eligible participants were found in accessible meetings from the past three months.</p>}
        <div className="space-y-2">{result.matches.map(match => <MatchCard key={match.id} match={match} onOpen={openMatch} />)}</div>
      </div>}
      {!result && !busy && catalogState !== "ready" && <div className="mt-9 text-sm text-muted-foreground" role="status">{catalogState === "loading" ? "Loading intel and people…" : <>{catalogState} <button className="underline" onClick={() => { setCatalogState("loading"); setCatalogAttempt(n => n + 1); }}>Reload</button></>}</div>}
      {!result && !busy && catalogState === "ready" && <div className="mt-9">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex gap-6" role="tablist" aria-label="Starting points">{(["intel", "people"] as const).map(value => <button type="button" role="tab" id={`tab-${value}`} aria-controls={`panel-${value}`} aria-selected={tab === value} key={value} onClick={() => setTab(value)}
            onKeyDown={event => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); const next = value === "intel" ? "people" : "intel"; setTab(next); document.getElementById(`tab-${next}`)?.focus(); } }}
            tabIndex={tab === value ? 0 : -1} className={cn("relative pb-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === value ? "font-medium after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground" : "text-muted-foreground")}>{value === "intel" ? "Intel" : "People"}</button>)}</div>
          {tab === "intel" && <select aria-label="Sort intel" className="mb-3 bg-transparent text-xs text-muted-foreground" value={sort} onChange={event => setSort(event.target.value)}><option value="important">Important first</option><option value="recent">Newest first</option></select>}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "intel" ? <div className="space-y-1">{filteredIntel.slice(0,30).map(item => <div key={item.id} className="py-5">
            <button type="button" onClick={() => { setSelected({ kind: "intel", id: item.id }); setText(""); void run({ kind: "intel", id: item.id }); }} className="group w-full rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><span>{kindLabels[item.kind]}</span><span aria-hidden="true">·</span><span>{dateLabel(item.date)}</span></div>
              <div className="flex items-start gap-5"><p className="flex-1 text-[15px] leading-6 group-hover:underline group-hover:underline-offset-4">{item.text}</p><ArrowUpRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" /></div>
              <p className="mt-2 text-xs text-muted-foreground">{item.speaker} · {item.evidence[0]?.meetingTitle}</p>
            </button>
            <details className="mt-3"><summary className="flex min-h-11 w-fit cursor-pointer items-center text-xs text-muted-foreground underline underline-offset-4">View source</summary><div className="mt-3"><EvidenceList evidence={item.evidence} /></div></details>
          </div>)}{!filteredIntel.length && <div className="py-10 text-sm leading-6 text-muted-foreground">{text ? "No intel matches this text. Submit it to find interested people." : catalog.pending ? "Intel will appear as your meetings are processed. You can already search with a person, content, or a link." : "Intel will appear here when meeting transcripts are ready."}</div>}
          {filteredIntel.length > 30 && <p className="py-3 text-xs text-muted-foreground">Showing 30 of {filteredIntel.length}. Type above to narrow the list.</p>}</div>
          : <div className="space-y-1">{filteredPeople.slice(0,30).map(candidate => <button type="button" key={candidate.id} onClick={() => choosePerson(candidate)} className="flex w-full items-start gap-3 rounded py-4 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
            <span className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{candidate.kind === "mentioned" ? <Users className="size-4" aria-hidden="true" /> : candidate.name.slice(0,2).toUpperCase()}</span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{candidate.name}</span><span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{candidate.detail}</span><span className="mt-1 block text-xs text-muted-foreground">{candidate.kind === "mentioned" ? "Mentioned contact" : `${candidate.meetingIds.length} ${candidate.meetingIds.length === 1 ? "meeting" : "meetings"}`}</span></span><ArrowUpRight aria-hidden="true" className="mt-2 size-4 text-muted-foreground" />
          </button>)}{!filteredPeople.length && <p className="py-10 text-sm text-muted-foreground">No matching people. Try a name or meeting topic.</p>}{filteredPeople.length > 30 && <p className="py-3 text-xs text-muted-foreground">Showing 30 of {filteredPeople.length}. Type above to narrow the list.</p>}</div>}
        </div>
      </div>}
    </section>
    <Dialog open={!!person} onOpenChange={open => { if (!open) setPerson(null); }}>
      <DialogContent><DialogTitle>Choose the right person</DialogTitle><DialogDescription className="mt-2">{person?.kind === "mentioned" ? `This contact was mentioned in a meeting. Reported relationship: ${connectionRelationshipLabels[person.relationship as keyof typeof connectionRelationshipLabels] ?? "Mentioned only"}.` : "Only combine meeting identities you know belong to this person."}</DialogDescription>
        {person?.kind === "participant" && <label className="mt-4 block text-xs text-muted-foreground">Find another meeting identity<input value={identityQuery} onChange={e => setIdentityQuery(e.target.value)} placeholder="Name or meeting topic" className="mt-2 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground" /></label>}
        <div className="my-4 max-h-64 space-y-2 overflow-auto">{(person?.kind === "mentioned" ? [person] : sameName).map(candidate => <label key={candidate.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
          <input type="checkbox" checked={identityIds.includes(candidate.id)} onChange={event => setIdentityIds(ids => event.target.checked ? [...ids, candidate.id] : ids.filter(id => id !== candidate.id))} className="mt-1 accent-[var(--primary)]" />
          <span><span className="font-medium">{candidate.name}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{candidate.detail}</span><span className="mt-1 block text-xs text-muted-foreground">{dateLabel(candidate.sourceDate)}</span><a href={`/meetings/${candidate.sourceMeetingId}#${candidate.sourceSegmentId}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs underline underline-offset-4">Open source passage</a></span>
        </label>)}</div>
        <div className="flex justify-end gap-2"><DialogClose className="rounded-lg px-3 py-2 text-sm hover:bg-muted">Cancel</DialogClose><Button disabled={!identityIds.length || identityIds.length > 20} onClick={() => { const input: SearchInput = { kind: "person", ids: identityIds }; setPerson(null); void run(input); }}>Find matches</Button></div>
      </DialogContent>
    </Dialog>
  </div>;
}
