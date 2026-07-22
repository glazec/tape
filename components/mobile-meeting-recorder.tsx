"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, LoaderCircle, Mic, Square } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ProductLogo } from "@/components/product-logo";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getMobileRecordingFileType,
  selectMobileRecorderMimeType,
} from "@/lib/mobile-recorder";

type RecorderState =
  | "idle"
  | "requesting"
  | "recording"
  | "uploading"
  | "error";

export function MobileMeetingRecorder({
  meetingId,
  meetingTitle,
}: {
  meetingId: string;
  meetingTitle: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<RecorderState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const stateRef = useRef<RecorderState>("idle");
  const chunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const skipNextPopStateRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStartedAtRef = useRef<Date | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  stateRef.current = state;

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (
        mediaRecorderRef.current?.state === "recording" ||
        stateRef.current === "requesting" ||
        stateRef.current === "uploading"
      ) {
        event.preventDefault();
      }
    };

    const handlePopState = () => {
      if (skipNextPopStateRef.current) {
        skipNextPopStateRef.current = false;
        return;
      }

      const isActive =
        stateRef.current === "requesting" ||
        stateRef.current === "recording" ||
        stateRef.current === "uploading";

      if (!isActive) {
        return;
      }

      if (!window.confirm("Discard this recording and leave this page?")) {
        skipNextPopStateRef.current = true;
        window.history.forward();
        return;
      }

      discardRecordingRef.current = true;
      uploadAbortControllerRef.current?.abort();
      clearTimer();
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === "recording") {
        recorder.stop();
      }
      stopStream();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
      discardRecordingRef.current = true;
      uploadAbortControllerRef.current?.abort();
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === "recording") {
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  async function startRecording() {
    setErrorMessage(null);

    if (
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      showError("Audio recording is not supported in this browser");
      return;
    }

    const mimeType = selectMobileRecorderMimeType((candidate) =>
      MediaRecorder.isTypeSupported(candidate),
    );

    if (!mimeType) {
      showError("This browser cannot create a supported audio recording");
      return;
    }

    discardRecordingRef.current = false;
    stateRef.current = "requesting";
    setState("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      if (discardRecordingRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const recorder = new MediaRecorder(stream, { mimeType });

      chunksRef.current = [];
      mediaRecorderRef.current = recorder;
      streamRef.current = stream;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });
      recorder.addEventListener("stop", () => {
        stopStream();
        if (!discardRecordingRef.current) {
          void uploadRecording(recorder.mimeType || mimeType);
        }
      });
      recorder.start(1000);
      recordingStartedAtRef.current = new Date();
      setElapsedSeconds(0);
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((seconds) => seconds + 1);
      }, 1000);
      stateRef.current = "recording";
      setState("recording");
    } catch {
      stopStream();
      if (discardRecordingRef.current) {
        return;
      }
      showError("Microphone access is required to record this meeting");
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state !== "recording") {
      return;
    }

    clearTimer();
    stateRef.current = "uploading";
    setState("uploading");
    recorder.stop();
  }

  function leaveRecorder() {
    const isActive =
      stateRef.current === "requesting" ||
      stateRef.current === "recording" ||
      stateRef.current === "uploading";

    if (
      isActive &&
      !window.confirm("Discard this recording and return to the meeting?")
    ) {
      return;
    }

    discardRecording();
    router.push(`/meetings/${encodeURIComponent(meetingId)}`);
  }

  function discardRecording() {
    discardRecordingRef.current = true;
    uploadAbortControllerRef.current?.abort();
    clearTimer();
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") {
      recorder.stop();
    }
    stopStream();
  }

  async function uploadRecording(mimeType: string) {
    if (discardRecordingRef.current) {
      return;
    }

    const fileType = getMobileRecordingFileType(mimeType);

    if (!fileType || chunksRef.current.length === 0) {
      showError("The recording was empty or used an unsupported format");
      return;
    }

    const file = new File(
      chunksRef.current,
      `meeting-recording.${fileType.extension}`,
      { type: fileType.contentType },
    );
    const formData = new FormData();
    formData.set("meeting-audio", file);
    const recordingStartedAt = recordingStartedAtRef.current;
    if (recordingStartedAt) {
      formData.set(
        "durationMs",
        String(Math.max(1, Date.now() - recordingStartedAt.getTime())),
      );
      formData.set("recordingStartedAt", recordingStartedAt.toISOString());
    }
    const controller = new AbortController();
    uploadAbortControllerRef.current = controller;

    try {
      const response = await fetch(
        `/api/meetings/${encodeURIComponent(meetingId)}/uploads/audio`,
        { body: formData, method: "POST", signal: controller.signal },
      );

      if (!response.ok) {
        throw new Error("Recording upload failed");
      }

      if (discardRecordingRef.current) {
        return;
      }

      router.replace(`/meetings/${encodeURIComponent(meetingId)}`);
      router.refresh();
    } catch (error) {
      if (
        discardRecordingRef.current ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return;
      }
      showError("Could not upload the recording. Please try again");
    } finally {
      if (uploadAbortControllerRef.current === controller) {
        uploadAbortControllerRef.current = null;
      }
    }
  }

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function showError(message: string) {
    clearTimer();
    stateRef.current = "error";
    setState("error");
    setErrorMessage(message);
  }

  const isBusy = state === "requesting" || state === "uploading";

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,var(--background)_0%,var(--surface)_100%)] text-foreground">
      <header className="border-b bg-background/95">
        <div className="mx-auto flex min-h-16 w-full max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
          <ProductLogo />
          <Button className="min-h-11" onClick={leaveRecorder} type="button" variant="ghost">
            <ArrowLeft data-icon="inline-start" />
            Back to meeting
          </Button>
        </div>
      </header>
      <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <div className="text-center">
          <p className="text-sm font-medium text-primary">Mobile recorder</p>
          <h1 className="mt-2 text-3xl font-semibold">Record this meeting</h1>
        </div>
        <Card className="w-full max-w-lg">
      <CardHeader className="border-b bg-muted/35">
        <CardTitle>{meetingTitle}</CardTitle>
        <CardDescription>
          Record this meeting with your phone microphone.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-6 py-8 text-center">
        <div
          aria-hidden="true"
          className={`flex size-24 items-center justify-center rounded-full ${
            state === "recording"
              ? "bg-destructive/15 text-destructive"
              : "bg-primary/10 text-primary"
          }`}
        >
          <Mic className="size-10" />
        </div>

        {state === "recording" ? (
          <div aria-live="polite">
            <p className="text-2xl font-semibold tabular-nums">
              {formatDuration(elapsedSeconds)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">Recording</p>
          </div>
        ) : null}

        {state === "recording" ? (
          <Button className="min-h-11" onClick={stopRecording} size="lg" variant="destructive">
            <Square data-icon="inline-start" />
            Stop and upload
          </Button>
        ) : (
          <Button className="min-h-11" disabled={isBusy} onClick={startRecording} size="lg">
            {isBusy ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <Mic data-icon="inline-start" />
            )}
            {state === "requesting"
              ? "Requesting microphone"
              : state === "uploading"
                ? "Uploading recording"
                : "Start recording"}
          </Button>
        )}

        <p className="max-w-sm text-sm leading-6 text-muted-foreground">
          Keep this page open while recording. Stopping uploads the audio and
          starts transcription automatically.
        </p>

        {errorMessage ? (
          <Alert className="text-left" variant="destructive">
            <AlertCircle />
            <AlertTitle>Recorder unavailable</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
        </Card>
      </section>
    </main>
  );
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
