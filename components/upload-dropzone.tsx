"use client";

import { ChangeEvent, FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, UploadCloud } from "lucide-react";

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
  getUploadMediaFromFile,
  isUploadMediaSizeAllowed,
  MAX_AUDIO_BATCH_FILES,
  uploadMediaAccept,
} from "@/lib/upload-media";

type UploadState = "idle" | "uploading" | "complete" | "error";

type UploadQueuedResponse = {
  redirectTo?: string;
};

export function UploadDropzone() {
  const router = useRouter();
  const [state, setState] = useState<UploadState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const selectedDurationPromisesRef = useRef<
    Promise<number | undefined>[]
  >([]);
  const [startTime, setStartTime] = useState("");

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);

    setSelectedFiles(files);
    selectedDurationPromisesRef.current = files.map((file) =>
      readMediaFileDurationMs(file),
    );
    setState("idle");
    setMessage(null);
    setSignInRequired(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("uploading");
    setMessage(null);
    setSignInRequired(false);

    if (selectedFiles.length === 0 || selectedFiles.some((file) => file.size === 0)) {
      setState("error");
      setMessage("Select a recording file first");
      return;
    }

    if (selectedFiles.length > MAX_AUDIO_BATCH_FILES) {
      setState("error");
      setMessage(`Choose up to ${MAX_AUDIO_BATCH_FILES} audio files`);
      return;
    }

    if (selectedFiles.some((file) => !isUploadMediaSizeAllowed(file.size))) {
      setState("error");
      setMessage("Each recording file must be 1 GB or smaller");
      return;
    }

    const selectedMedia = selectedFiles.map((file) =>
      getUploadMediaFromFile(file),
    );

    if (selectedMedia.some((uploadMedia) => !uploadMedia)) {
      setState("error");
      setMessage("Only MP3, M4A, MP4, MOV, WEBM, and MKV files are supported");
      return;
    }

    if (
      selectedFiles.length > 1 &&
      selectedMedia.some((uploadMedia) => uploadMedia?.kind !== "audio")
    ) {
      setState("error");
      setMessage("Choose only audio files when uploading multiple recordings");
      return;
    }

    const startedAt = parseStartTimeInput(startTime);

    if (startedAt === null) {
      setState("error");
      setMessage("Enter a valid start time");
      return;
    }

    try {
      if (selectedFiles.length > 1) {
        const durations = await Promise.all(selectedDurationPromisesRef.current);

        if (durations.some((durationMs) => !durationMs)) {
          throw new Error("Recording duration unavailable");
        }

        const queuedResult = await uploadAudioBatch({
          completePath: "/api/uploads/audio/batch/complete",
          files: selectedFiles.map((file, index) => ({
            durationMs: durations[index] as number,
            file,
            uploadMedia: selectedMedia[index]!,
          })),
          startedAt: startedAt ?? new Date().toISOString(),
        });

        setState("complete");
        setMessage(
          `${selectedFiles.length} recordings uploaded. Transcription queued`,
        );
        router.replace(queuedResult.redirectTo ?? "/dashboard");
        router.refresh();
        return;
      }

      const selectedFile = selectedFiles[0]!;
      const uploadMedia = selectedMedia[0]!;
      const signResponse = await fetch("/api/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          extension: uploadMedia.extension,
          contentType: uploadMedia.contentType,
          fileSize: selectedFile.size,
        }),
      });

      if (signResponse.status === 401) {
        setState("error");
        setMessage("Sign in to upload recordings");
        setSignInRequired(true);
        return;
      }

      if (!signResponse.ok) {
        throw new Error("Upload URL request failed");
      }

      const { uploadId, uploadUrl } = (await signResponse.json()) as {
        uploadId?: string;
        uploadUrl?: string;
      };

      if (!uploadId || !uploadUrl) {
        throw new Error("Upload URL missing");
      }

      const uploadedDirectly = await uploadDirectly(
        uploadUrl,
        selectedFile,
        uploadMedia.contentType,
      );
      const durationMs = await waitForRecordingDurationMs(
        selectedDurationPromisesRef.current[0] ?? null,
      );

      let queuedResult: UploadQueuedResponse;

      if (!uploadedDirectly) {
        queuedResult = await uploadViaServer(selectedFile, startedAt, durationMs);
      } else {
        const completeResponse = await fetch("/api/uploads/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            uploadId,
            fileName: selectedFile.name,
            extension: uploadMedia.extension,
            contentType: uploadMedia.contentType,
            ...(durationMs ? { durationMs } : {}),
            ...(startedAt ? { startedAt } : {}),
          }),
        });

        if (!completeResponse.ok) {
          throw new Error("Upload completion failed");
        }

        queuedResult = await readUploadQueuedResponse(completeResponse);
      }

      setState("complete");
      setMessage("Upload complete. Transcription queued");
      router.replace(getPostUploadPath(queuedResult.redirectTo));
      router.refresh();
    } catch (error) {
      setState("error");
      if (error instanceof AudioBatchSignInRequiredError) {
        setMessage("Sign in to upload recordings");
        setSignInRequired(true);
      } else if (
        error instanceof Error &&
        error.message === "Recording duration unavailable"
      ) {
        setMessage("The length of every audio file must be readable");
      } else {
        setMessage("Upload failed");
      }
    }
  }

  const startTimeInvalid =
    state === "error" && message === "Enter a valid start time";

  return (
    <Card>
      <CardHeader className="border-b bg-muted/35">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Upload recording</CardTitle>
            <CardDescription>
              Add an existing recording and queue transcription.
            </CardDescription>
          </div>
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <UploadCloud className="size-4" />
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="meeting-audio">Recording files</Label>
            <Input
              id="meeting-audio"
              name="meeting-audio"
              type="file"
              multiple
              accept={uploadMediaAccept}
              onChange={handleFileChange}
              className="min-h-11 bg-background"
              aria-invalid={state === "error" && !startTimeInvalid}
            />
            <p className="text-xs text-muted-foreground">
              Choose one recording, or multiple audio files in playback order. 1 GB maximum per file.
            </p>
          </div>
          <details className="group rounded-lg border bg-muted/20">
            <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-medium text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Optional meeting time
            </summary>
            <div className="flex flex-col gap-2 border-t p-3">
              <Label htmlFor="meeting-start-time">When did it start?</Label>
              <Input
                id="meeting-start-time"
                name="startedAt"
                type="datetime-local"
                value={startTime}
                onChange={(event) => setStartTime(event.currentTarget.value)}
                className="min-h-11 bg-background"
                aria-invalid={startTimeInvalid}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Add this only when the recording date matters in the meeting library.
              </p>
            </div>
          </details>
          {selectedFiles.length > 0 ? (
            <div className="rounded-md border bg-muted/45 px-3 py-2 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Plays in this order</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                {selectedFiles.map((file, index) => (
                  <li className="break-all" key={`${file.name}:${file.size}:${index}`}>
                    {file.name}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          <Button
            type="submit"
            disabled={state === "uploading"}
            className="min-h-11 w-fit"
          >
            <UploadCloud data-icon="inline-start" />
            {state === "uploading"
              ? "Uploading recordings"
              : selectedFiles.length > 1
                ? "Upload recordings"
                : "Upload recording"}
          </Button>
          {message ? (
            <Alert variant={state === "error" ? "destructive" : "default"}>
              {state === "error" ? <AlertCircle /> : <CheckCircle2 />}
              <AlertTitle>
                {state === "error" ? "Upload failed" : "Upload queued"}
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
        </form>
      </CardContent>
    </Card>
  );
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

async function uploadViaServer(
  file: File,
  startedAt: string | undefined,
  durationMs: number | undefined,
) {
  const formData = new FormData();
  formData.set("meeting-audio", file);
  if (startedAt) {
    formData.set("startedAt", startedAt);
  }
  if (durationMs) {
    formData.set("durationMs", String(durationMs));
  }

  const response = await fetch("/api/uploads/audio", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Server upload failed");
  }

  return readUploadQueuedResponse(response);
}

async function readUploadQueuedResponse(response: Response) {
  return (await response.json().catch(() => ({}))) as UploadQueuedResponse;
}

function getPostUploadPath(path: string | undefined) {
  return path === "/dashboard" ? path : "/dashboard";
}

function parseStartTimeInput(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const date = new Date(trimmed);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}
