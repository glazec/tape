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
import { NoteMarkdown } from "@/components/note-markdown";
import { MeetingNoteImage } from "@/components/meeting-note-image";
import { noteClipboardMarkdown } from "@/lib/note-markdown";
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
import { useMeetingNote, type DraftNoteBlock } from "@/components/use-meeting-note";
import {
  noteContent,
  meetingNoteSchema,
  noteImageMaxBytes,
  noteImageSchema,
  noteQuestion,
  type NoteAnswer,
  type NoteBlock,
  type NoteMoment,
} from "@/lib/meeting-note-document";

import {
  explicitMomentTarget,
  formatNoteMoment,
  NOTE_MOMENT_NAVIGATE,
  NOTE_PLAYBACK_POSITION,
  parseNoteMoments,
  reconcileNoteMoments,
  resolveNoteMoment,
  type NoteMomentSource,
  type NotePlaybackPosition,
  type NoteMomentNavigation,
} from "@/lib/note-moments";

const emptyMomentSources: NoteMomentSource[] = [];
type ImagePreview = { url: string; file?: File; error?: string };

async function prepareImage(file: File): Promise<Blob> {
  if (file.size <= noteImageMaxBytes) return file;

  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not resize the screenshot.");
    for (const limit of [3200, 2400, 1600]) {
      const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
      if (webp?.type === "image/webp" && webp.size <= noteImageMaxBytes) return webp;
      if (webp?.type !== "image/webp") {
        const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
        if (jpeg && jpeg.size <= noteImageMaxBytes) return jpeg;
      }
    }
    throw new Error("Could not fit the image within 4 MB.");
  } finally {
    bitmap.close();
  }
}

