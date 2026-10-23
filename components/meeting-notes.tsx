"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Check, Copy, LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

type Note = { content: string; version: number };
type Status =
  | "loading"
  | "idle"
  | "unsaved"
  | "saving"
  | "saved"
  | "error"
  | "conflict";

export function MeetingNotes({
  meetingId,
  userId,
}: {
  meetingId: string;
  userId: string;
}) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [loaded, setLoaded] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const headingId = useId();
  const privacyId = useId();
  const editor = useRef<HTMLTextAreaElement>(null);
  const draft = useRef("");
  const saved = useRef<Note | null>(null);
  const draftVersion = useRef(0);
  const saving = useRef(false);
  const conflict = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const url = `/api/meetings/${encodeURIComponent(meetingId)}/notes`;
  const draftKey = `meeting-notes:${userId}:${meetingId}`;

  const retainDraft = useCallback(() => {
    try {
      if (saved.current && draft.current !== saved.current.content) {
        sessionStorage.setItem(
          draftKey,
          JSON.stringify({
            content: draft.current,
            version: draftVersion.current,
          }),
        );
      } else {
        sessionStorage.removeItem(draftKey);
      }
    } catch {
      // Saving to the server still works when browser storage is unavailable.
    }
  }, [draftKey]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch(url, { cache: "no-store", signal });
        if (!response.ok) throw new Error("Could not load notes");
        const note: Note = await response.json();
        if (signal?.aborted) return;
        let recovered: Note | null = null;
        try {
          const stored = JSON.parse(sessionStorage.getItem(draftKey) ?? "null");
          if (
            stored &&
            typeof stored.content === "string" &&
            Number.isInteger(stored.version)
          ) {
            recovered = stored;
          }
        } catch {
          // Browser storage is optional.
        }
        saved.current = note;
        draftVersion.current =
          recovered && recovered.content !== note.content
            ? recovered.version
            : note.version;
        draft.current = recovered?.content ?? note.content;
        conflict.current = Boolean(
          recovered &&
          recovered.content !== note.content &&
          recovered.version !== note.version,
        );
        retainDraft();
        setContent(draft.current);
        setLoaded(true);
        setStatus(
          conflict.current
            ? "conflict"
            : draft.current === note.content
              ? note.content
                ? "saved"
                : "idle"
              : "unsaved",
        );
      } catch {
        if (!signal?.aborted) setStatus("error");
      }
    },
    [draftKey, retainDraft, url],
  );

  const save = useCallback(async () => {
    if (!saved.current || saving.current || conflict.current) return;
    saving.current = true;
    try {
      while (draft.current !== saved.current.content) {
        setStatus("saving");
        const next = { content: draft.current, version: saved.current.version };
        const response = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
          keepalive: true,
        });
        if (response.status === 409) {
          conflict.current = true;
          setStatus("conflict");
          return;
        }
        if (!response.ok) throw new Error("Could not save notes");
        saved.current = (await response.json()) as Note;
        draftVersion.current = saved.current.version;
        retainDraft();
      }
      setStatus("saved");
    } catch {
      setStatus("error");
    } finally {
      saving.current = false;
    }
  }, [retainDraft, url]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!loaded || status !== "unsaved") return;
    timer.current = setTimeout(() => void save(), 700);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [content, loaded, save, status]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saved.current && draft.current !== saved.current.content) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") void save();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void save();
    };
  }, [save]);

  const resizeEditor = useCallback(() => {
    if (!editor.current) return;
    const scrollTop = editor.current.scrollTop;
    editor.current.style.height = "0px";
    editor.current.style.height = `${editor.current.scrollHeight}px`;
    editor.current.scrollTop = scrollTop;
  }, []);

  useLayoutEffect(resizeEditor, [content, loaded, resizeEditor]);

  useEffect(() => {
    window.addEventListener("resize", resizeEditor);
    return () => window.removeEventListener("resize", resizeEditor);
  }, [resizeEditor]);

  async function copyEdits() {
    const copiedContent = draft.current;
    try {
      await navigator.clipboard.writeText(copiedContent);
      if (draft.current === copiedContent) setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
      editor.current?.focus();
      editor.current?.select();
    }
  }

  function loadSavedNotes() {
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      // Browser storage is optional.
    }
    setReplaceOpen(false);
    setStatus("loading");
    setLoaded(false);
    setCopyStatus("idle");
    void load();
  }

  return (
    <section
      aria-labelledby={headingId}
      className="mb-8 rounded-xl border border-border/80 bg-card p-4 transition-[border-color,box-shadow] has-[textarea:focus-visible]:border-ring/60 has-[textarea:focus-visible]:ring-2 has-[textarea:focus-visible]:ring-ring/15 motion-reduce:transition-none sm:p-5"
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold tracking-tight">
            My notes
          </h2>
          <p
            id={privacyId}
            className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <LockKeyhole aria-hidden="true" className="size-3 shrink-0" />
            Only visible to you
          </p>
        </div>
        <span
          aria-live="polite"
          role="status"
          className="flex min-h-6 min-w-16 shrink-0 items-center justify-end gap-1.5 text-xs text-muted-foreground"
        >
          {status === "loading" ? (
            "Loading…"
          ) : status === "saving" ? (
            "Saving…"
          ) : status === "saved" ? (
            <>
              <Check aria-hidden="true" className="size-3.5" />
              Saved
            </>
          ) : status === "unsaved" ? (
            <span className="sr-only">Unsaved changes</span>
          ) : (
            ""
          )}
        </span>
      </div>
      <div className="relative">
        {status === "loading" ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-2 space-y-4"
          >
            <div className="h-2.5 w-3/4 rounded bg-muted" />
            <div className="h-2.5 w-1/2 rounded bg-muted" />
            <div className="h-2.5 w-2/3 rounded bg-muted" />
          </div>
        ) : null}
        <textarea
          ref={editor}
          aria-labelledby={headingId}
          aria-describedby={privacyId}
          aria-busy={status === "loading"}
          className="block min-h-36 max-h-[min(24rem,60dvh)] w-full resize-none border-0 bg-transparent p-0 text-base leading-7 outline-none placeholder:text-muted-foreground disabled:text-muted-foreground"
          disabled={!loaded}
          maxLength={20_000}
          onBlur={() => void save()}
          onChange={(event) => {
            draft.current = event.target.value;
            setContent(draft.current);
            setCopyStatus("idle");
            retainDraft();
            if (!conflict.current) setStatus("unsaved");
          }}
          placeholder={
            loaded ? "Capture ideas, questions, and next steps…" : ""
          }
          rows={5}
          value={content}
        />
      </div>
      {content.length >= 19_000 ? (
        <p
          className="mt-3 text-right text-xs tabular-nums text-muted-foreground"
          role="status"
        >
          {(20_000 - content.length).toLocaleString()} characters remaining
        </p>
      ) : null}
      {status === "error" ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t pt-3">
          <p className="text-sm text-destructive" role="alert">
            {loaded
              ? "Could not save. Your edits are still here."
              : "Could not load your notes."}
          </p>
          <Button
            className="min-h-11"
            onClick={() => {
              if (loaded) void save();
              else {
                setStatus("loading");
                void load();
              }
            }}
            variant="outline"
          >
            Retry
          </Button>
        </div>
      ) : null}
      {status === "conflict" ? (
        <div className="mt-4 space-y-3 border-t pt-4">
          <p className="text-sm leading-6 text-muted-foreground" role="alert">
            A newer version was saved in another tab. Your edits are still here.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              variant="outline"
              onClick={() => void copyEdits()}
            >
              {copyStatus === "copied" ? (
                <Check aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
              {copyStatus === "copied" ? "Copied" : "Copy my edits"}
            </Button>
            <Button
              className="min-h-11"
              variant="ghost"
              onClick={() => setReplaceOpen(true)}
            >
              Load saved notes
            </Button>
          </div>
          {copyStatus === "error" ? (
            <p className="text-sm text-destructive" role="alert">
              Could not copy automatically. Your edits are selected so you can
              copy them.
            </p>
          ) : null}
          <span className="sr-only" role="status">
            {copyStatus === "copied"
              ? "Your edits were copied to the clipboard."
              : ""}
          </span>
        </div>
      ) : null}
      <Dialog open={replaceOpen} onOpenChange={setReplaceOpen}>
        <DialogContent>
          <DialogTitle>Load the saved version?</DialogTitle>
          <DialogDescription className="mt-2">
            This replaces the edits shown here. Copy anything you want to keep
            first.
          </DialogDescription>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <DialogClose
              render={<Button className="min-h-11" variant="outline" />}
            >
              Keep my edits
            </DialogClose>
            <Button
              className="min-h-11"
              variant="destructive"
              onClick={loadSavedNotes}
            >
              Load saved notes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
