"use client";

import { FormEvent, useState } from "react";

type UploadState = "idle" | "uploading" | "complete" | "error";

export function UploadDropzone() {
  const [state, setState] = useState<UploadState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("uploading");
    setMessage(null);

    const formData = new FormData(event.currentTarget);
    const file = formData.get("meeting-audio");

    if (!(file instanceof File) || file.size === 0) {
      setState("error");
      setMessage("Select an MP3 file first");
      return;
    }

    if (file.type && file.type !== "audio/mpeg") {
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

      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": "audio/mpeg" },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error("File upload failed");
      }

      const completeResponse = await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId }),
      });

      if (!completeResponse.ok) {
        throw new Error("Upload completion failed");
      }

      setState("complete");
      setMessage("Upload complete. Transcription queued");
    } catch {
      setState("error");
      setMessage("Upload failed");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-white p-5"
    >
      <label htmlFor="meeting-audio" className="text-sm font-medium">
        Upload MP3
      </label>
      <input
        id="meeting-audio"
        name="meeting-audio"
        type="file"
        accept="audio/mpeg"
        className="text-sm"
      />
      <button
        type="submit"
        disabled={state === "uploading"}
        className="w-fit rounded-md bg-[var(--text)] px-4 py-2 text-sm font-medium text-white"
      >
        {state === "uploading" ? "Uploading..." : "Upload"}
      </button>
      {message ? (
        <p
          className={
            state === "error" ? "text-sm text-red-700" : "text-sm text-emerald-700"
          }
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
