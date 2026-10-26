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
  const [draft, setDraft] = useState<string | null>(null);
  const [recoveredEdit, setRecoveredEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const restoredDraft = useRef(false);
  const editBase = useRef("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const request = useRef<AbortController | null>(null);
  const attempted = useRef<string | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const returnToAnswer = useRef(false);
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
      draft !== null ||
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
    draft,
    enabled,
    generate,
    key,
    question,
    transcript?.hasTranscript,
  ]);

  const dirty = draft !== null && draft !== answer?.text;
  const displayedText = draft ?? answer?.text ?? "";
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
        stored.text !== answer.text
      ) {
        editBase.current = stored.baseText ?? answer.text;
        // Legacy unfinished edits can only be recovered after hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDraft(stored.text);
        setRecoveredEdit(true);
      }
    } catch {
      /* Draft recovery is optional. */
    }
  }, [answer, editDraftKey]);

  useEffect(() => {
    if (!dirty) return;
    try {
      sessionStorage.setItem(
        editDraftKey,
        JSON.stringify({ text: draft, baseText: editBase.current }),
      );
    } catch {
      /* The navigation guard still protects unsaved edits. */
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, draft, editDraftKey]);

  useLayoutEffect(() => {
    const element = editor.current;
    if (!element) return;
    const resize = () => {
      const scrollTop = element.scrollTop;
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
      element.scrollTop = scrollTop;
    };
    resize();
    let width = element.parentElement!.clientWidth;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      resize();
    });
    observer.observe(element.parentElement!);
    return () => observer.disconnect();
  }, [displayedText]);

  function updateAnswer(text: string) {
    if (!answer || !enabled || busy) return;
    if (
      onAnswer(block.id, question ?? block.text, { ...answer, text, edited: true })
    ) {
      setDraft(null);
      setRecoveredEdit(false);
      setEditError("");
      try {
        sessionStorage.removeItem(editDraftKey);
      } catch {
        /* The note editor also retains its autosave draft. */
      }
    } else {
      editBase.current = answer.text;
      setDraft(text);
      setEditError(
        "These notes are full. Shorten this answer to save your edits.",
      );
    }
  }

  function requestRegeneration() {
    returnToAnswer.current = false;
    if (answer?.edited) setConfirmOpen(true);
    else void generate();
  }

  if (!question && !answer) return null;
  return (
    <div className="mb-5 ml-0.5 mt-2 border-l-2 border-border pl-3 sm:pl-4">
      <div className="flex min-h-11 items-center gap-1 text-xs text-muted-foreground">
        <span>{answer?.edited ? "Edited by you" : "From transcript"}</span>
        {answer ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 text-muted-foreground"
              aria-label="Regenerate answer"
              title="Regenerate answer"
              disabled={
                !question || busy || dirty || !enabled || !transcript?.hasTranscript
              }
              onClick={requestRegeneration}
            >
              <RotateCw
                className={`size-3.5 ${busy ? "motion-safe:animate-spin" : ""}`}
                aria-hidden="true"
              />
            </Button>
            {!question ? (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto min-h-11 px-2 text-xs"
                onClick={() => onRemoveAnswer(block.id)}
              >
                Remove answer
              </Button>
            ) : null}
          </>
        ) : null}
        {answer && busy ? (
          <span role="status" className="sr-only">Updating answer…</span>
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
      {answer ? (
        <div>
          {recoveredEdit ? (
            <p
              role="status"
              className="mb-2 text-xs leading-5 text-muted-foreground"
            >
              Your unfinished answer edit was recovered. Continue editing to
              save it.
            </p>
          ) : null}
          {editError ? (
            <p role="alert" className="mb-2 text-sm text-destructive">
              {editError}
            </p>
          ) : null}
          <textarea
            ref={editor}
            aria-label="Answer"
            aria-busy={busy || undefined}
            readOnly={!enabled || busy}
            value={displayedText}
            maxLength={12000}
            rows={1}
            placeholder="Write your answer…"
            className="block max-h-[min(24rem,60dvh)] min-h-6 w-full resize-none rounded-sm border-0 bg-transparent p-0 text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2"
            onChange={(event) => updateAnswer(event.target.value)}
            onBlur={() => {
              if (draft !== null) updateAnswer(draft);
            }}
          />
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
              disabled={!enabled || !question || dirty}
              onClick={requestRegeneration}
            >
              Retry answer
            </Button>
          ) : null}
        </div>
      ) : null}
      {answer && answer.sources.length > 0 ? (
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
        <DialogContent
          finalFocus={() => returnToAnswer.current ? editor.current : true}
        >
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
                returnToAnswer.current = true;
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
