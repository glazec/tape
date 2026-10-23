"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  normalizeNoteBlocks,
  noteContent,
  noteBlockSchema,
  type NoteBlock,
} from "@/lib/meeting-note-document";

type Note = { content: string; version: number; blocks: NoteBlock[] };
type Status =
  | "loading"
  | "idle"
  | "unsaved"
  | "saving"
  | "saved"
  | "error"
  | "conflict";
const sameBlocks = (a: NoteBlock[], b: NoteBlock[]) =>
  JSON.stringify(a) === JSON.stringify(b);
function readNote(note: {
  content: string;
  version: number;
  blocks?: NoteBlock[] | null;
}): Note {
  const parsed = noteBlockSchema.array().min(1).max(100).safeParse(note.blocks);
  return {
    ...note,
    blocks: normalizeNoteBlocks(
      note.content,
      parsed.success ? parsed.data : undefined,
    ),
  };
}

export function useMeetingNote(meetingId: string, userId: string) {
  const [blocks, setBlocks] = useState<NoteBlock[]>([
    { id: "legacy", text: "" },
  ]);
  const [status, setStatus] = useState<Status>("loading");
  const [loaded, setLoaded] = useState(false);
  const draft = useRef<NoteBlock[]>([{ id: "legacy", text: "" }]);
  const saved = useRef<Note | null>(null);
  const draftVersion = useRef(0);
  const saving = useRef(false);
  const conflict = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const url = `/api/meetings/${encodeURIComponent(meetingId)}/notes`;
  const draftKey = `meeting-notes:${userId}:${meetingId}`;

  const retainDraft = useCallback(() => {
    try {
      if (saved.current && !sameBlocks(draft.current, saved.current.blocks)) {
        sessionStorage.setItem(
          draftKey,
          JSON.stringify({
            content: noteContent(draft.current),
            blocks: draft.current,
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
        const note = readNote(await response.json());
        if (signal?.aborted) return;
        let recovered: Note | null = null;
        try {
          const stored = JSON.parse(sessionStorage.getItem(draftKey) ?? "null");
          if (
            stored &&
            typeof stored.content === "string" &&
            Number.isInteger(stored.version)
          ) {
            recovered = readNote(stored);
          }
        } catch {
          // Browser storage is optional.
        }
        saved.current = note;
        draftVersion.current =
          recovered && !sameBlocks(recovered.blocks, note.blocks)
            ? recovered.version
            : note.version;
        draft.current = recovered?.blocks ?? note.blocks;
        conflict.current = Boolean(
          recovered &&
          !sameBlocks(recovered.blocks, note.blocks) &&
          recovered.version !== note.version,
        );
        retainDraft();
        setBlocks(draft.current);
        setLoaded(true);
        setStatus(
          conflict.current
            ? "conflict"
            : sameBlocks(draft.current, note.blocks)
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
      while (!sameBlocks(draft.current, saved.current.blocks)) {
        setStatus("saving");
        const next: Note = {
          content: noteContent(draft.current),
          blocks: draft.current,
          version: saved.current.version,
        };
        const response: Response = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
          keepalive:
            new TextEncoder().encode(JSON.stringify(next)).length < 60_000,
        });
        if (response.status === 409) {
          conflict.current = true;
          setStatus("conflict");
          return;
        }
        if (!response.ok) throw new Error("Could not save notes");
        const result: Note = await response.json();
        saved.current = {
          ...readNote(result),
          blocks: result.blocks ?? next.blocks,
        };
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
  }, [blocks, loaded, save, status]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saved.current && !sameBlocks(draft.current, saved.current.blocks)) {
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

  const change = useCallback(
    (next: NoteBlock[] | ((current: NoteBlock[]) => NoteBlock[])) => {
      draft.current = typeof next === "function" ? next(draft.current) : next;
      setBlocks(draft.current);
      retainDraft();
      if (!conflict.current) setStatus("unsaved");
    },
    [retainDraft],
  );

  function reload() {
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      /* Storage is optional. */
    }
    setStatus("loading");
    setLoaded(false);
    void load();
  }

  function retry() {
    if (loaded) void save();
    else {
      setStatus("loading");
      void load();
    }
  }

  return { blocks, change, status, loaded, save, reload, retry };
}
