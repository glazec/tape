"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type RefObject,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  Pause,
  Pencil,
  Play,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type TranscriptSegment = {
  id: string;
  speaker: string | null;
  startMs: number;
  endMs: number | null;
  text: string;
};

type TranscriptViewerProps = {
  audioUrl?: string | null;
  meetingId?: string | null;
  segments: TranscriptSegment[];
};

function formatTimestamp(startMs: number) {
  const totalSeconds = Math.floor(startMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function TranscriptViewer({
  audioUrl,
  meetingId,
  segments: initialSegments,
}: TranscriptViewerProps) {
  const [segments, setSegments] = useState(initialSegments);
  const [editingSpeakerKey, setEditingSpeakerKey] = useState<string | null>(
    null,
  );
  const [draftSpeaker, setDraftSpeaker] = useState("");
  const [savingSpeakerKey, setSavingSpeakerKey] = useState<string | null>(null);
  const [errorSpeakerKey, setErrorSpeakerKey] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const canEditSpeakers = Boolean(meetingId);
  const activeSegmentId = useMemo(() => {
    const currentMs = currentTime * 1000;

    return (
      segments.find((segment, index) => {
        const nextSegment = segments[index + 1];
        const endMs =
          segment.endMs ?? nextSegment?.startMs ?? Number.POSITIVE_INFINITY;

        return currentMs >= segment.startMs && currentMs < endMs;
      })?.id ?? null
    );
  }, [currentTime, segments]);
  const speakerStats = useMemo(() => {
    const speakerDurations = new Map<
      string,
      { speaker: string | null; totalMs: number }
    >();
    let totalMs = 0;

    for (const segment of segments) {
      const durationMs = Math.max(
        1,
        (segment.endMs ?? segment.startMs) - segment.startMs,
      );
      const speakerKey = getSpeakerKey(segment.speaker);
      const current = speakerDurations.get(speakerKey) ?? {
        speaker: segment.speaker,
        totalMs: 0,
      };

      current.totalMs += durationMs;
      totalMs += durationMs;
      speakerDurations.set(speakerKey, current);
    }

    return Array.from(speakerDurations.values())
      .map((speaker) => ({
        ...speaker,
        percent: totalMs ? Math.round((speaker.totalMs / totalMs) * 100) : 0,
      }))
      .sort((left, right) => right.totalMs - left.totalMs);
  }, [segments]);

  function startEditing(speaker: string | null) {
    setEditingSpeakerKey(getSpeakerKey(speaker));
    setDraftSpeaker(speaker ?? "");
    setErrorSpeakerKey(null);
  }

  async function saveSpeaker(
    event: FormEvent<HTMLFormElement>,
    currentSpeaker: string | null,
  ) {
    event.preventDefault();
    const speaker = draftSpeaker.trim();
    const speakerKey = getSpeakerKey(currentSpeaker);

    if (!meetingId) {
      return;
    }

    if (!speaker) {
      setErrorSpeakerKey(speakerKey);
      return;
    }

    setSavingSpeakerKey(speakerKey);
    setErrorSpeakerKey(null);

    const response = await fetch(
      `/api/meetings/${encodeURIComponent(meetingId)}/speakers`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          currentSpeaker,
          speaker,
        }),
      },
    );

    setSavingSpeakerKey(null);

    if (!response.ok) {
      setErrorSpeakerKey(speakerKey);
      return;
    }

    setSegments((currentSegments) =>
      currentSegments.map((segment) =>
        getSpeakerKey(segment.speaker) === speakerKey
          ? { ...segment, speaker }
          : segment,
      ),
    );
    setEditingSpeakerKey(null);
  }

  async function seekTo(startMs: number) {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.currentTime = startMs / 1000;
    setCurrentTime(audio.currentTime);

    try {
      await audio.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  }

  return (
    <>
      <section className={audioUrl ? "pb-28" : undefined}>
        <header className="mb-5">
          <h2 className="text-lg font-semibold">Transcript</h2>
        </header>

        {segments.length === 0 ? (
          <p className="border-t py-8 text-sm text-muted-foreground">
            No transcript text yet.
          </p>
        ) : (
          <>
            <div className="mb-5 border-t py-4">
              <h3 className="text-sm font-semibold">Speakers</h3>
              <div className="mt-3 flex min-w-0 flex-wrap gap-2">
                {speakerStats.map((speaker) => {
                  const content = (
                    <>
                      <span>{speaker.speaker ?? "Unknown speaker"}</span>
                      <span className="text-xs text-muted-foreground">
                        {speaker.percent}%
                      </span>
                    </>
                  );

                  return canEditSpeakers ? (
                    <button
                      className="inline-flex h-8 items-center gap-2 rounded-md border px-2 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                      key={getSpeakerKey(speaker.speaker)}
                      onClick={() => startEditing(speaker.speaker)}
                      type="button"
                    >
                      {content}
                    </button>
                  ) : (
                    <span
                      className="inline-flex h-8 items-center gap-2 rounded-md border px-2 text-sm font-medium"
                      key={getSpeakerKey(speaker.speaker)}
                    >
                      {content}
                    </span>
                  );
                })}
              </div>
            </div>
            <ol className="border-t">
              {segments.map((segment) => {
                const speakerKey = getSpeakerKey(segment.speaker);
                const isEditing = editingSpeakerKey === speakerKey;
                const isSaving = savingSpeakerKey === speakerKey;
                const hasError = errorSpeakerKey === speakerKey;
                const isActive = activeSegmentId === segment.id;

                return (
                  <li
                    key={segment.id}
                    className={cn(
                      "grid gap-4 border-b py-5 transition-colors sm:grid-cols-[6rem_minmax(0,1fr)]",
                      isActive ? "bg-primary/5 px-3 sm:-mx-3" : undefined,
                    )}
                  >
                    <button
                      aria-label={`Play from ${formatTimestamp(segment.startMs)}`}
                      className="h-7 w-fit rounded-md text-left text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                      onClick={() => seekTo(segment.startMs)}
                      type="button"
                    >
                      {formatTimestamp(segment.startMs)}
                    </button>
                    <div className="min-w-0">
                      <div className="mb-2 flex min-h-8 items-center">
                        {isEditing ? (
                          <form
                            className="flex w-full max-w-xs items-center gap-1.5"
                            onSubmit={(event) =>
                              saveSpeaker(event, segment.speaker)
                            }
                          >
                            <Input
                              aria-label="Speaker name"
                              aria-invalid={hasError}
                              onChange={(event) =>
                                setDraftSpeaker(event.currentTarget.value)
                              }
                              value={draftSpeaker}
                            />
                            <Button
                              aria-label="Save speaker"
                              disabled={isSaving}
                              size="icon"
                              type="submit"
                            >
                              <Check />
                            </Button>
                            <Button
                              aria-label="Cancel speaker edit"
                              disabled={isSaving}
                              onClick={() => setEditingSpeakerKey(null)}
                              size="icon"
                              type="button"
                              variant="outline"
                            >
                              <X />
                            </Button>
                          </form>
                        ) : canEditSpeakers ? (
                          <button
                            className="group inline-flex min-h-8 items-center gap-2 rounded-lg px-0 text-left text-sm font-semibold text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                            onClick={() => startEditing(segment.speaker)}
                            type="button"
                          >
                            <span>
                              {segment.speaker ?? "Unknown speaker"}
                            </span>
                            <Pencil className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                          </button>
                        ) : (
                          <p className="text-sm font-semibold text-foreground">
                            {segment.speaker ?? "Unknown speaker"}
                          </p>
                        )}
                      </div>
                      <p className="text-[0.95rem] leading-7 text-foreground">
                        {segment.text}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>

      {audioUrl ? (
        <TranscriptAudioPlayer
          audioRef={audioRef}
          audioUrl={audioUrl}
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          playbackRate={playbackRate}
          setCurrentTime={setCurrentTime}
          setDuration={setDuration}
          setIsPlaying={setIsPlaying}
          setPlaybackRate={setPlaybackRate}
        />
      ) : null}
    </>
  );
}

function TranscriptAudioPlayer({
  audioRef,
  audioUrl,
  currentTime,
  duration,
  isPlaying,
  playbackRate,
  setCurrentTime,
  setDuration,
  setIsPlaying,
  setPlaybackRate,
}: {
  audioRef: RefObject<HTMLAudioElement | null>;
  audioUrl: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate: number;
  setCurrentTime: (value: number) => void;
  setDuration: (value: number) => void;
  setIsPlaying: (value: boolean) => void;
  setPlaybackRate: (value: number) => void;
}) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const progressValue = safeDuration ? currentTime : 0;

  async function togglePlayback() {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (audio.paused) {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
      return;
    }

    audio.pause();
    setIsPlaying(false);
  }

  function skipBy(seconds: number) {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const upperBound = safeDuration || audio.duration || 0;
    const nextTime = Math.min(
      Math.max(audio.currentTime + seconds, 0),
      upperBound,
    );
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  function seek(event: ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    const nextTime = Number(event.currentTarget.value);

    if (!audio) {
      return;
    }

    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  function changePlaybackRate(event: ChangeEvent<HTMLSelectElement>) {
    const audio = audioRef.current;
    const nextRate = Number(event.currentTarget.value);

    if (audio) {
      audio.playbackRate = nextRate;
    }

    setPlaybackRate(nextRate);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
      <audio
        onDurationChange={(event) =>
          setDuration(event.currentTarget.duration || 0)
        }
        onEnded={() => setIsPlaying(false)}
        onPause={() => setIsPlaying(false)}
        onPlay={(event) => {
          event.currentTarget.playbackRate = playbackRate;
          setIsPlaying(true);
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        ref={audioRef}
        src={audioUrl}
      />
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3">
        <input
          aria-label="Audio progress"
          className="h-2 w-full accent-primary"
          max={safeDuration || 0}
          min={0}
          onChange={seek}
          step="0.1"
          type="range"
          value={progressValue}
        />
        <div className="grid min-w-0 grid-cols-[4rem_1fr_4rem] items-center gap-3 sm:grid-cols-[5rem_1fr_5rem]">
          <p className="text-xs font-medium tabular-nums text-muted-foreground">
            {formatPlayerTime(currentTime)}
          </p>
          <div className="flex min-w-0 items-center justify-center gap-2">
            <Button
              aria-label="Skip back 5 seconds"
              onClick={() => skipBy(-5)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <SkipBack />
            </Button>
            <Button
              aria-label={isPlaying ? "Pause audio" : "Play audio"}
              onClick={togglePlayback}
              size="icon-lg"
              type="button"
            >
              {isPlaying ? <Pause /> : <Play />}
            </Button>
            <Button
              aria-label="Skip forward 5 seconds"
              onClick={() => skipBy(5)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <SkipForward />
            </Button>
            <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <span className="sr-only">Playback speed</span>
              <select
                className="h-8 rounded-md border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onChange={changePlaybackRate}
                value={playbackRate}
              >
                <option value={0.75}>0.75x</option>
                <option value={1}>1x</option>
                <option value={1.25}>1.25x</option>
                <option value={1.5}>1.5x</option>
                <option value={2}>2x</option>
              </select>
            </label>
          </div>
          <p className="text-right text-xs font-medium tabular-nums text-muted-foreground">
            {formatPlayerTime(safeDuration)}
          </p>
        </div>
      </div>
    </div>
  );
}

function formatPlayerTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "00:00";
  }

  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function getSpeakerKey(speaker: string | null) {
  return speaker ?? "__unknown__";
}
