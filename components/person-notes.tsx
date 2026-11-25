"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type React from "react";
import { Link2, Link2Off, Loader2, MoreHorizontal, Pencil, Trash2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/person-format";
import type { PersonNote } from "@/lib/person-notes";
import { cn } from "@/lib/utils";

export const PERSON_NOTE_MAX_LENGTH = 4000;
/** Notes past this many characters show a remaining count. */
const COUNT_FROM = 3600;
/** The list stays short; older notes sit behind a show control. */
const VISIBLE_NOTES = 5;
/** Folding away only one or two notes saves nothing, so short lists stay whole. */
const FOLD_SLACK = 2;
/** Long bodies fold to a few lines with Show more. */
const FOLD_CHARS = 420;
const FOLD_LINES = 6;

/**
 * Extends a small control's hit area to at least 44 px without changing how it
 * looks. Icon buttons are 28 px, small buttons are 28 px tall, and xs text
 * links are 16 px tall.
 */
const HIT_ICON = "relative after:absolute after:-inset-2";
const HIT_BUTTON = "relative after:absolute after:-inset-x-1 after:-inset-y-2";
const HIT_TEXT = "relative after:absolute after:-inset-x-2 after:-inset-y-3.5";

type Failure = { noteId: string | null; action: "add" | "edit" | "delete"; message: string };
type LinkProblem = "missing" | "malformed";

export const noteAnchor = (noteId: string) => `note-${noteId}`;
function restoreNoteFocus(noteId: string) {
  window.requestAnimationFrame(() => document.getElementById(noteAnchor(noteId))?.focus({ preventScroll: true }));
}
export const notePermalink = (personId: string, noteId: string) =>
  `/people/${encodeURIComponent(personId)}#${noteAnchor(encodeURIComponent(noteId))}`;

const noSubscription = () => () => {};

/**
 * A durable local date for a note: "Nov 3" this year, "Nov 3, 2025" before
 * it. Notes are records, so the label never drifts the way "3 days ago" does.
 */
export function formatNoteDate(value: string, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

/** The full local date and time, for a tooltip. */
export function formatNoteDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", { dateStyle: "full", timeStyle: "short" }).format(date);
}

/** Local labels render in the browser so the server never guesses a timezone. */
function useLocal<T>(read: () => T, server: T) {
  return useSyncExternalStore(noSubscription, read, () => server);
}

/** A note's date in the viewer's timezone, shared by the person page and Intel. */
export function NoteDate({ value }: { value: string }) {
  const label = useLocal(() => formatNoteDate(value), "");
  const full = useLocal(() => formatNoteDateTime(value), "");
  return <time dateTime={value} title={full || undefined}>{label || " "}</time>;
}

async function request(url: string, init: RequestInit, fallback: string) {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error("Could not reach Tape. Check your connection.");
  }
  if (response.status === 204) return null;
  const body = (await response.json().catch(() => null)) as { note?: PersonNote; error?: string } | null;
  // The UI offers its own Try again, so drop a trailing one from the message.
  if (!response.ok) throw new Error((body?.error || fallback).replace(/\s*(and\s+)?try again\.?$/i, ".").replace(/\.\.$/, "."));
  return body;
}

/** Grows a textarea with its text where CSS field-sizing is unsupported. */
function autosize(node: HTMLTextAreaElement | null) {
  if (!node || typeof CSS === "undefined" || CSS.supports?.("field-sizing", "content")) return;
  node.style.height = "auto";
  node.style.height = `${node.scrollHeight}px`;
}

const submitShortcut = (event: React.KeyboardEvent) =>
  event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing;

/** Reads #note-{id}. A note hash that cannot be decoded is malformed. */
function noteIdFromHash(hash: string): { noteId: string } | { problem: "malformed" } | null {
  if (!hash.startsWith("#note-")) return null;
  try {
    const noteId = decodeURIComponent(hash.slice("#note-".length));
    return noteId.trim() ? { noteId } : { problem: "malformed" };
  } catch {
    return { problem: "malformed" };
  }
}