// Enter after a question starts a new writing block. Preserve the exact text.
function splitAfterQuestions(text: string) {
  const chunks: string[] = [];
  let current = "";
  const lines = text.split("\n");
  let fence: string | null = null;
  let inList = false;
  lines.forEach((line, index) => {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})/);
    const wasFenced = fence !== null;
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length && !line.slice(delimiter[0].length).trim()) fence = null;
    }
    if (!line.trim()) inList = false;
    if (/^\s*(?:[-*+] |\d+[.)] )/.test(line)) inList = true;
    const protectedLine = wasFenced || fence !== null || inList || /^(?: {4}|\t| {0,3}>| {0,3}#{1,6} )/.test(line) || line.includes("|");
    current += line;
    if (index < lines.length - 1) {
      if (!protectedLine && noteQuestion(line)) {
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
  momentSources = emptyMomentSources,
}: {
  meetingId: string;
  userId: string;
  momentSources?: NoteMomentSource[];
}) {
  const { blocks, change, status, loaded, save, reload, retry, requiresSignIn, requireSignIn, restoreSession } =
    useMeetingNote(meetingId, userId);
  const [preview, setPreview] = useState(false);
  const [pasteError, setPasteError] = useState("");
  const [imagePreviews, setImagePreviews] = useState<Record<string, ImagePreview>>({});
  const imageUploads = useRef(new Map<string, AbortController>());
  const imageUrls = useRef(new Map<string, string>());
  const [removedImage, setRemovedImage] = useState<{ block: DraftNoteBlock; index: number; beforeId?: string } | null>(null);
  const clearImagePreviews = useCallback(() => {
    imageUploads.current.forEach((controller) => controller.abort());
    imageUploads.current.clear();
    imageUrls.current.forEach((url) => URL.revokeObjectURL(url));
    imageUrls.current.clear();
  }, []);
  useEffect(() => clearImagePreviews, [clearImagePreviews]);
  const [editingMoments, setEditingMoments] = useState(false);
  const [momentMessage, setMomentMessage] = useState("");
  const lastEditor = useRef<string | null>(null);
  const pastedCommand = useRef<string | null>(null);
  const playbackPosition = useRef<NotePlaybackPosition | null>(null);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<NotePlaybackPosition>).detail;
      if (momentSources.some((source) => source.id === detail.meetingId))
        playbackPosition.current = detail;
    };
    window.addEventListener(NOTE_PLAYBACK_POSITION, receive);
    return () => window.removeEventListener(NOTE_PLAYBACK_POSITION, receive);
  }, [momentSources]);
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
  const editors = useRef(new Map<string, HTMLTextAreaElement>());
  const copyFallback = useRef<HTMLTextAreaElement>(null);
  const pendingFocus = useRef<{ id: string; position: number } | null>(null);
  const blocksRef = useRef(blocks);
  const metadataRequest = useRef<AbortController | null>(null);
  const answerUrl = `/api/meetings/${encodeURIComponent(meetingId)}/notes/answer`;
  const imagesUrl = `/api/meetings/${encodeURIComponent(meetingId)}/notes/images`;
  const content = noteContent(blocks);
  const hasQuestions = blocks.some(
    (block) => noteQuestion(block.text) || block.answer,
  );
  const hasAnswer = blocks.some((block) => block.answer);
  const firstEditorId = blocks.find((block) => !block.image)?.id;
  const canEnhance = loaded && !requiresSignIn && status !== "conflict" && status !== "error";
  const copyText = blocks
    .map((block) => {
      let text = block.text;
      for (const moment of [...(block.moments ?? [])].sort(
        (a, b) => b.start - a.start,
      )) {
        const source = momentSources.find(
          (source) => source.id === moment.sourceMeetingId,
        );
        const resolved = source
          ? resolveNoteMoment(moment, source.recordings)
          : null;
        const marker =
          resolved === null
            ? `[Moment captured ${moment.capturedAt ?? "during playback"}]`
            : `[${formatNoteMoment(resolved)}]`;
        text =
          text.slice(0, moment.start) +
          marker +
          text.slice(moment.start + moment.text.length);
      }
      if (block.pendingImage) return "";
      if (block.image) return `![Pasted note image](${imagesUrl}?id=${block.image.id})`;
      return [text, block.answer?.text].filter(Boolean).join("\n");
    })
    .join("\n");

  useLayoutEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  const refreshTranscript = useCallback(async () => {
    if (requiresSignIn) return;
    metadataRequest.current?.abort();
    const controller = new AbortController();
    metadataRequest.current = controller;
    try {
      const response = await fetch(answerUrl, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.status === 401) {
        requireSignIn();
        return;
      }
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
  }, [answerUrl, requiresSignIn, requireSignIn]);

  useEffect(() => {
    if (!hasQuestions || !loaded || requiresSignIn) return;
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
  }, [hasQuestions, loaded, refreshTranscript, requiresSignIn]);

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
  }, [blocks, loaded, editingMoments, preview, resizeEditors]);
  useEffect(() => {
    window.addEventListener("resize", resizeEditors);
    return () => window.removeEventListener("resize", resizeEditors);
  }, [resizeEditors]);
  useEffect(() => {
    if (copyStatus !== "error") return;
    const editor = copyFallback.current ?? editors.current.get(firstEditorId ?? "");
    editor?.focus();
    editor?.select();
  }, [blocks, copyStatus, firstEditorId]);

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
            ? { ...block, answer: undefined }
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
    insertedMoments?: NoteMoment[],
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
    const moments =
      insertedMoments ??
      reconcileNoteMoments(block.text, text, block.moments, cursor);
    let partOffset = 0;
    const next: NoteBlock[] = parts.map((part, index) => {
      const partMoments = moments
        .filter(
          (moment) =>
            moment.start >= partOffset &&
            moment.start + moment.text.length <= partOffset + part.length,
        )
        .map((moment) => ({ ...moment, start: moment.start - partOffset }));
      partOffset += part.length + 1;
      return {
        id: index === Math.max(0, answerIndex) ? id : crypto.randomUUID(),
        text: part,
        ...(partMoments.length ? { moments: partMoments } : {}),
        ...(index === answerIndex && block.answer
          ? { answer: block.answer }
          : {}),
      };
    });
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

  async function uploadImage(blockId: string, file: File, url: string) {
    if (imageUploads.current.has(blockId)) return;
    const controller = new AbortController();
    imageUploads.current.set(blockId, controller);
    setImagePreviews((current) => ({ ...current, [blockId]: { url, file } }));
    let errorMessage = file.size > noteImageMaxBytes
      ? "Could not add this large image."
      : "Could not upload image.";
    try {
      const body = await prepareImage(file);
      errorMessage = "Could not upload image.";
      if (controller.signal.aborted) return;
      const response = await fetch(imagesUrl, { method: "POST", body, signal: controller.signal });
      if (!response.ok) {
        if (response.status === 401 && !controller.signal.aborted) {
          requireSignIn();
          errorMessage = "Sign in again to upload.";
        }
        throw new Error(errorMessage);
      }
      const data = await response.json();
      const image = noteImageSchema.parse({ id: data.id, width: 75 });
      if (controller.signal.aborted) return;
      restoreSession();
      change((current) => current.map((block) => {
        if (block.id !== blockId || !block.image) return block;
        return { id: block.id, text: "", image: { ...block.image, id: image.id } };
      }));
      setImagePreviews((current) => ({ ...current, [blockId]: { url } }));
    } catch {
      if (!controller.signal.aborted) {
        setImagePreviews((current) => ({ ...current, [blockId]: { url, file, error: errorMessage } }));
      }
    } finally {
      if (imageUploads.current.get(blockId) === controller) imageUploads.current.delete(blockId);
    }
  }

  function pasteImages(files: File[], block: NoteBlock, editor: HTMLTextAreaElement) {
    const supported = files.filter((file) =>
      ["image/png", "image/jpeg", "image/webp"].includes(file.type),
    );
    if (!supported.length) {
      setPasteError("Paste a PNG, JPEG, or WebP image.");
      return;
    }
    const current = blocksRef.current;
    const images = supported.map((file) => {
      const id = crypto.randomUUID();
      return { file, block: { id, text: "", image: { id, width: 75 } } };
    });
    const start = editor.selectionStart;
    const canSplit = !block.answer && !(block.moments ?? []).some((moment) =>
      moment.start < start && moment.start + moment.text.length > start);
    const before = canSplit ? block.text.slice(0, start) : block.text;
    const after = canSplit ? block.text.slice(start) : "";
    const hasLeading = Boolean(before || block.answer);
    const leading = {
      ...block,
      text: before,
      moments: canSplit ? block.moments?.filter((moment) => moment.start + moment.text.length <= start) : block.moments,
    };
    const trailing: NoteBlock = {
      id: hasLeading ? crypto.randomUUID() : block.id,
      text: after,
      moments: canSplit ? block.moments?.filter((moment) => moment.start >= start)
        .map((moment) => ({ ...moment, start: moment.start - start })) : undefined,
    };
    const pastedBlocks = images.map(({ block }) => block);
    const next: DraftNoteBlock[] = current.flatMap((item) => item.id === block.id
      ? [...(hasLeading ? [leading] : []), ...pastedBlocks, trailing]
      : [item]);
    const validationBlocks = next.map((item) =>
      item.pendingImage ? { id: item.id, text: item.text, image: item.image } : item,
    );
    if (!meetingNoteSchema.safeParse({ blocks: validationBlocks, content: noteContent(next), version: 0 }).success) {
      setPasteError("There is no room for another image in this note.");
      return;
    }
    const pastedIds = new Set(pastedBlocks.map((item) => item.id));
    pendingFocus.current = { id: trailing.id, position: 0 };
    change(next.map((item) => pastedIds.has(item.id) ? { ...item, pendingImage: true } : item));
    for (const { file, block: pasted } of images) {
      const url = URL.createObjectURL(file);
      imageUrls.current.set(pasted.id, url);
      void uploadImage(pasted.id, file, url);
    }
  }

  function removeImage(block: DraftNoteBlock, index: number) {
    const nextEditor = blocks.slice(index + 1).find((item) => !item.image);
    const previousEditor = blocks.slice(0, index).findLast((item) => !item.image);
    if (nextEditor) pendingFocus.current = { id: nextEditor.id, position: 0 };
    else if (previousEditor) {
      pendingFocus.current = { id: previousEditor.id, position: previousEditor.text.length };
    }
    if (block.pendingImage) {
      imageUploads.current.get(block.id)?.abort();
      imageUploads.current.delete(block.id);
      const url = imageUrls.current.get(block.id);
      if (url) URL.revokeObjectURL(url);
      imageUrls.current.delete(block.id);
      setImagePreviews((current) => {
        const next = { ...current };
        delete next[block.id];
        return next;
      });
    } else {
      setRemovedImage({ block, index, beforeId: blocks[index + 1]?.id });
    }
    change((current) => {
      const next = current.filter((item) => item.id !== block.id);
      return next.length ? next : [{ id: crypto.randomUUID(), text: "" }];
    });
  }

  function captureMoment(id: string, command = false) {
    const editor = editors.current.get(id);
    const block = blocksRef.current.find((item) => item.id === id);
    if (!editor || !block || composing === id) return;
    const start = command ? editor.selectionStart - 4 : editor.selectionStart;
    const end = editor.selectionEnd;
    const active = momentSources.filter((source) => source.recording);
    const playback = playbackPosition.current;
    const captureSource =
      active.length === 1
        ? active[0]
        : active.length === 0 && !playback
          ? momentSources.find((source) => source.id === meetingId)
          : undefined;
    let token: string;
    let anchor: NoteMoment | undefined;
    if (captureSource) {
      token = "[Moment]";
      anchor = {
        start,
        text: token,
        sourceMeetingId: captureSource.id,
        capturedAt: new Date().toISOString(),
      };
      setMomentMessage(
        "Moment saved. It will link if this time is covered by a recording.",
      );
    } else if (playback) {
      let offset = 0;
      for (const source of momentSources) {
        if (source.id === playback.meetingId) break;
        if (source.durationMs === null) {
          setMomentMessage(
            "Current recording time is unavailable. Type a timestamp such as [12:34].",
          );
          return;
        }
        offset += source.durationMs;
      }
      token = `[${formatNoteMoment(offset + playback.timestampMs)}]`;
      anchor = {
        start,
        text: token,
        sourceMeetingId: playback.meetingId,
        playbackMs: playback.timestampMs,
      };
      setMomentMessage("");
    } else {
      setMomentMessage(
        "Current recording time is unavailable. Type a timestamp such as [12:34].",
      );
      return;
    }
    const text =
      block.text.slice(0, start) + token + " " + block.text.slice(end);
    // This insertion has an exact selection range. A text diff cannot tell
    // identical markers apart, especially when replacing one with another.
    const delta = token.length + 1 - (end - start);
    const moments = (block.moments ?? []).flatMap((moment) => {
      if (moment.start + moment.text.length <= start) return [moment];
      if (moment.start >= end)
        return [{ ...moment, start: moment.start + delta }];
      return [];
    });
    if (anchor) moments.push(anchor);
    setEditingMoments(true);
    pendingFocus.current = { id, position: start + token.length + 1 };
    updateText(id, text, start + token.length + 1, false, moments);
  }

  function renderMomentText(block: NoteBlock, markdown = false) {
    const tokens = [
      ...parseNoteMoments(block.text),
      ...(block.moments ?? [])
        .filter(
          (moment) =>
            moment.text === "[Moment]" &&
            block.text.slice(
              moment.start,
              moment.start + moment.text.length,
            ) === moment.text,
        )
        .map((moment) => ({
          start: moment.start,
          text: moment.text,
          timestampMs: 0,
        })),
    ].sort((a, b) => a.start - b.start);
    let offset = 0;
    const nodes = tokens.flatMap((token) => {
      const anchor = block.moments?.find(
        (moment) => moment.start === token.start && moment.text === token.text,
      );
      const source = anchor
        ? momentSources.find((source) => source.id === anchor.sourceMeetingId)
        : null;
      const resolved =
        anchor && source ? resolveNoteMoment(anchor, source.recordings) : null;
      const target = anchor
        ? resolved === null
          ? null
          : { meetingId: anchor.sourceMeetingId, timestampMs: resolved }
        : explicitMomentTarget(token.timestampMs, momentSources);
      const label = anchor
        ? resolved === null
          ? "Moment"
          : formatNoteMoment(resolved)
        : formatNoteMoment(token.timestampMs);
      const before = block.text.slice(offset, token.start);
      offset = token.start + token.text.length;
      return [
        before,
        <button
          key={token.start}
          type="button"
          className="mx-0.5 inline-flex min-h-11 items-center rounded bg-muted/60 px-2 text-sm font-medium tabular-nums text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={
            target
              ? `Go to ${label} in transcript`
              : "Moment waiting for recording"
          }
          onClick={() => {
            if (!target) {
              setMomentMessage(
                anchor
                  ? "This moment will link when its recording timing is available."
                  : "This timestamp is outside the available recording timeline.",
              );
              return;
            }
            const detail: NoteMomentNavigation = { ...target };
            window.dispatchEvent(
              new CustomEvent(NOTE_MOMENT_NAVIGATE, { detail }),
            );
            setMomentMessage(
              detail.handled
                ? ""
                : "The transcript is not ready yet. Your moment is saved.",
            );
          }}
        >
          {label}
        </button>,
      ];
    });
    if (markdown) return <NoteMarkdown moments={tokens.map((token, index) => ({
      start: token.start, text: token.text, element: nodes[index * 2 + 1],
    }))}>{block.text}</NoteMarkdown>;
    return [...nodes, block.text.slice(offset)];
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
    <section aria-labelledby={headingId} className="mb-10">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex shrink-0 items-center gap-2">
          <h2
            id={headingId}
            className="text-base font-semibold"
          >
            My notes
          </h2>
          <p
            id={privacyId}
            className="flex items-center gap-1 text-xs text-muted-foreground/80"
            title="Only visible to you"
          >
            <LockKeyhole aria-hidden="true" className="size-3 shrink-0" />
            <span className="sr-only">Only visible to you</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        {loaded ? (
          <>
          <button
            type="button"
            aria-pressed={preview}
            className="min-h-11 rounded px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              setPreview(!preview);
              if (preview) {
                setEditingMoments(true);
                const id = lastEditor.current ?? firstEditorId;
                if (!id) return;
                pendingFocus.current = { id, position: blocks.find((block) => block.id === id)?.text.length ?? 0 };
              } else void save();
            }}
          >
            {preview ? "Write" : "Preview"}
          </button>
          <button
            type="button"
            className="min-h-11 rounded px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
            title="Type @now then Space, or [12:34]"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setPreview(false);
              captureMoment(lastEditor.current ?? blocks.at(-1)!.id);
            }}
          >
            Add timestamp
          </button>
          {!preview && blocks.some(
            (block) =>
              parseNoteMoments(block.text).length || block.moments?.length,
          ) ? (
            <button
              type="button"
              className="min-h-11 rounded px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
              onClick={() => {
                const id = lastEditor.current ?? firstEditorId;
                if (!id) return;
                setPreview(false);
                setEditingMoments(true);
                pendingFocus.current = {
                  id,
                  position:
                    blocks.find((block) => block.id === id)?.text.length ?? 0,
                };
              }}
            >
              Edit notes
            </button>
          ) : null}
          </>
        ) : null}
        <span
          aria-live="polite"
          role="status"
          className="flex min-h-6 min-w-16 shrink-0 items-center justify-end gap-1.5 pl-2 text-xs text-muted-foreground"
        >
          {Object.values(imagePreviews).some((image) => image.file && !image.error) ? (
            "Uploading image…"
          ) : Object.values(imagePreviews).some((image) => image.error) ? (
            "Image not saved"
          ) : answerDrafts.size > 0 ? (
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
      </div>
      {pasteError ? <p role="alert" className="mb-2 text-sm text-destructive">{pasteError}</p> : null}
      {momentMessage ? (
        <p
          role="status"
          className="mb-2 text-xs leading-5 text-muted-foreground"
        >
          {momentMessage}
        </p>
      ) : null}
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
        {blocks.map((block, index) => block.image ? (
          <MeetingNoteImage
            key={block.id}
            blockId={block.id}
            image={block.image}
            src={imagePreviews[block.id]?.url ?? `${imagesUrl}?id=${block.image.id}`}
            uploadStatus={block.pendingImage ? imagePreviews[block.id]?.error ?? "Uploading image…" : undefined}
            onRetry={imagePreviews[block.id]?.error ? () => {
              const upload = imagePreviews[block.id];
              if (upload?.file) void uploadImage(block.id, upload.file, upload.url);
            } : undefined}
            onMeasure={block.pendingImage || !preview && canEnhance ? (aspectRatio) => {
              change((current) => current.map((item) =>
                item.id === block.id && item.image && !item.image.aspectRatio
                  ? { ...item, image: { ...item.image, aspectRatio } }
                  : item,
              ));
            } : undefined}
            onResize={!preview ? (width) => {
              change((current) => current.map((item) =>
                item.id === block.id && item.image
                  ? { ...item, image: { ...item.image, width } }
                  : item,
              ));
            } : undefined}
            onRemove={!preview ? () => removeImage(block, index) : undefined}
          />
        ) : (
          <div key={block.id}>
            {preview ? renderMomentText(block, true) : null}
            {!preview && loaded &&
            !editingMoments &&
            (parseNoteMoments(block.text).length > 0 ||
              Boolean(block.moments?.length)) ? (
              <p className="whitespace-pre-wrap break-words text-base leading-7">
                {renderMomentText(block)}
              </p>
            ) : null}
            <textarea
              hidden={preview || (
                loaded &&
                !editingMoments &&
                (parseNoteMoments(block.text).length > 0 ||
                  Boolean(block.moments?.length)))
              }
              ref={(node) => {
                if (node) editors.current.set(block.id, node);
                else editors.current.delete(block.id);
              }}
              aria-label={block.id === firstEditorId ? "My notes" : `Note ${index + 1}`}
              aria-describedby={privacyId}
              aria-busy={status === "loading"}
              className={`${preview || (loaded && !editingMoments && (parseNoteMoments(block.text).length > 0 || Boolean(block.moments?.length))) ? "hidden" : "block"} max-h-[min(24rem,60dvh)] w-full resize-none border-0 bg-transparent p-0 text-base leading-7 outline-none placeholder:text-muted-foreground disabled:text-muted-foreground ${blocks.length === 1 && !hasQuestions ? "min-h-14 focus:min-h-36" : "min-h-7"}`}
              disabled={!loaded}
              maxLength={20_000 - content.length + block.text.length}
              onFocus={() => {
                lastEditor.current = block.id;
                setEditingMoments(true);
              }}
              onBlur={(event) => {
                void save();
                if (!(event.relatedTarget instanceof HTMLTextAreaElement))
                  setEditingMoments(false);
              }}
              onPaste={(event) => {
                pastedCommand.current = block.id;
                setPasteError("");
                const images = Array.from(event.clipboardData?.files ?? [])
                  .filter((file) => file.type.startsWith("image/"));
                const plain = event.clipboardData?.getData?.("text/plain") ?? "";
                const html = event.clipboardData?.getData?.("text/html") ?? "";
                const clipboardBody = images.length && html
                  ? new DOMParser().parseFromString(html, "text/html").body
                  : null;
                const hasImageMarkup = clipboardBody?.querySelector("img") &&
                  !clipboardBody.querySelector("table") && !clipboardBody.textContent?.trim();
                const hasText = plain.trim() || clipboardBody?.textContent?.trim();
                const hasStandaloneFile = !html && images.length === 1 &&
                  plain.trim() === images[0].name;
                if (images.length && (hasImageMarkup || hasStandaloneFile || !hasText)) {
                  event.preventDefault();
                  pasteImages(images, block, event.currentTarget);
                  return;
                }
                let markdown = noteClipboardMarkdown(
                  html,
                  plain,
                );
                if (markdown === null) return;
                event.preventDefault();
                const editor = event.currentTarget;
                const start = editor.selectionStart;
                const end = editor.selectionEnd;
                const before = block.text.slice(0, start);
                const after = block.text.slice(end);
                if (markdown.includes("\n")) {
                  if (before && !before.endsWith("\n\n")) markdown = (before.endsWith("\n") ? "\n" : "\n\n") + markdown;
                  if (after && !after.startsWith("\n\n")) markdown += after.startsWith("\n") ? "\n" : "\n\n";
                }
                const text = before + markdown + after;
                if (content.length - block.text.length + text.length > 20_000) {
                  setPasteError("This paste exceeds the 20,000 character limit. Paste a smaller section.");
                  return;
                }
                pendingFocus.current = { id: block.id, position: start + markdown.length };
                updateText(block.id, text, start + markdown.length, true);
              }}
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
                  event.key === " " &&
                  pastedCommand.current !== block.id &&
                  editor.selectionStart === editor.selectionEnd &&
                  /(?:^|\s)@now$/.test(
                    editor.value.slice(0, editor.selectionStart),
                  )
                ) {
                  event.preventDefault();
                  captureMoment(block.id, true);
                  return;
                }
                pastedCommand.current = null;
                if (
                  event.key === "Backspace" &&
                  editor.selectionStart === 0 &&
                  editor.selectionEnd === 0 &&
                  index > 0
                ) {
                  event.preventDefault();
                  const previous = blocks[index - 1];
                  if (previous.image) {
                    document.getElementById(`note-image-${previous.id}`)?.focus();
                    return;
                  }
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
                                ...(previous.moments?.length ||
                                block.moments?.length
                                  ? {
                                      moments: [
                                        ...(previous.moments ?? []),
                                        ...(block.moments ?? []).map(
                                          (moment) => ({
                                            ...moment,
                                            start:
                                              moment.start +
                                              previous.text.length,
                                          }),
                                        ),
                                      ],
                                    }
                                  : {}),
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
                requiresSignIn={requiresSignIn}
                onUnauthorized={requireSignIn}
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
              setPreview(false);
              setEditingMoments(true);
              const next = { id: crypto.randomUUID(), text: "" };
              pendingFocus.current = { id: next.id, position: 0 };
              change([...blocks, next]);
            }}
          >
            Keep taking notes…
          </button>
        ) : null}
      </div>
      {removedImage ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span role="status">Image removed</span>
          <Button size="sm" variant="ghost" onClick={() => {
            change((current) => {
              const next = [...current];
              const index = next.findIndex((block) => block.id === removedImage.beforeId);
              next.splice(index < 0 ? removedImage.index : index, 0, removedImage.block);
              return next;
            });
            setRemovedImage(null);
          }}>Undo</Button>
        </div>
      ) : null}
      {content.length >= 19_000 ? (
        <p
          className="mt-3 text-right text-xs tabular-nums text-muted-foreground"
          role="status"
        >
          {(20_000 - content.length).toLocaleString()} characters remaining
        </p>
      ) : null}
      {requiresSignIn ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t pt-3">
          <p className="text-sm text-muted-foreground" role="alert">
            {loaded
              ? "Sign in again to save notes and check the transcript. Your edits are still here."
              : "Sign in again to load your notes."}
          </p>
          <a
            className="inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={`/auth/sign-in?callbackUrl=${encodeURIComponent(`/meetings/${meetingId}`)}`}
          >
            Sign in
          </a>
        </div>
      ) : status === "error" ? (
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
                <Check aria-hidden="true" data-confirm="" />
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
              {blocks.length > 1 ||
              hasAnswer ||
              blocks.some((block) => block.image || block.moments?.length) ? (
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
                clearImagePreviews();
                setImagePreviews({});
                setRemovedImage(null);
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
