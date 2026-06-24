"use client";

import { ChangeEvent, FormEvent, useState } from "react";
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

export function UploadDropzone() {
  const [state, setState] = useState<UploadState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

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

      if (!uploadedDirectly) {
        await uploadViaServer(selectedFile);
      } else {
        const completeResponse = await fetch("/api/uploads/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ uploadId }),
        });

        if (!completeResponse.ok) {
          throw new Error("Upload completion failed");
        }
      }

      setState("complete");
      setMessage("Upload complete. Transcription queued");
    } catch {
      setState("error");
      setMessage("Upload failed");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload MP3</CardTitle>
        <CardDescription>
          Add an existing recording and queue transcription.
        </CardDescription>
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
              aria-invalid={state === "error"}
            />
          </div>
          {selectedFile ? (
            <p className="break-all text-sm text-muted-foreground">
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

async function uploadViaServer(file: File) {
  const formData = new FormData();
  formData.set("meeting-audio", file);

  const response = await fetch("/api/uploads/audio", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Server upload failed");
  }
}
