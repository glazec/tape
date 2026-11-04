"use client";

import { useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, Clock3, Plus, Users, X, LoaderCircle, ChevronDown } from "lucide-react";
import { connectionRelationshipLabels } from "@/lib/meeting-connections";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { kindLabels, relevanceLabels, type Evidence, type HistoryEntry, type IntelBrowserCatalog as IntelCatalog, type IntelBrowserPerson as Person, type SearchInput, type SearchResult } from "@/lib/intel/types";

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
export function IntelSearch({ catalog: initialCatalog, initialHistory }: { catalog: IntelCatalog; initialHistory: HistoryEntry[] }) {
  const [catalog, setCatalog] = useState(initialCatalog);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<SearchInput | null>(null);
  const [tab, setTab] = useState<"intel" | "people">("intel");
  const [sort, setSort] = useState("important");
  const [history, setHistory] = useState(initialHistory);
  const [activeHistory, setActiveHistory] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const [identityIds, setIdentityIds] = useState<string[]>([]);
  const [identityQuery, setIdentityQuery] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const labelFor = (input: SearchInput, available = catalog) => input.kind === "content" ? input.text : input.kind === "intel"
    ? available.intel.find(i => i.id === input.id)?.text ?? "Unavailable intel"
    : [...new Set(available.people.filter(p => input.ids.includes(p.id)).map(p => p.name))].join(", ");
  function reset() {
    sequence.current++; controller.current?.abort(); setBusy(false); setSelected(null); setText(""); setResult(null); setError(""); setActiveHistory(null); field.current?.focus();
  }
  async function run(input: SearchInput, historyId?: string) {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const requestId = ++sequence.current;
    setBusy(true); setError(""); setResult(null); setActiveHistory(historyId ?? null); setHistoryOpen(false);
    if (input.kind === "content") { setSelected(null); setText(input.text); } else { setSelected(input); setText(""); }
    try {
      const response = await fetch("/api/intel/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: abort.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Search failed. Please try again.");
      if (requestId !== sequence.current) return;
      if (data.catalog) setCatalog(data.catalog);
      setResult(data); setActiveHistory(data.historyId ?? null);
      if (data.historyId) setHistory(current => [{ id: data.historyId, input, label: labelFor(input, data.catalog ?? catalog), createdAt: new Date().toISOString() }, ...current].slice(0,50));
    } catch (caught) {
      if (requestId === sequence.current && !abort.signal.aborted) setError(caught instanceof Error ? caught.message : "Search failed. Please try again.");
    } finally { if (requestId === sequence.current) setBusy(false); }
  }
  function choosePerson(candidate: Person) { setPerson(candidate); setIdentityIds([candidate.id]); setIdentityQuery(""); }
  const filteredPeople = catalog.people.filter(p => `${p.name} ${p.detail}`.toLowerCase().includes(text.toLowerCase()));
  const filteredIntel = catalog.intel.filter(i => `${i.text} ${i.speaker}`.toLowerCase().includes(text.toLowerCase())).sort((a,b) => sort === "important" ? Number(b.importance === "high") - Number(a.importance === "high") || b.date.localeCompare(a.date) : b.date.localeCompare(a.date));
  const sameName = person ? catalog.people.filter(p => p.kind === "participant" && (p.name.toLowerCase() === person.name.toLowerCase() || (identityQuery.trim() && `${p.name} ${p.detail}`.toLowerCase().includes(identityQuery.toLowerCase())))) : [];
  return <div className="flex min-h-[calc(100dvh-9rem)] flex-col md:flex-row md:gap-10 lg:gap-14">
    <aside aria-label="Search history" className="shrink-0 md:w-52 md:pr-6">
      <div className="mb-5 flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-muted-foreground">SEARCH HISTORY</span>
        <Button variant="ghost" size="icon" onClick={reset} aria-label="New search"><Plus className="size-4" /></Button>
        <Button variant="ghost" size="icon" onClick={() => setHistoryOpen(!historyOpen)} aria-label="Toggle search history" aria-expanded={historyOpen} className="md:hidden"><ChevronDown className="size-4" /></Button>
      </div>
      <div className={cn("space-y-1 md:block", !historyOpen && "hidden")}>
        {history.length ? history.map(entry => <button type="button" key={entry.id} onClick={() => void run(entry.input, entry.id)} aria-current={activeHistory === entry.id ? "true" : undefined}
          className={cn("flex w-full items-start gap-2 rounded-lg px-2 py-3 text-left text-sm leading-5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", activeHistory === entry.id && "bg-muted")}>
          <Clock3 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span className="line-clamp-2 break-words">{entry.label}</span>
        </button>) : <p className="px-2 text-sm leading-6 text-muted-foreground">Your searches will appear here.</p>}
        {history.length > 0 && <button type="button" className="mt-5 px-2 py-2 text-xs text-muted-foreground underline underline-offset-4" onClick={async () => {
          setHistoryError("");
          try { const r = await fetch("/api/intel/history", { method: "DELETE" }); if (!r.ok) throw new Error(); setHistory([]); setActiveHistory(null); }
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
      <form onSubmit={event => { event.preventDefault(); if (selected) void run(selected); else if (text.trim().length >= 3) void run({ kind: "content", text: text.trim() }); }}
        className="rounded-2xl border border-border bg-background shadow-[0_3px_20px_-12px_rgba(40,25,20,0.2)] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15">
        {selected && <div className="px-4 pt-4"><div className="inline-flex max-w-full items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm"><span className="line-clamp-2">{labelFor(selected)}</span>
          <button type="button" onClick={reset} aria-label="Remove selection" className="shrink-0 rounded p-1 hover:bg-background"><X className="size-3.5" /></button></div></div>}
        <label htmlFor="intel-query" className="sr-only">Search intel or people, or paste content or a link</label>
        <textarea ref={field} id="intel-query" value={text} maxLength={20000} rows={2} disabled={!!selected}
          onChange={event => { sequence.current++; controller.current?.abort(); setBusy(false); setText(event.target.value); setResult(null); setError(""); setActiveHistory(null); }}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
          placeholder={selected ? "Ready to find matches" : "Search intel or people, or paste content or a link…"}
          className="block w-full resize-none bg-transparent px-5 pb-2 pt-5 text-base leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-60" />
        <div className="flex items-center justify-between px-4 pb-3">
          <span className="text-xs text-muted-foreground">{selected?.kind === "person" ? "Find relevant intel and connections" : "Find people who may be interested"}</span>
          <Button type="submit" aria-label="Find matches" disabled={busy || (!selected && text.trim().length < 3)} className="size-11 rounded-xl" size="icon">{busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <ArrowUp aria-hidden="true" className="size-4" />}</Button>
        </div>
      </form>
      {error && <div role="alert" className="mt-5 rounded-lg border border-destructive/30 p-4 text-sm">{error}<button type="button" className="ml-2 underline" onClick={() => { if (selected) void run(selected); else if (text.trim()) void run({ kind: "content", text }); }}>Try again</button></div>}
      {busy && <p role="status" className="mt-8 text-sm text-muted-foreground">Reading the evidence and finding relevant people…</p>}
      {result && <div aria-live="polite" className="mt-9">
        <div className="mb-5 flex items-center justify-between"><h2 className="text-sm font-medium">{result.matches.length ? `${result.matches.length} possible ${result.matches.length === 1 ? "match" : "matches"}` : "No supported matches"}</h2><Button variant="ghost" onClick={reset}>New search</Button></div>
        {result.historyWarning && <p role="status" className="mb-5 text-sm text-muted-foreground">{result.historyWarning}</p>}
        {result.source.url && <details className="mb-6 text-sm"><summary className="cursor-pointer text-muted-foreground">Content read from the link</summary><a href={result.source.url} target="_blank" rel="noreferrer" className="mt-2 block break-all underline">{result.source.url}</a><p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap leading-6">{result.source.text}</p></details>}
        {!result.matches.length && <p className="text-sm leading-6 text-muted-foreground">No supported matches found. Try a more specific idea or another person.</p>}
        <div className="space-y-2">{result.matches.map(match => <article key={match.id} className="py-6 first:pt-0">
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><span>{relevanceLabels[match.relevance]}</span><span aria-hidden="true">·</span><span>{dateLabel(match.evidence.reduce((date,e) => e.date > date ? e.date : date, match.evidence[0].date))}</span></div>
          <h3 className="text-lg font-medium leading-7"><button type="button" className="text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => {
            if (match.type === "person") { const candidate = catalog.people.find(p => p.id === match.id); if (candidate) choosePerson(candidate); }
            else void run({ kind: "intel", id: match.id });
          }}>{match.title} <ArrowUpRight aria-hidden="true" className="inline size-4" /></button></h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{match.detail}</p>
          <p className="mt-3 text-sm leading-6">{match.reason}</p>
          {match.caveat && <p className="mt-2 text-sm leading-6 text-muted-foreground">{match.caveat}</p>}
          <details className="mt-4"><summary className="flex min-h-11 w-fit cursor-pointer items-center text-xs font-medium underline underline-offset-4">View evidence · {match.evidence.length} {match.evidence.length === 1 ? "passage" : "passages"}</summary><div className="mt-4"><EvidenceList evidence={match.evidence} />{match.counterEvidence.length > 0 && <div className="mt-5"><p className="mb-3 text-xs font-medium">Changed or conflicting evidence</p><EvidenceList evidence={match.counterEvidence} /></div>}</div></details>
        </article>)}</div>
        <p className="mt-6 text-xs leading-5 text-muted-foreground">{result.coverage}</p>
      </div>}
      {!result && !busy && <div className="mt-9">
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
