"use client";

import { ChangeEvent, FormEvent, useState } from "react";
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
  const [startTime, setStartTime] = useState("");

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFile(event.currentTarget.files?.[0] ?? null);
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
      setMessage("Select an MP3 file first");
      return;
    }

    if (!selectedFile.name.toLowerCase().endsWith(".mp3")) {
      setState("error");
      setMessage("Only MP3 files are supported");
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
          extension: "mp3",
          contentType: "audio/mpeg",
        }),
      });

      if (signResponse.status === 401) {
        setState("error");
        setMessage("Sign in to upload MP3 files");
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

      const uploadedDirectly = await uploadDirectly(uploadUrl, selectedFile);

      let queuedResult: UploadQueuedResponse;

      if (!uploadedDirectly) {
        queuedResult = await uploadViaServer(selectedFile, startedAt);
      } else {
        const completeResponse = await fetch("/api/uploads/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            uploadId,
            fileName: selectedFile.name,
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
            <CardTitle>Upload MP3</CardTitle>
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
            <Label htmlFor="meeting-audio">Audio file</Label>
            <Input
              id="meeting-audio"
              name="meeting-audio"
              type="file"
              accept="audio/mpeg,.mp3"
              onChange={handleFileChange}
              className="bg-background"
              aria-invalid={state === "error" && !startTimeInvalid}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="meeting-start-time">Start time</Label>
            <Input
              id="meeting-start-time"
              name="startedAt"
              type="datetime-local"
              value={startTime}
              onChange={(event) => setStartTime(event.currentTarget.value)}
              className="bg-background"
              aria-invalid={startTimeInvalid}
            />
          </div>
          {selectedFile ? (
            <p className="w-fit break-all rounded-md border bg-muted/45 px-2.5 py-1.5 text-sm text-muted-foreground">
              Selected file: {selectedFile.name}
            </p>
          ) : null}
          <Button
            type="submit"
            disabled={state === "uploading"}
            className="w-fit"
          >
            <UploadCloud data-icon="inline-start" />
            {state === "uploading" ? "Uploading..." : "Upload"}
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

async function uploadDirectly(uploadUrl: string, file: File) {
  try {
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "audio/mpeg" },
      body: file,
    });

    return uploadResponse.ok;
  } catch {
    return false;
  }
}

async function uploadViaServer(file: File, startedAt: string | undefined) {
  const formData = new FormData();
  formData.set("meeting-audio", file);
  if (startedAt) {
    formData.set("startedAt", startedAt);
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
