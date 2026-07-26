"use client";

import { ChangeEvent, FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, FileText, Mic, UploadCloud } from "lucide-react";

import { MeetingLinkForm } from "@/components/meeting-link-form";
import { UploadDropzone } from "@/components/upload-dropzone";
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
import { cn } from "@/lib/utils";

type MeetingSource = "link" | "recording" | "transcript" | "phone";

const sourceOptions = [
  {
    description: "Send a bot to Google Meet or Zoom",
    icon: Bot,
    label: "Meeting link",
    value: "link" as const,
  },
  {
    description: "Upload audio or video for transcription",
    icon: UploadCloud,
    label: "Recording file",
    value: "recording" as const,
  },
  {
    description: "Paste text or upload TXT, SRT, or VTT",
    icon: FileText,
    label: "Transcript",
    value: "transcript" as const,
  },
  {
    description: "Use this phone as the recorder",
    icon: Mic,
    label: "Record on phone",
    value: "phone" as const,
  },
];

export function NewMeetingSources() {
  const [source, setSource] = useState<MeetingSource | null>(null);

  return (
    <div className="space-y-5">
      <div
        aria-label="Meeting source"
        className="grid gap-3 sm:grid-cols-2"
        role="group"
      >
        {sourceOptions.map((option) => {
          const Icon = option.icon;
          const selected = source === option.value;

          return (
            <button
              aria-pressed={selected}
              className={cn(
                "min-h-24 rounded-lg border bg-card p-4 text-left outline-none transition-colors hover:border-primary/50 focus-visible:ring-3 focus-visible:ring-ring/50",
                selected && "border-primary bg-primary/5",
              )}
              key={option.value}
              onClick={() => setSource(option.value)}
              type="button"
            >
              <Icon
                className={cn(
                  "size-4",
                  selected ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span className="mt-2 block font-semibold">{option.label}</span>
              <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                {option.description}
              </span>
            </button>
          );
        })}
      </div>

      {source === "link" ? <MeetingLinkForm /> : null}
      {source === "recording" ? <UploadDropzone /> : null}
      {source === "transcript" ? <NewTranscriptForm /> : null}
      {source === "phone" ? <PhoneRecordingForm /> : null}
    </div>
  );
}

function NewTranscriptForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  function changeText(event: ChangeEvent<HTMLTextAreaElement>) {
    setTranscriptText(event.currentTarget.value);
    if (event.currentTarget.value && transcriptFile) {
      setTranscriptFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!transcriptText.trim() && (!transcriptFile || transcriptFile.size === 0)) {
      setState("error");
      setError("Paste transcript text or choose a transcript file");
      return;
    }

    setState("saving");

    try {
      const meetingId = await createManualMeeting(title || "Transcript upload");
      const formData = new FormData();
      if (transcriptText.trim()) {
        formData.set("transcriptText", transcriptText.trim());
      }
      if (transcriptFile) {
        formData.set("transcript-file", transcriptFile);
      }

      const response = await fetch(`/api/meetings/${meetingId}/uploads/transcript`, {
        body: formData,
        method: "POST",
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        await fetch(`/api/meetings/${encodeURIComponent(meetingId)}`, {
          method: "DELETE",
        }).catch(() => null);
        setState("error");
        setError(body?.error ?? "Transcript could not be added. Try again.");
        return;
      }

      router.push(`/meetings/${meetingId}`);
      router.refresh();
    } catch {
      setState("error");
      setError("Transcript could not be added. Try again.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a transcript</CardTitle>
        <CardDescription>Create a meeting from transcript text or a file.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="new-transcript-title">Meeting title</Label>
            <Input
              className="min-h-11"
              id="new-transcript-title"
              maxLength={100}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder="Meeting title"
              value={title}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-transcript-text">Transcript text</Label>
            <textarea
              className="min-h-36 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              id="new-transcript-text"
              onChange={changeText}
              placeholder="Paste transcript text"
              value={transcriptText}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-transcript-file">Or choose a file</Label>
            <Input
              className="min-h-11"
              accept=".txt,.srt,.vtt,text/plain,text/vtt"
              id="new-transcript-file"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                setTranscriptFile(file);
                if (file) {
                  setTranscriptText("");
                }
              }}
              ref={fileInputRef}
              type="file"
            />
          </div>
          <Button className="min-h-11" disabled={state === "saving"} type="submit">
            <FileText data-icon="inline-start" />
            {state === "saving" ? "Adding transcript" : "Add transcript"}
          </Button>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not add transcript</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

function PhoneRecordingForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("saving");

    try {
      const meetingId = await createManualMeeting(title || "Phone recording");
      router.push(`/meetings/${meetingId}/record`);
    } catch {
      setState("error");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record on this phone</CardTitle>
        <CardDescription>Create the meeting, then open the focused recorder.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="phone-recording-title">Meeting title</Label>
            <Input
              className="min-h-11"
              id="phone-recording-title"
              maxLength={100}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder="Meeting title"
              value={title}
            />
          </div>
          <Button className="min-h-11" disabled={state === "saving"} type="submit">
            <Mic data-icon="inline-start" />
            {state === "saving" ? "Opening recorder" : "Open phone recorder"}
          </Button>
          {state === "error" ? (
            <Alert variant="destructive">
              <AlertTitle>Recorder unavailable</AlertTitle>
              <AlertDescription>The meeting could not be created. Try again.</AlertDescription>
            </Alert>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

async function createManualMeeting(title: string) {
  const response = await fetch("/api/meetings/manual", {
    body: JSON.stringify({ title }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = (await response.json().catch(() => null)) as {
    meetingId?: string;
  } | null;

  if (!response.ok || !body?.meetingId) {
    throw new Error("Meeting creation failed");
  }

  return body.meetingId;
}
