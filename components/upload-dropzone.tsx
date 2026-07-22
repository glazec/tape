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
  readMediaFileDurationMs,
  waitForRecordingDurationMs,
} from "@/lib/recording-duration";
import {
  getUploadMediaFromFile,
  isUploadMediaSizeAllowed,
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const selectedDurationPromiseRef = useRef<Promise<number | undefined> | null>(
    null,
  );
  const [startTime, setStartTime] = useState("");

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;

    setSelectedFile(file);
    selectedDurationPromiseRef.current = file
      ? readMediaFileDurationMs(file)
      : null;
    setState("idle");
    setMessage(null);
    setSignInRequired(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("uploading");
    setMessage(null);
    setSignInRequired(false);

    if (!selectedFile || selectedFile.size === 0) {
      setState("error");
      setMessage("Select a recording file first");
      return;
    }

    if (!isUploadMediaSizeAllowed(selectedFile.size)) {
      setState("error");
      setMessage("Recording file must be 1 GB or smaller");
      return;
    }

    const uploadMedia = getUploadMediaFromFile(selectedFile);

    if (!uploadMedia) {
      setState("error");
      setMessage("Only MP3, M4A, MP4, MOV, WEBM, and MKV files are supported");
      return;
    }

    const startedAt = parseStartTimeInput(startTime);

    if (startedAt === null) {
      setState("error");
      setMessage("Enter a valid start time");
      return;
    }

    try {
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
        selectedDurationPromiseRef.current,
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
    } catch {
      setState("error");
      setMessage("Upload failed");
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
            className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <UploadCloud className="size-4" />
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="meeting-audio">Recording file</Label>
            <Input
              id="meeting-audio"
              name="meeting-audio"
              type="file"
              accept={uploadMediaAccept}
              onChange={handleFileChange}
              className="min-h-11 bg-background"
              aria-invalid={state === "error" && !startTimeInvalid}
            />
            <p className="text-xs text-muted-foreground">1 GB maximum.</p>
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
          {selectedFile ? (
            <p className="w-fit break-all rounded-md border bg-muted/45 px-2.5 py-1.5 text-sm text-muted-foreground">
              Selected file: {selectedFile.name}
            </p>
          ) : null}
          <Button
            type="submit"
            disabled={state === "uploading"}
            className="min-h-11 w-fit"
          >
            <UploadCloud data-icon="inline-start" />
            {state === "uploading" ? "Uploading recording" : "Upload recording"}
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
