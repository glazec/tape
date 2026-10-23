"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ArrowUpRight, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  noteQuestion,
  type NoteAnswer,
  type NoteBlock,
} from "@/lib/meeting-note-document";

export type NoteTranscript = {
  transcriptRevision: string;
  hasTranscript: boolean;
};
type AnswerState = {
  key: string;
  kind: "loading" | "error" | "idle";
  message?: string;
  retryable?: boolean;
};

export function MeetingNoteAnswer({
  block,
  url,
  transcript,
  transcriptError,
  refreshTranscript,
  enabled,
  composing,
  onAnswer,
  onRemoveAnswer,
  editDraftKey,
  onEditingChange,
}: {
  block: NoteBlock;
  url: string;
  transcript: NoteTranscript | null;
  transcriptError: boolean;
  refreshTranscript: () => void;
  enabled: boolean;
  composing: boolean;
  onAnswer: (id: string, question: string, answer: NoteAnswer) => boolean;
  onRemoveAnswer: (id: string) => void;
  editDraftKey: string;
  onEditingChange: (id: string, dirty: boolean) => void;
}) {
  const question = noteQuestion(block.text);
  const answer = block.answer;
  const key = `${question}:${transcript?.transcriptRevision}`;
  const [state, setState] = useState<AnswerState>({ key: "", kind: "idle" });
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [recoveredEdit, setRecoveredEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const restoreFocus = useRef(false);
  const restoredDraft = useRef(false);
  const editBase = useRef("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const request = useRef<AbortController | null>(null);
  const attempted = useRef<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const active = state.key === key ? state : null;
  const busy = active?.kind === "loading";
  const questionChanged = Boolean(answer && answer.question !== question);
  const transcriptChanged = Boolean(
    answer &&
    transcript &&
    answer.transcriptRevision !== transcript.transcriptRevision,
  );

  const generate = useCallback(async () => {
    if (!question || !transcript?.hasTranscript || !enabled || composing)
      return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    attempted.current = key;
    setState({ key, kind: "loading" });
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (result.code === "TRANSCRIPT_TOO_LONG") {
          setState({
            key,
            kind: "error",
            message: "This transcript is too long for automatic answers.",
            retryable: false,
          });
          return;
        }
        if (
          result.code === "TRANSCRIPT_PENDING" ||
          result.code === "TRANSCRIPT_CHANGED"
        ) {
          refreshTranscript();
          throw new Error(
            result.code === "TRANSCRIPT_PENDING"
              ? "The transcript is not ready yet."
              : "The transcript changed. Try again with the latest version.",
          );
        }
        throw new Error(
          response.status === 429
            ? "Too many requests. Wait a moment, then retry."
            : response.status === 402
              ? "Workspace credit is needed to answer this question."
              : "Could not answer. Your notes are safe.",
        );
      }
      if (
        result.question !== question ||
        result.transcriptRevision !== transcript.transcriptRevision
      ) {
        refreshTranscript();
        throw new Error(
          "The transcript changed. Try again with the latest version.",
        );
      }
      if (!onAnswer(block.id, question, result))
        throw new Error(
          "These notes are full. Shorten an existing answer before trying again.",
        );
      setState({ key, kind: "idle" });
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({
          key,
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not answer. Try again.",
        });
      }
    }
  }, [
    block.id,
    composing,
    enabled,
    key,
    onAnswer,
    question,
    refreshTranscript,
    transcript,
    url,
  ]);

  useEffect(() => {
    return () => {
      request.current?.abort();
      attempted.current = null;
    };
  }, [question, transcript?.transcriptRevision, enabled, composing]);

  useEffect(() => {
    if (
      !enabled ||
      composing ||
      editing ||
      !question ||
      !transcript?.hasTranscript ||
      answer?.edited ||
      answer?.question === question ||
      attempted.current === key
    )
      return;
    const timer = setTimeout(() => void generate(), 1200);
    return () => clearTimeout(timer);
  }, [
    answer?.edited,
    answer?.question,
    composing,
    editing,
    enabled,
    generate,
    key,
    question,
    transcript?.hasTranscript,
  ]);

  const dirty = editing && editText !== answer?.text;
  useEffect(() => {
    onEditingChange(block.id, dirty);
    return () => onEditingChange(block.id, false);
  }, [block.id, dirty, onEditingChange]);

  useEffect(() => {
    if (restoredDraft.current || !answer) return;
    restoredDraft.current = true;
    try {
      const stored = JSON.parse(sessionStorage.getItem(editDraftKey) ?? "null");
      if (
        stored &&
        typeof stored.text === "string" &&
        typeof stored.baseText === "string"
      ) {
        editBase.current = stored.baseText;
        // Browser drafts can only be restored after hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setEditText(stored.text);
        setRecoveredEdit(true);
        setEditing(true);
      }
    } catch {
      /* Draft recovery is optional. */
    }
  }, [answer, editDraftKey]);

  useEffect(() => {
    if (!editing) return;
    try {
      sessionStorage.setItem(
        editDraftKey,
        JSON.stringify({ text: editText, baseText: editBase.current }),
      );
    } catch {
      /* The navigation guard still protects unsaved edits. */
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, editDraftKey, editing, editText]);

  useLayoutEffect(() => {
    if (!editing && restoreFocus.current) {
      restoreFocus.current = false;
      editButton.current?.focus({ preventScroll: true });
    }
  }, [editing]);

  // Generation never moves focus. Only explicit editing controls return focus.
  function finishEditing() {
    try {
      sessionStorage.removeItem(editDraftKey);
    } catch {
      /* Storage is optional. */
    }
    restoreFocus.current = true;
    setEditing(false);
    setRecoveredEdit(false);
    setEditError("");
  }

  if (!question && !answer) return null;
  return (
    <div className="mb-5 ml-0.5 mt-2 border-l-2 border-border pl-3 sm:pl-4">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 text-xs text-muted-foreground">
        <span>{answer?.edited ? "Edited by you" : "From transcript"}</span>
        {answer && !editing ? (
          <div className="flex items-center gap-1">
            <Button
              ref={editButton}
              variant="ghost"
              size="sm"
              className="min-h-11 px-2 text-xs text-muted-foreground"
              disabled={busy || !enabled}
              onClick={() => {
                editBase.current = answer.text;
                setEditText(answer.text);
                setRecoveredEdit(false);
                setEditing(true);
              }}
            >
              Edit answer
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 gap-1.5 px-2 text-xs text-muted-foreground"
              disabled={
                !question || busy || !enabled || !transcript?.hasTranscript
              }
              onClick={() => {
                if (answer.edited) setConfirmOpen(true);
                else void generate();
              }}
            >
              <RotateCw className="size-3" aria-hidden="true" />
              {busy ? "Updating…" : "Regenerate"}
            </Button>
            {!question ? (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 px-2 text-xs"
                onClick={() => onRemoveAnswer(block.id)}
              >
                Remove answer
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {questionChanged || transcriptChanged ? (
        <p
          className="mb-2 text-xs leading-5 text-muted-foreground"
          role="status"
        >
          {questionChanged ? "Question changed." : "Transcript updated."}
          {answer?.edited
            ? " Your edited answer is kept until you regenerate."
            : " This answer is from the previous version."}
        </p>
      ) : null}
      {editing && answer ? (
        <div className="space-y-2 pb-1">
          {recoveredEdit ? (
            <p
              role="status"
              className="text-xs leading-5 text-muted-foreground"
            >
              Your unfinished answer edit was recovered. Review it before
              choosing Done.
            </p>
          ) : null}
          {editError ? (
            <p role="alert" className="text-sm text-destructive">
              {editError}
            </p>
          ) : null}
          <textarea
            aria-label="Edit answer"
            autoFocus
            value={editText}
            maxLength={6000}
            rows={Math.max(3, Math.min(10, editText.split("\n").length + 1))}
            className="w-full resize-y rounded-md border bg-transparent p-2 text-base leading-7 outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            onChange={(event) => setEditText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                finishEditing();
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={finishEditing}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={!editText.trim()}
              onClick={() => {
                if (
                  onAnswer(block.id, question ?? block.text, {
                    ...answer,
                    text: editText.trim(),
                    edited: true,
                  })
                )
                  finishEditing();
                else
                  setEditError(
                    "These notes are full. Shorten this answer to save your edits.",
                  );
              }}
            >
              Done
            </Button>
          </div>
        </div>
      ) : answer ? (
        <div className="max-w-prose whitespace-pre-wrap break-words text-sm leading-6">
          {answer.text}
        </div>
      ) : null}
      {!answer && busy ? (
        <p
          className="py-1 text-sm leading-6 text-muted-foreground"
          role="status"
        >
          Looking in transcript…
        </p>
      ) : null}
      {!answer && !busy && question && !active?.message ? (
        <p
          className="py-1 text-sm leading-6 text-muted-foreground"
          role="status"
        >
          {transcriptError
            ? "Could not check the transcript."
            : transcript && !transcript.hasTranscript
              ? "Will answer when the transcript is ready."
              : "A pause after your question finds an answer here."}
          {transcriptError ? (
            <button
              className="ml-2 min-h-11 underline underline-offset-4"
              onClick={refreshTranscript}
            >
              Retry
            </button>
          ) : null}
        </p>
      ) : null}
      {active?.kind === "error" ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm text-muted-foreground" role="alert">
            {active.message}
          </p>
          {active.retryable !== false ? (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 px-2 text-xs"
              disabled={!enabled || !question}
              onClick={() => void generate()}
            >
              Retry answer
            </Button>
          ) : null}
        </div>
      ) : null}
      {answer && answer.sources.length > 0 && !editing ? (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="min-h-11 w-fit cursor-pointer py-3 outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring/40">
            {answer.edited ? "Original sources" : "Sources"} ·{" "}
            {answer.sources.length}
          </summary>
          <div className="space-y-3 pb-2">
            {answer.sources.map((source, index) => (
              <div key={`${source.segmentId}:${index}`} className="space-y-1">
                {!transcriptChanged ? (
                  <a
                    href={`#${encodeURIComponent(source.segmentId)}`}
                    className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4"
                  >
                    {Math.floor(source.startMs / 60000)}:
                    {String(Math.floor(source.startMs / 1000) % 60).padStart(
                      2,
                      "0",
                    )}{" "}
                    · {source.speaker}
                    <ArrowUpRight aria-hidden="true" className="size-3" />
                  </a>
                ) : (
                  <span>{source.speaker} · Earlier transcript</span>
                )}
                <blockquote className="max-w-prose break-words leading-5">
                  “{source.quote}”
                </blockquote>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogTitle>Replace your edited answer?</DialogTitle>
          <DialogDescription className="mt-2">
            Regenerating replaces your edits with a new answer from the
            transcript. Your current answer stays if generation fails.
          </DialogDescription>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <DialogClose
              render={<Button variant="outline" className="min-h-11" />}
            >
              Keep my answer
            </DialogClose>
            <Button
              className="min-h-11"
              onClick={() => {
                setConfirmOpen(false);
                void generate();
              }}
            >
              Regenerate answer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
