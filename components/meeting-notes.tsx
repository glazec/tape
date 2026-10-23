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
import {
  MeetingNoteAnswer,
  type NoteTranscript,
} from "@/components/meeting-note-answer";
import { useMeetingNote } from "@/components/use-meeting-note";
import {
  noteContent,
  noteQuestion,
  type NoteAnswer,
  type NoteBlock,
} from "@/lib/meeting-note-document";

// Enter after a question starts a new writing block. Preserve the exact text.
function splitAfterQuestions(text: string) {
  const chunks: string[] = [];
  let current = "";
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    current += line;
    if (index < lines.length - 1) {
      if (noteQuestion(line)) {
        chunks.push(current);
        current = "";
      } else current += "\n";
    }
  });
  chunks.push(current);
  return chunks;
}

export function MeetingNotes({
  meetingId,
  userId,
}: {
  meetingId: string;
  userId: string;
}) {
  const { blocks, change, status, loaded, save, reload, retry } =
    useMeetingNote(meetingId, userId);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [answerDrafts, setAnswerDrafts] = useState<Set<string>>(new Set());
  const [composing, setComposing] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<NoteTranscript | null>(null);
  const [transcriptError, setTranscriptError] = useState(false);
  const headingId = useId();
  const privacyId = useId();
  const hintId = useId();
  const editors = useRef(new Map<string, HTMLTextAreaElement>());
  const copyFallback = useRef<HTMLTextAreaElement>(null);
  const pendingFocus = useRef<{ id: string; position: number } | null>(null);
  const blocksRef = useRef(blocks);
  const metadataRequest = useRef<AbortController | null>(null);
  const answerUrl = `/api/meetings/${encodeURIComponent(meetingId)}/notes/answer`;
  const content = noteContent(blocks);
  const hasQuestions = blocks.some(
    (block) => noteQuestion(block.text) || block.answer,
  );
  const hasAnswer = blocks.some((block) => block.answer);
  const canEnhance = loaded && status !== "conflict" && status !== "error";
  const copyText = blocks
    .map((block) => [block.text, block.answer?.text].filter(Boolean).join("\n"))
    .join("\n");

  useLayoutEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  const refreshTranscript = useCallback(async () => {
    metadataRequest.current?.abort();
    const controller = new AbortController();
    metadataRequest.current = controller;
    try {
      const response = await fetch(answerUrl, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Transcript unavailable");
      const next = await response.json();
      if (controller.signal.aborted) return;
      if (
        typeof next.transcriptRevision !== "string" ||
        typeof next.hasTranscript !== "boolean"
      )
        throw new Error("Invalid transcript metadata");
      setTranscript((old) =>
        old?.transcriptRevision === next.transcriptRevision &&
        old?.hasTranscript === next.hasTranscript
          ? old
          : next,
      );
      setTranscriptError(false);
    } catch {
      if (!controller.signal.aborted) setTranscriptError(true);
    }
  }, [answerUrl]);

  useEffect(() => {
    if (!hasQuestions || !loaded) return;
    // Refresh external transcript metadata after the note has loaded.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshTranscript();
    const check = () => {
      if (document.visibilityState === "visible") void refreshTranscript();
    };
    const timer = setInterval(check, 30_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      metadataRequest.current?.abort();
    };
  }, [hasQuestions, loaded, refreshTranscript]);

  const resizeEditors = useCallback(() => {
    editors.current.forEach((editor) => {
      const scrollTop = editor.scrollTop;
      editor.style.height = "0px";
      editor.style.height = `${editor.scrollHeight}px`;
      editor.scrollTop = scrollTop;
    });
  }, []);
  useLayoutEffect(() => {
    resizeEditors();
    const target = pendingFocus.current;
    if (target) {
      const editor = editors.current.get(target.id);
      editor?.focus({ preventScroll: true });
      editor?.setSelectionRange(target.position, target.position);
      editor?.scrollIntoView?.({ block: "nearest" });
      pendingFocus.current = null;
    }
  }, [blocks, loaded, resizeEditors]);
  useEffect(() => {
    window.addEventListener("resize", resizeEditors);
    return () => window.removeEventListener("resize", resizeEditors);
  }, [resizeEditors]);
  useEffect(() => {
    if (copyStatus !== "error") return;
    const editor = copyFallback.current ?? editors.current.get(blocks[0].id);
    editor?.focus();
    editor?.select();
  }, [blocks, copyStatus]);

  const onEditingChange = useCallback((id: string, dirty: boolean) => {
    setAnswerDrafts((previous) => {
      if (previous.has(id) === dirty) return previous;
      const next = new Set(previous);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const onAnswer = useCallback(
    (id: string, question: string, answer: NoteAnswer) => {
      let accepted = false;
      change((current) => {
        const next = current.map((block) =>
          block.id === id &&
          (noteQuestion(block.text) ?? block.text) === question
            ? { ...block, answer }
            : block,
        );
        if (JSON.stringify(next).length > 200_000) return current;
        accepted = next.some(
          (block) => block.id === id && block.answer === answer,
        );
        return next;
      });
      return accepted;
    },
    [change],
  );

  const removeAnswer = useCallback(
    (id: string) => {
      change((current) =>
        current.map((block) =>
          block.id === id && !noteQuestion(block.text)
            ? { id: block.id, text: block.text }
            : block,
        ),
      );
    },
    [change],
  );

  function updateText(
    id: string,
    text: string,
    cursor: number,
    isComposing = false,
  ) {
    const current = blocksRef.current;
    const block = current.find((item) => item.id === id);
    if (
      !block ||
      noteContent(current).length - block.text.length + text.length > 20_000
    )
      return;
    const parts = isComposing ? [text] : splitAfterQuestions(text);
    if (current.length + parts.length - 1 > 100) return;
    const answerIndex = block.answer
      ? Math.max(
          0,
          parts.findIndex(
            (part) => noteQuestion(part) === block.answer?.question,
          ),
        )
      : -1;
    const next: NoteBlock[] = parts.map((part, index) => ({
      id: index === Math.max(0, answerIndex) ? id : crypto.randomUUID(),
      text: part,
      ...(index === answerIndex && block.answer
        ? { answer: block.answer }
        : {}),
    }));
    if (parts.length > 1) {
      let offset = 0;
      for (let index = 0; index < parts.length; index++) {
        if (
          cursor <= offset + parts[index].length ||
          index === parts.length - 1
        ) {
          pendingFocus.current = {
            id: next[index].id,
            position: Math.max(0, cursor - offset),
          };
          break;
        }
        offset += parts[index].length + 1;
      }
    }
    const updated = current.flatMap((item) => (item.id === id ? next : [item]));
    if (JSON.stringify(updated).length > 200_000) return;
    change(updated);
    setCopyStatus("idle");
  }

  async function copyEdits() {
    const captured = JSON.stringify(blocks);
    try {
      await navigator.clipboard.writeText(copyText);
      if (JSON.stringify(blocksRef.current) === captured)
        setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
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
          {answerDrafts.size > 0 ? (
            "Editing answer…"
          ) : status === "loading" ? (
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
      <div className="relative max-h-[min(32rem,65dvh)] overflow-y-auto overscroll-contain pr-1">
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
        {blocks.map((block, index) => (
          <div key={block.id}>
            <textarea
              ref={(node) => {
                if (node) editors.current.set(block.id, node);
                else editors.current.delete(block.id);
              }}
              aria-label={index === 0 ? "My notes" : `Note ${index + 1}`}
              aria-describedby={`${privacyId} ${hintId}`}
              aria-busy={status === "loading"}
              className={`block max-h-[min(24rem,60dvh)] w-full resize-none border-0 bg-transparent p-0 text-base leading-7 outline-none placeholder:text-muted-foreground disabled:text-muted-foreground ${blocks.length === 1 && !hasQuestions ? "min-h-36" : "min-h-7"}`}
              disabled={!loaded}
              maxLength={20_000 - content.length + block.text.length}
              onBlur={() => void save()}
              onCompositionStart={() => setComposing(block.id)}
              onCompositionEnd={(event) => {
                setComposing(null);
                updateText(
                  block.id,
                  event.currentTarget.value,
                  event.currentTarget.selectionStart,
                );
              }}
              onChange={(event) =>
                updateText(
                  block.id,
                  event.target.value,
                  event.target.selectionStart,
                  composing === block.id,
                )
              }
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || composing === block.id)
                  return;
                const editor = event.currentTarget;
                if (
                  event.key === "Backspace" &&
                  editor.selectionStart === 0 &&
                  editor.selectionEnd === 0 &&
                  index > 0
                ) {
                  event.preventDefault();
                  const previous = blocks[index - 1];
                  if (!previous.answer && !noteQuestion(previous.text)) {
                    pendingFocus.current = {
                      id: previous.id,
                      position: previous.text.length,
                    };
                    change(
                      blocks.flatMap((item) =>
                        item.id === previous.id
                          ? [
                              {
                                ...previous,
                                text: previous.text + block.text,
                                ...(block.answer
                                  ? { answer: block.answer }
                                  : {}),
                              },
                            ]
                          : item.id === block.id
                            ? []
                            : [item],
                      ),
                    );
                  } else {
                    const target = editors.current.get(previous.id);
                    target?.focus();
                    target?.setSelectionRange(
                      previous.text.length,
                      previous.text.length,
                    );
                    if (!block.text && !block.answer)
                      change(blocks.filter((item) => item.id !== block.id));
                  }
                }
              }}
              placeholder={
                loaded
                  ? index === 0
                    ? "Capture ideas, questions, and next steps…"
                    : "Keep taking notes…"
                  : ""
              }
              rows={1}
              value={block.text}
            />
            {loaded ? (
              <MeetingNoteAnswer
                block={block}
                url={answerUrl}
                transcript={transcript}
                transcriptError={transcriptError}
                refreshTranscript={refreshTranscript}
                enabled={canEnhance}
                composing={composing === block.id}
                onAnswer={onAnswer}
                onRemoveAnswer={removeAnswer}
                editDraftKey={`meeting-notes-answer:${userId}:${meetingId}:${block.id}`}
                onEditingChange={onEditingChange}
              />
            ) : null}
          </div>
        ))}
        {loaded &&
        (blocks.at(-1)?.answer || noteQuestion(blocks.at(-1)?.text ?? "")) ? (
          <button
            className="mt-1 min-h-11 w-full text-left text-base leading-7 text-muted-foreground outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring/30"
            onClick={() => {
              if (blocks.length >= 100 || content.length >= 20_000) return;
              const next = { id: crypto.randomUUID(), text: "" };
              pendingFocus.current = { id: next.id, position: 0 };
              change([...blocks, next]);
            }}
          >
            Keep taking notes…
          </button>
        ) : null}
      </div>
      <p
        id={hintId}
        className={
          hasAnswer ? "sr-only" : "mt-3 text-xs leading-5 text-muted-foreground"
        }
      >
        End a question with ? to find an answer in this transcript.
      </p>
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
          <Button className="min-h-11" onClick={retry} variant="outline">
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
            <>
              <p className="text-sm text-destructive" role="alert">
                Could not copy automatically. Your edits are selected so you can
                copy them.
              </p>
              {blocks.length > 1 || hasAnswer ? (
                <textarea
                  ref={copyFallback}
                  aria-label="Copy your notes"
                  readOnly
                  value={copyText}
                  className="min-h-28 w-full rounded border p-2 text-sm"
                />
              ) : null}
            </>
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
              onClick={() => {
                setReplaceOpen(false);
                setCopyStatus("idle");
                blocks.forEach((block) => {
                  try {
                    sessionStorage.removeItem(
                      `meeting-notes-answer:${userId}:${meetingId}:${block.id}`,
                    );
                  } catch {
                    /* Storage is optional. */
                  }
                });
                reload();
              }}
            >
              Load saved notes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
