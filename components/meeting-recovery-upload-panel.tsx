"use client";

import { ChangeEvent, FormEvent, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FileText, UploadCloud } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AudioBatchSignInRequiredError,
  uploadAudioBatch,
} from "@/lib/browser-audio-batch";
import {
  readMediaFileDurationMs,
  waitForRecordingDurationMs,
} from "@/lib/recording-duration";
import {
  audioUploadMediaAccept,
  getUploadMediaFromFile,
  isUploadMediaSizeAllowed,
  MAX_AUDIO_BATCH_FILES,
} from "@/lib/upload-media";
import { cn } from "@/lib/utils";

const transcriptAccept = ".txt,.srt,.vtt,text/plain,text/vtt";

type RecoveryState =
  | "idle"
  | "uploading-audio"
  | "uploading-transcript"
  | "complete"
  | "error";

type RecoveryQueuedResponse = {
  redirectTo?: string;
};

type MeetingContentSource = "audio" | "transcript";

export function MeetingRecoveryUploadPanel({
  meetingId,
}: {
  meetingId: string;
}) {
  const router = useRouter();
  const titleId = useId();
  const audioFormId = useId();
  const transcriptFormId = useId();
  const transcriptFileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<RecoveryState>("idle");
  const [source, setSource] = useState<MeetingContentSource | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);
  const [audioFiles, setAudioFiles] = useState<File[]>([]);
  const audioDurationPromisesRef = useRef<
    Promise<number | undefined>[]
  >([]);
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [transcriptText, setTranscriptText] = useState("");

  function resetMessage() {
    setState("idle");
    setMessage(null);
    setSignInRequired(false);
  }

  function handleAudioChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);

    setAudioFiles(files);
    audioDurationPromisesRef.current = files.map((file) =>
      readMediaFileDurationMs(file),
    );
    resetMessage();
  }

  function handleTranscriptFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;

    setTranscriptFile(file);
    if (file) {
      setTranscriptText("");
    }
    resetMessage();
  }

  function handleTranscriptTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const text = event.currentTarget.value;

    setTranscriptText(text);
    if (text && transcriptFile) {
      setTranscriptFile(null);
      if (transcriptFileInputRef.current) {
        transcriptFileInputRef.current.value = "";
      }
    }
    resetMessage();
  }

  async function handleAudioSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("uploading-audio");
    setMessage(null);
    setSignInRequired(false);

    if (audioFiles.length === 0 || audioFiles.some((file) => file.size === 0)) {
      showError("Select a recording file first");
      return;
    }

    if (audioFiles.length > MAX_AUDIO_BATCH_FILES) {
      showError(`Choose up to ${MAX_AUDIO_BATCH_FILES} audio files`);
      return;
    }

    if (audioFiles.some((file) => !isUploadMediaSizeAllowed(file.size))) {
      showError("Each recording file must be 1 GB or smaller");
      return;
    }

    const uploadMedia = audioFiles.map((file) => getUploadMediaFromFile(file));

    if (uploadMedia.some((media) => !media || media.kind !== "audio")) {
      showError("Only MP3, M4A, and WebM files are supported");
      return;
    }

    try {
      if (audioFiles.length > 1) {
        const durations = await Promise.all(audioDurationPromisesRef.current);

        if (durations.some((durationMs) => !durationMs)) {
          showError("The length of every audio file must be readable");
          return;
        }

        const queuedResult = await uploadAudioBatch({
          completePath: `/api/meetings/${encodeURIComponent(
            meetingId,
          )}/uploads/audio/batch/complete`,
          files: audioFiles.map((file, index) => ({
            durationMs: durations[index] as number,
            file,
            uploadMedia: uploadMedia[index]!,
          })),
          signPath: `/api/meetings/${encodeURIComponent(
            meetingId,
          )}/uploads/audio/batch/sign`,
          stagePath: `/api/meetings/${encodeURIComponent(
            meetingId,
          )}/uploads/audio/batch`,
          startedAt: new Date().toISOString(),
        });

        setState("complete");
        setMessage(
          `${audioFiles.length} recordings uploaded. Transcription queued`,
        );
        router.replace(queuedResult.redirectTo ?? `/meetings/${meetingId}`);
        router.refresh();
        return;
      }

      const durationMs = await waitForRecordingDurationMs(
        audioDurationPromisesRef.current[0] ?? null,
      );
      const queuedResult = await uploadRecoveryAudio({
        durationMs,
        file: audioFiles[0]!,
        meetingId,
        uploadMedia: uploadMedia[0]!,
      });

      setState("complete");
      setMessage("Recording uploaded. Transcription queued");
      router.replace(queuedResult.redirectTo ?? `/meetings/${meetingId}`);
      router.refresh();
    } catch (error) {
      if (
        error instanceof SignInRequiredError ||
        error instanceof AudioBatchSignInRequiredError
      ) {
        setSignInRequired(true);
      }

      showError("Recording upload failed");
    }
  }

  async function handleTranscriptSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("uploading-transcript");
    setMessage(null);
    setSignInRequired(false);

    if (!transcriptText.trim() && (!transcriptFile || transcriptFile.size === 0)) {
      showError("Add transcript text or choose a transcript file");
      return;
    }

    try {
      const formData = new FormData();

      if (transcriptText.trim()) {
        formData.set("transcriptText", transcriptText.trim());
      }

      if (transcriptFile) {
        formData.set("transcript-file", transcriptFile);
      }

      const response = await fetch(
        `/api/meetings/${meetingId}/uploads/transcript`,
        {
          method: "POST",
          body: formData,
        },
      );

      if (response.status === 401) {
        throw new SignInRequiredError();
      }

      if (!response.ok) {
        throw new Error("Transcript upload failed");
      }

      setState("complete");
      setMessage("Transcript added");
      router.refresh();
    } catch (error) {
      if (error instanceof SignInRequiredError) {
        setSignInRequired(true);
      }

      showError("Transcript upload failed");
    }
  }

  function showError(nextMessage: string) {
    setState("error");
    setMessage(nextMessage);
  }

  const audioUploading = state === "uploading-audio";
  const transcriptUploading = state === "uploading-transcript";
  const isBusy = audioUploading || transcriptUploading;

  return (
    <Card aria-labelledby={titleId} role="region" size="sm">
      <CardHeader className="border-b bg-muted/35">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle id={titleId}>Add meeting content</CardTitle>
            <CardDescription>
              Choose the source you already have.
            </CardDescription>
          </div>
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <UploadCloud className="size-4" />
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          aria-label="Meeting content source"
          className="grid grid-cols-2 gap-3"
          role="group"
        >
          <button
            aria-controls={audioFormId}
            aria-expanded={source === "audio"}
            aria-label="Audio recording"
            aria-pressed={source === "audio"}
            className={cn(
              "rounded-lg border bg-background p-3 text-left outline-none transition-colors hover:border-primary/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
              source === "audio" && "border-primary bg-primary/5",
            )}
            disabled={isBusy}
            onClick={() => {
              setSource("audio");
              resetMessage();
            }}
            type="button"
          >
            <UploadCloud
              className={cn(
                "size-4",
                source === "audio" ? "text-primary" : "text-muted-foreground",
              )}
            />
            <span className="mt-2 block text-sm font-semibold">
              Audio recording
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              Upload and transcribe automatically
            </span>
          </button>
          <button
            aria-controls={transcriptFormId}
            aria-expanded={source === "transcript"}
            aria-label="Transcript"
            aria-pressed={source === "transcript"}
            className={cn(
              "rounded-lg border bg-background p-3 text-left outline-none transition-colors hover:border-primary/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
              source === "transcript" && "border-primary bg-primary/5",
            )}
            disabled={isBusy}
            onClick={() => {
              setSource("transcript");
              resetMessage();
            }}
            type="button"
          >
            <FileText
              className={cn(
                "size-4",
                source === "transcript"
                  ? "text-primary"
                  : "text-muted-foreground",
              )}
            />
            <span className="mt-2 block text-sm font-semibold">Transcript</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              Paste text or upload a file
            </span>
          </button>
        </div>

        {source === "audio" ? (
          <form
            className="space-y-4 rounded-lg border bg-muted/20 p-4"
            id={audioFormId}
            onSubmit={handleAudioSubmit}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="meeting-recovery-audio">Audio files</Label>
              <Input
                accept={audioUploadMediaAccept}
                className="bg-background"
                disabled={isBusy}
                id="meeting-recovery-audio"
                name="meeting-recovery-audio"
                multiple
                onChange={handleAudioChange}
                type="file"
              />
              <p className="text-xs text-muted-foreground">
                MP3, M4A, or WebM · 1 GB maximum per file · files play in the order shown
              </p>
            </div>
            {audioFiles.length > 0 ? (
              <ol className="list-decimal space-y-1 rounded-md border bg-background px-3 py-2 pl-8 text-xs text-muted-foreground">
                {audioFiles.map((file, index) => (
                  <li className="break-all" key={`${file.name}:${file.size}:${index}`}>
                    {file.name}
                  </li>
                ))}
              </ol>
            ) : null}
            <Button type="submit" disabled={isBusy} size="sm">
              <UploadCloud data-icon="inline-start" />
              {audioUploading
                ? "Uploading..."
                : audioFiles.length > 1
                  ? "Upload audio files"
                  : "Upload audio"}
            </Button>
          </form>
        ) : null}

        {source === "transcript" ? (
          <form
            className="space-y-4 rounded-lg border bg-muted/20 p-4"
            id={transcriptFormId}
            onSubmit={handleTranscriptSubmit}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="meeting-recovery-transcript">
                Paste transcript
              </Label>
              <textarea
                className="min-h-28 w-full resize-y rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
                disabled={isBusy}
                id="meeting-recovery-transcript"
                name="transcriptText"
                onChange={handleTranscriptTextChange}
                placeholder="Paste transcript text"
                rows={5}
                value={transcriptText}
              />
            </div>
            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="meeting-recovery-transcript-file">
                Transcript file
              </Label>
              <Input
                accept={transcriptAccept}
                className="bg-background"
                disabled={isBusy}
                id="meeting-recovery-transcript-file"
                name="transcript-file"
                onChange={handleTranscriptFileChange}
                ref={transcriptFileInputRef}
                type="file"
              />
              <p className="text-xs text-muted-foreground">
                TXT, SRT, or VTT
              </p>
            </div>
            <Button type="submit" disabled={isBusy} size="sm">
              <FileText data-icon="inline-start" />
              {transcriptUploading ? "Uploading..." : "Add transcript"}
            </Button>
          </form>
        ) : null}

        {message ? (
          <Alert variant={state === "error" ? "destructive" : "default"}>
            {state === "error" ? <AlertCircle /> : <CheckCircle2 />}
            <AlertTitle>
              {state === "error" ? "Could not add content" : "Content added"}
            </AlertTitle>
            <AlertDescription>
              {message}
              {signInRequired ? (
                <>
                  {" "}
                  <a href="/auth/sign-in">Sign in</a>
                </>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

async function uploadRecoveryAudio({
  durationMs,
  file,
  meetingId,
  uploadMedia,
}: {
  durationMs?: number;
  file: File;
  meetingId: string;
  uploadMedia: { contentType: string; extension: string };
}) {
  const signResponse = await fetch("/api/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      extension: uploadMedia.extension,
      contentType: uploadMedia.contentType,
      fileSize: file.size,
    }),
  });

  if (signResponse.status === 401) {
    throw new SignInRequiredError();
  }

  if (!signResponse.ok) {
    return uploadRecoveryAudioViaServer({ durationMs, file, meetingId });
  }

  const { uploadId, uploadUrl } = (await signResponse.json()) as {
    uploadId?: string;
    uploadUrl?: string;
  };

  if (!uploadId || !uploadUrl) {
    return uploadRecoveryAudioViaServer({ durationMs, file, meetingId });
  }

  const uploadedDirectly = await uploadDirectly(
    uploadUrl,
    file,
    uploadMedia.contentType,
  );

  if (!uploadedDirectly) {
    return uploadRecoveryAudioViaServer({ durationMs, file, meetingId });
  }

  const completeResponse = await fetch(
    `/api/meetings/${meetingId}/uploads/audio/complete`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId,
        extension: uploadMedia.extension,
        contentType: uploadMedia.contentType,
        ...(durationMs ? { durationMs } : {}),
      }),
    },
  );

  if (completeResponse.status === 401) {
    throw new SignInRequiredError();
  }

  if (!completeResponse.ok) {
    throw new Error("Audio upload completion failed");
  }

  return readRecoveryQueuedResponse(completeResponse);
}

async function uploadRecoveryAudioViaServer({
  durationMs,
  file,
  meetingId,
}: {
  durationMs?: number;
  file: File;
  meetingId: string;
}) {
  const formData = new FormData();
  formData.set("meeting-audio", file);
  if (durationMs) {
    formData.set("durationMs", String(durationMs));
  }

  const response = await fetch(`/api/meetings/${meetingId}/uploads/audio`, {
    method: "POST",
    body: formData,
  });

  if (response.status === 401) {
    throw new SignInRequiredError();
  }

  if (!response.ok) {
    throw new Error("Audio upload failed");
  }

  return readRecoveryQueuedResponse(response);
}

async function uploadDirectly(
  uploadUrl: string,
  file: File,
  contentType: string,
) {
  try {
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: file,
    });

    return uploadResponse.ok;
  } catch {
    return false;
  }
}

async function readRecoveryQueuedResponse(response: Response) {
  return (await response.json().catch(() => ({}))) as RecoveryQueuedResponse;
}

class SignInRequiredError extends Error {}