const linkProblemCopy: Record<LinkProblem, string> = {
  missing: "The linked note is no longer here. It may have been deleted.",
  malformed: "That note link is incomplete.",
};

/**
 * Shared notes about a person. Everyone who can open the person page reads
 * and adds them; only the author edits or deletes their own. Each note has a
 * permalink at /people/{personId}#note-{id}.
 */
export function PersonNotes({ initialNotes, personId, personName }: { initialNotes: PersonNote[]; personId: string; personName: string }) {
  const [notes, setNotes] = useState(initialNotes);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [highlight, setHighlight] = useState<string | null>(null);
  const [linkProblem, setLinkProblem] = useState<LinkProblem | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [copyFeedback, setCopyFeedback] = useState<{ id: string; message: string } | null>(null);
  const section = useRef<HTMLElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef(notes);
  const headingId = useId();
  const scopeId = useId();
  const endpoint = `/api/people/${encodeURIComponent(personId)}/notes`;
  const firstName = personName.trim().split(/\s+/)[0] || personName;
  const shortcut = useLocal(() => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘ Enter" : "Ctrl Enter", "");
  const folds = notes.length > VISIBLE_NOTES + FOLD_SLACK;
  useEffect(() => autosize(composer.current), [draft]);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  const announce = (message: string) => {
    // Clear first so the same message is announced again.
    setAnnouncement("");
    window.requestAnimationFrame(() => setAnnouncement(message));
  };

  // A permalink opens the list and the note's fold, then brings the note into view.
  const reveal = useCallback((noteId: string) => {
    const list = notesRef.current;
    const index = list.findIndex(note => note.id === noteId);
    if (index < 0) return false;
    if (list.length > VISIBLE_NOTES + FOLD_SLACK && index >= VISIBLE_NOTES) setShowAll(true);
    setExpanded(current => current[noteId] ? current : { ...current, [noteId]: true });
    setHighlight(noteId);
    window.requestAnimationFrame(() => {
      const element = document.getElementById(noteAnchor(noteId));
      if (!element) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      element.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "center" });
      element.focus({ preventScroll: true });
    });
    return true;
  }, []);

  useEffect(() => {
    const fromHash = () => {
      const target = noteIdFromHash(window.location.hash);
      if (!target) return;
      if ("noteId" in target && reveal(target.noteId)) {
        setLinkProblem(null);
        return;
      }
      // Say quietly why nothing opened, where the reader is looking for it.
      setLinkProblem("noteId" in target ? "missing" : "malformed");
      window.requestAnimationFrame(() => section.current?.scrollIntoView?.({ block: "start" }));
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [reveal]);

  useEffect(() => {
    if (!highlight) return;
    const timer = window.setTimeout(() => setHighlight(null), 2400);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  useEffect(() => {
    if (!copyFeedback) return;
    const timer = window.setTimeout(() => setCopyFeedback(null), 3000);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  function dismissLinkProblem() {
    setLinkProblem(null);
    if (noteIdFromHash(window.location.hash)) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }

  /**
   * Returns focus to the composer after a save settles, unless the person has
   * since moved somewhere else on purpose. Focus still in the form, or dropped
   * to the page because a control it was on went away, counts as staying.
   */
  function restoreComposerFocus() {
    window.requestAnimationFrame(() => {
      const active = document.activeElement;
      // Match by attribute: form elements can be proxied, so node identity is unreliable.
      const stayed = !active || active === document.body || Boolean(active.closest(`[data-note-composer="${headingId}"]`));
      if (stayed) composer.current?.focus({ preventScroll: true });
    });
  }

  async function add() {
    const body = draft.trim();
    if (!body || adding) return;
    setAdding(true);
    setFailure(null);
    setLinkProblem(null);
    try {
      const result = await request(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      }, "Could not save the note.");
      if (!result?.note) throw new Error("Could not save the note.");
      const note = result.note;
      setNotes(current => [note, ...current.filter(existing => existing.id !== note.id)]);
      setDraft("");
      setHighlight(note.id);
      announce("Note added");
    } catch (cause) {
      setFailure({ noteId: null, action: "add", message: cause instanceof Error ? cause.message : "Could not save the note." });
    } finally {
      setAdding(false);
      restoreComposerFocus();
    }
  }

  async function saveEdit() {
    if (!editing || saving) return;
    const body = editing.body.trim();
    const original = notes.find(note => note.id === editing.id);
    if (!body) return;
    if (original && original.body === body) {
      setEditing(null);
      restoreNoteFocus(editing.id);
      return;
    }
    setSaving(editing.id);
    setFailure(null);
    try {
      const result = await request(`${endpoint}/${encodeURIComponent(editing.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      }, "Could not save your changes.");
      if (!result?.note) throw new Error("Could not save your changes.");
      const note = result.note;
      setNotes(current => current.map(existing => existing.id === note.id ? note : existing));
      setEditing(null);
      announce("Note saved");
      restoreNoteFocus(note.id);
    } catch (cause) {
      setFailure({ noteId: editing.id, action: "edit", message: cause instanceof Error ? cause.message : "Could not save your changes." });
    } finally {
      setSaving(null);
    }
  }

  async function remove(noteId: string) {
    if (deleting) return;
    setDeleting(noteId);
    setFailure(null);
    try {
      await request(`${endpoint}/${encodeURIComponent(noteId)}`, { method: "DELETE" }, "Could not delete the note.");
      const index = notes.findIndex(note => note.id === noteId);
      const next = notes[index + 1] ?? notes[index - 1];
      setNotes(current => current.filter(note => note.id !== noteId));
      setConfirming(null);
      announce("Note deleted");
      // Keep keyboard users in the list rather than dropping focus to the page.
      window.requestAnimationFrame(() => {
        const target = next ? document.getElementById(noteAnchor(next.id)) : composer.current;
        target?.focus({ preventScroll: false });
      });
    } catch (cause) {
      setFailure({ noteId, action: "delete", message: cause instanceof Error ? cause.message : "Could not delete the note." });
    } finally {
      setDeleting(null);
    }
  }

  async function copyLink(noteId: string) {
    const url = `${window.location.origin}${notePermalink(personId, noteId)}`;
    let message = "Link copied";
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      message = "Could not copy the link";
    }
    setCopyFeedback({ id: noteId, message });
    announce(message);
  }

  const visible = folds && !showAll ? notes.slice(0, VISIBLE_NOTES) : notes;
  const hidden = notes.length - VISIBLE_NOTES;
  const remaining = PERSON_NOTE_MAX_LENGTH - draft.length;
  const addFailure = failure?.action === "add" ? failure : null;
  // At rest the composer is one quiet line; its actions arrive with intent.
  const composing = composerFocused || draft.length > 0 || adding || Boolean(addFailure);

  return (
    <section aria-labelledby={headingId} className="scroll-mt-24" ref={section}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-base font-semibold" id={headingId}>Notes</h2>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground" id={scopeId}>
          <Users aria-hidden="true" className="size-3.5" />
          Shared with your workspace
        </span>
      </div>

      {linkProblem ? (
        <p className="mt-3 flex items-start gap-2 text-sm leading-6 text-muted-foreground text-pretty" role="status">
          <Link2Off aria-hidden="true" className="mt-[0.3125rem] size-3.5 shrink-0" />
          <span>
            {linkProblemCopy[linkProblem]}{" "}
            <button
              className={cn(HIT_TEXT, "ml-1 rounded-sm underline decoration-muted-foreground/40 underline-offset-4 outline-none hover:text-foreground hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50")}
              onClick={dismissLinkProblem}
              type="button"
            >
              Dismiss
            </button>
          </span>
        </p>
      ) : null}

      <form
        className="mt-3"
        data-composing={composing || undefined}
        data-note-composer={headingId}
        onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setComposerFocused(false);
        }}
        onFocus={() => setComposerFocused(true)}
        onSubmit={event => {
          event.preventDefault();
          void add();
        }}
      >
        <div
          className={cn(
            "rounded-lg border border-border bg-background px-3 py-2 transition-[border-color,box-shadow] duration-150",
            "focus-within:ring-2 focus-within:ring-ring/15",
            "data-[invalid=true]:border-destructive",
          )}
          data-invalid={Boolean(addFailure)}
        >
          <label className="sr-only" htmlFor={`${headingId}-composer`}>Add a note about {personName}</label>
          <textarea
            aria-busy={adding || undefined}
            aria-describedby={scopeId}
            aria-invalid={addFailure ? true : undefined}
            className="block max-h-[min(20rem,50dvh)] min-h-6 w-full resize-none border-0 bg-transparent p-0 text-base leading-6 outline-none field-sizing-content sm:text-sm placeholder:text-muted-foreground aria-busy:text-muted-foreground"
            id={`${headingId}-composer`}
            maxLength={PERSON_NOTE_MAX_LENGTH}
            onChange={event => {
              setDraft(event.target.value);
              if (addFailure) setFailure(null);
            }}
            onKeyDown={event => {
              if (submitShortcut(event)) {
                event.preventDefault();
                void add();
              }
            }}
            placeholder={`Add a note about ${firstName}…`}
            // Stays focusable while saving so focus and the caret are not lost.
            readOnly={adding}
            ref={composer}
            rows={1}
            value={draft}
          />
          {composing ? (
            <div className="mt-2 flex min-h-7 items-center justify-end gap-3">
              {remaining <= PERSON_NOTE_MAX_LENGTH - COUNT_FROM ? (
                <span aria-live="polite" className={cn("mr-auto text-xs tabular-nums text-muted-foreground", remaining === 0 && "text-destructive")}>
                  {remaining} left
                </span>
              ) : null}
              <span className="hidden text-xs text-muted-foreground sm:inline" aria-hidden="true">
                {draft.trim() && !adding ? shortcut : ""}
              </span>
              <Button aria-busy={adding || undefined} className={HIT_BUTTON} disabled={!draft.trim()} size="sm" type="submit">
                {adding ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                {adding ? "Saving" : "Add note"}
              </Button>
            </div>
          ) : null}
        </div>
        {addFailure ? (
          <p className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-destructive" role="alert">
            {addFailure.message}
            <button
              className={cn(HIT_TEXT, "rounded-sm underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50")}
              onClick={() => void add()}
              type="button"
            >
              Try again
            </button>
          </p>
        ) : null}
      </form>

      {notes.length ? (
        <ul className="mt-5 space-y-1" aria-label={`Notes about ${personName}`}>
          {visible.map(note => (
            <NoteItem
              confirming={confirming === note.id}
              copyFeedback={copyFeedback?.id === note.id ? copyFeedback.message : null}
              deleting={deleting === note.id}
              editing={editing?.id === note.id ? editing.body : null}
              expanded={Boolean(expanded[note.id])}
              failure={failure?.noteId === note.id ? failure : null}
              highlighted={highlight === note.id}
              key={note.id}
              note={note}
              onCancelDelete={() => {
                if (deleting) return;
                setConfirming(null);
                if (failure?.noteId === note.id) setFailure(null);
                restoreNoteFocus(note.id);
              }}
              onCancelEdit={() => {
                if (saving) return;
                setEditing(null);
                if (failure?.noteId === note.id) setFailure(null);
                restoreNoteFocus(note.id);
              }}
              onChangeEdit={body => setEditing({ id: note.id, body })}
              onConfirmDelete={() => void remove(note.id)}
              onCopyLink={() => void copyLink(note.id)}
              onDelete={() => {
                setEditing(null);
                setFailure(null);
                setConfirming(note.id);
              }}
              onEdit={() => {
                setConfirming(null);
                setFailure(null);
                setEditing({ id: note.id, body: note.body });
              }}
              onSaveEdit={() => void saveEdit()}
              onToggleExpanded={() => setExpanded(current => ({ ...current, [note.id]: !current[note.id] }))}
              permalink={notePermalink(personId, note.id)}
              saving={saving === note.id}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-3 max-w-[52ch] text-sm leading-6 text-muted-foreground text-pretty">
          No notes yet. Add context the team should know before meeting {firstName}.
        </p>
      )}

      {folds ? (
        <button
          aria-expanded={showAll}
          className={cn(HIT_TEXT, "mt-3 rounded-sm text-sm text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 outline-none hover:text-foreground hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50")}
          onClick={() => setShowAll(value => !value)}
          type="button"
        >
          {showAll ? "Show fewer" : `Show ${hidden} older notes`}
        </button>
      ) : null}

      <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">{announcement}</p>
    </section>
  );
}

function NoteItem({
  note, permalink, editing, saving, confirming, deleting, highlighted, expanded, failure, copyFeedback,
  onEdit, onChangeEdit, onSaveEdit, onCancelEdit, onDelete, onConfirmDelete, onCancelDelete, onCopyLink, onToggleExpanded,
}: {
  note: PersonNote;
  permalink: string;
  editing: string | null;
  saving: boolean;
  confirming: boolean;
  deleting: boolean;
  highlighted: boolean;
  expanded: boolean;
  failure: Failure | null;
  copyFeedback: string | null;
  onEdit: () => void;
  onChangeEdit: (body: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onCopyLink: () => void;
  onToggleExpanded: () => void;
}) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const isEditing = editing !== null;
  const edited = new Date(note.updatedAt).getTime() - new Date(note.createdAt).getTime() > 1000;
  const date = useLocal(() => formatNoteDate(note.createdAt), "");
  const editedAt = useLocal(() => (edited ? `Edited ${formatNoteDateTime(note.updatedAt)}` : ""), "");
  const long = note.body.length > FOLD_CHARS || note.body.split("\n").length > FOLD_LINES;

  useEffect(() => {
    if (!isEditing) return;
    // Wait for the actions menu to finish restoring focus to its trigger.
    const timer = window.setTimeout(() => {
      const node = editor.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isEditing]);

  useEffect(() => autosize(editor.current), [editing]);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => cancelDelete.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  return (
    <li
      className={cn(
        "group/note -mx-3 scroll-mt-24 rounded-lg px-3 py-3 outline-none transition-[background-color,opacity] duration-500 ease-out motion-reduce:transition-none",
        // Focus lands here after a permalink, edit or delete; a quiet fill marks it.
        "focus-visible:bg-muted/60",
        highlighted && "bg-muted/70 duration-150",
        deleting && "opacity-60",
      )}
      id={noteAnchor(note.id)}
      tabIndex={-1}
    >
      <div className="flex min-h-7 items-center gap-2.5">
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
          {initials(note.authorName)}
        </span>
        {/* The author truncates first; the date and Edited always stay readable. */}
        <p className="flex min-w-0 items-baseline gap-1.5 text-sm">
          <span className="min-w-0 truncate font-medium">{note.authorName}</span>
          <span className="flex shrink-0 items-baseline gap-1.5 text-muted-foreground">
            <span aria-hidden="true">·</span>
            <a
              aria-label={date ? `${date}, link to this note` : "Link to this note"}
              className={cn(HIT_TEXT, "rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50")}
              href={permalink}
              title="Link to this note"
            >
              <NoteDate value={note.createdAt} />
            </a>
            {edited ? (
              <>
                <span aria-hidden="true">·</span>
                <span title={editedAt || undefined}>Edited</span>
              </>
            ) : null}
          </span>
        </p>
        {!isEditing && !confirming ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={`Note actions, ${note.authorName}`}
                  className={cn(
                    HIT_ICON,
                    "ml-auto text-muted-foreground transition-opacity",
                    // Hide until hover only where hover exists; touch always shows it.
                    "[@media(hover:hover)_and_(pointer:fine)]:opacity-0",
                    "[@media(hover:hover)_and_(pointer:fine)]:group-hover/note:opacity-100",
                    "[@media(hover:hover)_and_(pointer:fine)]:group-focus-within/note:opacity-100",
                    "[@media(hover:hover)_and_(pointer:fine)]:aria-expanded:opacity-100",
                  )}
                  disabled={deleting}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                />
              }
            >
              <MoreHorizontal aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-36">
              <DropdownMenuItem onClick={onCopyLink}><Link2 aria-hidden="true" />Copy link</DropdownMenuItem>
              {note.canEdit ? (
                <>
                  <DropdownMenuItem onClick={onEdit}><Pencil aria-hidden="true" />Edit</DropdownMenuItem>
                  <DropdownMenuItem onClick={onDelete} variant="destructive"><Trash2 aria-hidden="true" />Delete</DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div className="pl-[2.375rem]">
        {isEditing ? (
          <form
            className="mt-2"
            onSubmit={event => {
              event.preventDefault();
              onSaveEdit();
            }}
          >
            <div
              className="rounded-lg border border-border bg-background px-3 py-2 transition-[border-color,box-shadow] duration-150 focus-within:ring-2 focus-within:ring-ring/15 data-[invalid=true]:border-destructive"
              data-invalid={Boolean(failure)}
            >
              <textarea
                aria-busy={saving || undefined}
                aria-invalid={failure ? true : undefined}
                aria-label="Edit note"
                className="block max-h-[min(24rem,60dvh)] min-h-12 w-full resize-none border-0 bg-transparent p-0 text-base leading-6 outline-none field-sizing-content sm:text-sm aria-busy:text-muted-foreground"
                maxLength={PERSON_NOTE_MAX_LENGTH}
                onChange={event => onChangeEdit(event.target.value)}
                onKeyDown={event => {
                  if (submitShortcut(event)) {
                    event.preventDefault();
                    onSaveEdit();
                  } else if (event.key === "Escape" && !event.nativeEvent.isComposing && !saving) {
                    event.preventDefault();
                    onCancelEdit();
                  }
                }}
                readOnly={saving}
                ref={editor}
                value={editing}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
              {PERSON_NOTE_MAX_LENGTH - editing.length <= PERSON_NOTE_MAX_LENGTH - COUNT_FROM ? (
                <span className="mr-auto text-xs tabular-nums text-muted-foreground">{PERSON_NOTE_MAX_LENGTH - editing.length} left</span>
              ) : null}
              <Button aria-disabled={saving || undefined} className={cn(HIT_BUTTON, "aria-disabled:opacity-50")} onClick={onCancelEdit} size="sm" type="button" variant="ghost">Cancel</Button>
              <Button aria-busy={saving || undefined} className={HIT_BUTTON} disabled={!editing.trim()} size="sm" type="submit">
                {saving ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                {saving ? "Saving" : failure ? "Try again" : "Save"}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <p
              className={cn(
                "mt-1 max-w-[60ch] whitespace-pre-wrap break-words text-sm leading-6 text-pretty",
                long && !expanded && "line-clamp-6",
              )}
            >
              {note.body}
            </p>
            {long ? (
              <button
                aria-expanded={expanded}
                className={cn(HIT_TEXT, "mt-1 rounded-sm text-xs text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 outline-none hover:text-foreground hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50")}
                onClick={onToggleExpanded}
                type="button"
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            ) : null}
          </>
        )}

        {confirming ? (
          <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Confirm delete">
            <p className="mr-auto text-sm text-muted-foreground">Delete this note for everyone?</p>
            <Button aria-disabled={deleting || undefined} className={cn(HIT_BUTTON, "aria-disabled:opacity-50")} onClick={onCancelDelete} ref={cancelDelete} size="sm" type="button" variant="ghost">Cancel</Button>
            <Button aria-busy={deleting || undefined} className={HIT_BUTTON} onClick={onConfirmDelete} size="sm" type="button" variant="destructive">
              {deleting ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              {deleting ? "Deleting" : failure?.action === "delete" ? "Try again" : "Delete"}
            </Button>
          </div>
        ) : null}

        {copyFeedback ? <span aria-hidden="true" className="mt-2 block text-xs text-muted-foreground">{copyFeedback}</span> : null}
        {failure && failure.action !== "add" ? (
          <p className="mt-2 text-sm text-destructive" role="alert">{failure.message}</p>
        ) : null}
      </div>
    </li>
  );
}
