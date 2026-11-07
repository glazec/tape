"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MoreHorizontal, Search } from "lucide-react";

import { AppLabel } from "@/components/app-label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { MergeCandidate } from "@/lib/people";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Folds duplicate records of the same person into this one. The current
 * person is kept; meetings, emails and names from the others move here, and
 * Tape remembers those names and emails for future meetings. The latest merge
 * can be undone from the confirmation toast.
 */
export function PersonMergeDialog({ personId, personName }: { personId: string; personName: string }) {
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<MergeCandidate[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [keepName, setKeepName] = useState(personName);
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; undo: boolean; error?: boolean } | null>(null);
  const endpoint = `/api/people/${encodeURIComponent(personId)}/merge`;

  useEffect(() => {
    if (!open || people) return;
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("People could not be loaded. Try again.");
        setPeople(((await response.json()) as { people: MergeCandidate[] }).people);
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "People could not be loaded. Try again.");
      });
    return () => controller.abort();
  }, [endpoint, open, people]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.undo ? 12_000 : 6_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = people ?? [];
    if (!needle) return list.slice(0, 60);
    return list.filter(person => person.name.toLowerCase().includes(needle) || person.emails.some(email => email.includes(needle))).slice(0, 60);
  }, [people, query]);
  const chosen = (people ?? []).filter(person => selected.includes(person.id));
  const names = [...new Set([personName, ...chosen.map(person => person.name)])];
  const movingEmails = [...new Set(chosen.flatMap(person => person.emails))];
  const movingMeetings = chosen.reduce((sum, person) => sum + person.meetingCount, 0);

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setStep("choose");
      setSelected([]);
      setQuery("");
      setError(null);
      setKeepName(personName);
    }
  }

  async function merge() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceIds: selected, keepName: keepName === personName ? null : keepName }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "These records could not be merged. Try again.");
      const label = chosen.length === 1 ? chosen[0].name : plural(chosen.length, "record");
      changeOpen(false);
      setPeople(null);
      setNotice({ text: `Merged ${label} into ${keepName}.`, undo: true });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "These records could not be merged. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    setNotice({ text: "Undoing merge…", undo: false });
    const response = await fetch(endpoint, { method: "DELETE" }).catch(() => null);
    const body = await response?.json().catch(() => null) as { error?: string } | null;
    setNotice(response?.ok
      ? { text: "Merge undone.", undo: false }
      : { text: body?.error ?? "The merge could not be undone. Try again.", undo: false, error: true });
    if (response?.ok) router.refresh();
  }

  const likely = query ? [] : visible.filter(person => person.likely);
  const others = query ? visible : visible.filter(person => !person.likely);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More actions for ${personName}`}
          ref={trigger}
          render={<Button size="icon-sm" type="button" variant="ghost" />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => changeOpen(true)}>Merge duplicate records…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog onOpenChange={changeOpen} open={open}>
        <DialogContent className="max-w-lg" finalFocus={trigger}>
          {step === "choose" ? (
            <div className="animate-in fade-in-0 duration-150">
              <DialogTitle>Merge into {personName}</DialogTitle>
              <label className="relative mt-4 block">
                <span className="sr-only">Search people</span>
                <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  className="h-10 rounded-full pl-9"
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Search by name or email"
                  value={query}
                />
              </label>
              <div className="mt-4 h-[min(22rem,50dvh)] overflow-y-auto overscroll-contain">
                {!people && !error ? (
                  <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
                    <Loader2 className="size-4 animate-spin" /> Loading people
                  </p>
                ) : people && visible.length === 0 ? (
                  <p className="py-6 text-sm text-muted-foreground">No other people match.</p>
                ) : (
                  <>
                    {likely.length ? <AppLabel className="mb-2">Likely the same</AppLabel> : null}
                    <CandidateList people={likely} selected={selected} setSelected={setSelected} />
                    {likely.length && others.length ? <AppLabel className="mt-6 mb-2">Everyone else</AppLabel> : null}
                    <CandidateList people={others} selected={selected} setSelected={setSelected} />
                  </>
                )}
              </div>
              {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
              <div className="mt-5 flex justify-end gap-2">
                <Button onClick={() => changeOpen(false)} type="button" variant="ghost">Cancel</Button>
                <Button disabled={!selected.length} onClick={() => setStep("confirm")} type="button">
                  {selected.length ? `Review ${plural(selected.length, "record")}` : "Review merge"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="animate-in fade-in-0 duration-150">
              <DialogTitle>Merge {chosen.length === 1 ? chosen[0].name : plural(chosen.length, "record")} into {personName}?</DialogTitle>
              <ul className="mt-3 space-y-1 text-sm leading-6 text-muted-foreground">
                <li>{movingMeetings ? `${plural(movingMeetings, "meeting")} move here` : "No meetings move"}{movingEmails.length ? `, with ${movingEmails.join(", ")}` : ""}.</li>
                <li>Future meetings with these names or emails match this person.</li>
              </ul>
              {names.length > 1 ? (
                <fieldset className="mt-5">
                  <legend className="text-sm font-medium">Keep the name</legend>
                  <div className="mt-2 space-y-1">
                    {names.map(name => (
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm transition-colors duration-150 ease-out hover:bg-muted" key={name}>
                        <input checked={keepName === name} className="accent-foreground" name="keep-name" onChange={() => setKeepName(name)} type="radio" />
                        {name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
              <div className="mt-5 flex justify-end gap-2">
                <Button disabled={busy} onClick={() => setStep("choose")} type="button" variant="ghost">Back</Button>
                <Button disabled={busy} onClick={() => void merge()} type="button">
                  {busy ? <Loader2 className="animate-spin" /> : null}
                  Merge {plural(chosen.length, "record")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {notice ? (
        <div
          className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-lg items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm shadow-lg"
          role={notice.error ? "alert" : "status"}
        >
          <span className={`min-w-0 flex-1 truncate ${notice.error ? "text-destructive" : "text-foreground"}`}>{notice.text}</span>
          {notice.undo ? (
            <Button onClick={() => void undo()} size="sm" type="button" variant="ghost">Undo</Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function CandidateList({ people, selected, setSelected }: {
  people: MergeCandidate[];
  selected: string[];
  setSelected: (update: (current: string[]) => string[]) => void;
}) {
  if (!people.length) return null;
  return (
    <ul className="space-y-1">
      {people.map(person => {
        const checked = selected.includes(person.id);
        return (
          <li key={person.id}>
            <button
              aria-checked={checked}
              className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-150 ease-out hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setSelected(current => checked ? current.filter(id => id !== person.id) : [...current, person.id])}
              role="checkbox"
              type="button"
            >
              <span aria-hidden="true" className={`flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors duration-150 ease-out ${checked ? "border-foreground bg-foreground text-background" : "border-muted-foreground/50"}`}>
                {checked ? <Check className="size-3" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{person.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[person.emails.slice(0, 2).join(", "), person.meetingCount ? plural(person.meetingCount, "meeting") : null].filter(Boolean).join(" · ") || "No email or meetings"}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
