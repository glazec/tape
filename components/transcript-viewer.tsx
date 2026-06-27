"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
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

export type SpeakerSuggestion = {
  email: string;
  name: string;
};

type EditingSpeaker = {
  allowSegmentScope: boolean;
  currentSpeaker: string | null;
  segmentId: string;
  speakerKey: string;
};

type SpeakerApplyScope = "matching_speaker" | "segment";

const WAVEFORM_DESKTOP_BAR_COUNT = 120;
const WAVEFORM_MOBILE_BAR_COUNT = 56;
const WAVEFORM_MOBILE_QUERY = "(max-width: 640px)";
const WAVEFORM_SECTION_COLORS = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
];

type TranscriptViewerProps = {
  audioUrl?: string | null;
  meetingId?: string | null;
  segments: TranscriptSegment[];
  speakerSuggestions?: SpeakerSuggestion[];
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
  speakerSuggestions = [],
}: TranscriptViewerProps) {
  const [segments, setSegments] = useState(initialSegments);
  const [editingSpeaker, setEditingSpeaker] = useState<EditingSpeaker | null>(
    null,
  );
  const [draftSpeaker, setDraftSpeaker] = useState("");
  const [speakerApplyScope, setSpeakerApplyScope] =
    useState<SpeakerApplyScope>("matching_speaker");
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

  function startEditing(speaker: string | null, segmentId?: string) {
    const speakerKey = getSpeakerKey(speaker);
    const targetSegmentId =
      segmentId ??
      segments.find((segment) => getSpeakerKey(segment.speaker) === speakerKey)
        ?.id;

    if (!targetSegmentId) {
      return;
    }

    setEditingSpeaker({
      allowSegmentScope: Boolean(segmentId),
      currentSpeaker: speaker,
      segmentId: targetSegmentId,
      speakerKey,
    });
    setDraftSpeaker(speaker ?? "");
    setSpeakerApplyScope("matching_speaker");
    setErrorSpeakerKey(null);
  }

  async function saveSpeaker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const speaker = draftSpeaker.trim();

    if (!meetingId || !editingSpeaker) {
      return;
    }

    const speakerKey = editingSpeaker.speakerKey;

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
          applyTo: speakerApplyScope,
          currentSpeaker: editingSpeaker.currentSpeaker,
          segmentId: editingSpeaker.segmentId,
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
        speakerApplyScope === "segment"
          ? segment.id === editingSpeaker.segmentId
            ? { ...segment, speaker }
            : segment
          : getSpeakerKey(segment.speaker) === speakerKey
          ? { ...segment, speaker }
          : segment,
      ),
    );
    setEditingSpeaker(null);
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
      <section className={audioUrl ? "pb-44" : undefined}>
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
                const isEditing = editingSpeaker?.segmentId === segment.id;
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
                            className="flex w-full max-w-xl flex-col gap-2"
                            onSubmit={saveSpeaker}
                          >
                            <div className="flex min-w-0 items-center gap-1.5">
                              <Input
                                aria-label="Speaker name"
                                aria-invalid={hasError}
                                list="speaker-suggestions"
                                onChange={(event) =>
                                  setDraftSpeaker(event.currentTarget.value)
                                }
                                placeholder="Speaker name"
                                value={draftSpeaker}
                              />
                              <datalist id="speaker-suggestions">
                                {speakerSuggestions.map((suggestion) => (
                                  <option
                                    key={suggestion.email}
                                    label={suggestion.email}
                                    value={suggestion.name}
                                  />
                                ))}
                              </datalist>
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
                                onClick={() => setEditingSpeaker(null)}
                                size="icon"
                                type="button"
                                variant="outline"
                              >
                                <X />
                              </Button>
                            </div>
                            {speakerSuggestions.length > 0 ? (
                              <div
                                aria-label="Speaker suggestions"
                                className="flex flex-wrap gap-1.5"
                              >
                                {speakerSuggestions.slice(0, 8).map((suggestion) => (
                                  <button
                                    className="inline-flex h-7 max-w-full items-center rounded-md border px-2 text-xs font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                                    key={suggestion.email}
                                    onClick={() =>
                                      setDraftSpeaker(suggestion.name)
                                    }
                                    type="button"
                                  >
                                    <span className="truncate">
                                      {suggestion.name}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            {editingSpeaker?.allowSegmentScope ? (
                              <div className="inline-flex w-fit rounded-md border bg-background p-0.5">
                                <button
                                  aria-pressed={
                                    speakerApplyScope === "matching_speaker"
                                  }
                                  className={cn(
                                    "h-7 rounded px-2 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                                    speakerApplyScope === "matching_speaker"
                                      ? "bg-muted text-foreground"
                                      : "text-muted-foreground hover:text-foreground",
                                  )}
                                  onClick={() =>
                                    setSpeakerApplyScope("matching_speaker")
                                  }
                                  type="button"
                                >
                                  All matching
                                </button>
                                <button
                                  aria-pressed={speakerApplyScope === "segment"}
                                  className={cn(
                                    "h-7 rounded px-2 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                                    speakerApplyScope === "segment"
                                      ? "bg-muted text-foreground"
                                      : "text-muted-foreground hover:text-foreground",
                                  )}
                                  onClick={() => setSpeakerApplyScope("segment")}
                                  type="button"
                                >
                                  This line
                                </button>
                              </div>
                            ) : null}
                            {hasError ? (
                              <p className="text-xs font-medium text-destructive">
                                Add a speaker name.
                              </p>
                            ) : null}
                          </form>
                        ) : canEditSpeakers ? (
                          <button
                            aria-label={`Edit speaker ${segment.speaker ?? "Unknown speaker"}`}
                            className="group inline-flex min-h-8 items-center gap-2 rounded-lg px-0 text-left text-sm font-semibold text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                            onClick={() => startEditing(segment.speaker, segment.id)}
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
          activeSegmentId={activeSegmentId}
          audioRef={audioRef}
          audioUrl={audioUrl}
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          playbackRate={playbackRate}
          segments={segments}
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
  activeSegmentId,
  audioRef,
  audioUrl,
  currentTime,
  duration,
  isPlaying,
  playbackRate,
  segments,
  setCurrentTime,
  setDuration,
  setIsPlaying,
  setPlaybackRate,
}: {
  activeSegmentId: string | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  audioUrl: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate: number;
  segments: TranscriptSegment[];
  setCurrentTime: (value: number) => void;
  setDuration: (value: number) => void;
  setIsPlaying: (value: boolean) => void;
  setPlaybackRate: (value: number) => void;
}) {
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [waveformStatus, setWaveformStatus] = useState<
    "idle" | "loading" | "ready" | "fallback"
  >("idle");
  const waveformBarCount = useWaveformBarCount();
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const segmentDuration = useMemo(() => getSegmentTimelineDuration(segments), [
    segments,
  ]);
  const timelineDuration = safeDuration || segmentDuration;
  const progressValue = safeDuration ? currentTime : 0;
  const waveformValues = useMemo(() => {
    if (waveformPeaks.length > 0) {
      return waveformPeaks;
    }

    return buildFallbackWaveform(segments, waveformBarCount);
  }, [segments, waveformBarCount, waveformPeaks]);
  const sectionMarkers = useMemo(
    () => buildWaveformSections(segments, timelineDuration),
    [segments, timelineDuration],
  );
  const progressPercent = timelineDuration
    ? clamp((currentTime / timelineDuration) * 100, 0, 100)
    : 0;

  useEffect(() => {
    let isCancelled = false;
    const controller = new AbortController();

    async function loadWaveform() {
      setWaveformStatus("loading");
      setWaveformPeaks([]);

      try {
        const response = await fetch(getWaveformAudioUrl(audioUrl), {
          credentials: "include",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Audio waveform request failed");
        }

        const arrayBuffer = await response.arrayBuffer();
        const AudioContextConstructor =
          window.AudioContext ??
          (window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }).webkitAudioContext;

        if (!AudioContextConstructor) {
          throw new Error("AudioContext is unavailable");
        }

        const audioContext = new AudioContextConstructor();

        try {
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          const peaks = buildAudioPeaks(audioBuffer, waveformBarCount);

          if (!isCancelled) {
            setWaveformPeaks(peaks);
            setWaveformStatus("ready");
          }
        } finally {
          void audioContext.close();
        }
      } catch {
        if (!isCancelled && !controller.signal.aborted) {
          setWaveformStatus("fallback");
          setWaveformPeaks([]);
        }
      }
    }

    void loadWaveform();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [audioUrl, waveformBarCount]);

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

  function seekFromWaveform(event: PointerEvent<HTMLButtonElement>) {
    const audio = audioRef.current;

    if (!audio || !timelineDuration) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const position = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const nextTime = position * timelineDuration;

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
        <button
          aria-label="Audio waveform"
          className="relative h-16 w-full overflow-hidden rounded-lg border bg-background px-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-14 sm:px-1"
          onPointerDown={seekFromWaveform}
          type="button"
        >
          {sectionMarkers.map((section) => (
            <span
              aria-hidden="true"
              className="absolute inset-y-1 rounded-md"
              key={section.id}
              style={{
                backgroundColor: getWaveformSectionColor(section.speaker),
                left: `${section.left}%`,
                opacity: section.id === activeSegmentId ? 0.16 : 0.06,
                width: `${section.width}%`,
              }}
            />
          ))}
          <span
            aria-hidden="true"
            className="absolute inset-x-2 bottom-3 top-2 flex items-center gap-[2px] sm:inset-x-1 sm:bottom-2 sm:gap-px"
          >
            {waveformValues.map((peak, index) => {
              const barPercent =
                ((index + 0.5) / waveformValues.length) * 100;
              const isPast = barPercent <= progressPercent;

              return (
                <span
                  className={cn(
                    "min-w-0 flex-1 rounded-[2px] transition-colors",
                    isPast ? "bg-primary" : "bg-muted-foreground/40",
                  )}
                  key={`${index}-${waveformStatus}`}
                  style={{
                    height: `${Math.round(6 + peak * 34)}px`,
                  }}
                />
              );
            })}
          </span>
          <span
            aria-hidden="true"
            className="absolute inset-x-2 bottom-1 h-1 overflow-hidden rounded-full bg-muted sm:inset-x-1"
          >
            {sectionMarkers.map((section) => (
              <span
                className="absolute inset-y-0"
                key={`${section.id}-rail`}
                style={{
                  backgroundColor: getWaveformSectionColor(section.speaker),
                  left: `${section.left}%`,
                  opacity: section.id === activeSegmentId ? 0.95 : 0.55,
                  width: `${section.width}%`,
                }}
              />
            ))}
          </span>
          <span
            aria-hidden="true"
            className="absolute bottom-1 top-1 w-0.5 rounded-full bg-primary shadow-[0_0_0_1px_var(--background)]"
            style={{ left: `${progressPercent}%` }}
          />
          <span aria-live="polite" className="sr-only">
            {waveformStatus === "ready"
              ? "Audio waveform ready"
              : "Transcript section waveform"}
          </span>
        </button>
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

function useWaveformBarCount() {
  const [barCount, setBarCount] = useState(WAVEFORM_DESKTOP_BAR_COUNT);

  useEffect(() => {
    const mediaQuery = window.matchMedia(WAVEFORM_MOBILE_QUERY);
    const updateBarCount = () => {
      setBarCount(
        mediaQuery.matches
          ? WAVEFORM_MOBILE_BAR_COUNT
          : WAVEFORM_DESKTOP_BAR_COUNT,
      );
    };

    updateBarCount();
    mediaQuery.addEventListener("change", updateBarCount);

    return () => {
      mediaQuery.removeEventListener("change", updateBarCount);
    };
  }, []);

  return barCount;
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

function getWaveformAudioUrl(audioUrl: string) {
  const separator = audioUrl.includes("?") ? "&" : "?";

  return `${audioUrl}${separator}proxy=1`;
}

function buildAudioPeaks(audioBuffer: AudioBuffer, count: number) {
  const channelCount = Math.min(audioBuffer.numberOfChannels, 2);
  const samplesPerPeak = Math.max(1, Math.floor(audioBuffer.length / count));
  const peaks: number[] = [];

  for (let peakIndex = 0; peakIndex < count; peakIndex += 1) {
    const start = peakIndex * samplesPerPeak;
    const end = Math.min(start + samplesPerPeak, audioBuffer.length);
    let sum = 0;
    let sampleCount = 0;

    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const samples = audioBuffer.getChannelData(channelIndex);

      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        sum += samples[sampleIndex] ** 2;
        sampleCount += 1;
      }
    }

    peaks.push(Math.sqrt(sum / Math.max(1, sampleCount)));
  }

  return normalizePeaks(peaks);
}

function buildFallbackWaveform(segments: TranscriptSegment[], count: number) {
  if (segments.length === 0) {
    return Array.from({ length: count }, () => 0.18);
  }

  const totalMs = getSegmentTimelineDuration(segments);

  if (!totalMs) {
    return Array.from({ length: count }, () => 0.18);
  }

  const peaks = Array.from({ length: count }, (_, index) => {
    const currentMs = (index / count) * totalMs;
    const segment = findSegmentAtTime(segments, currentMs);

    if (!segment) {
      return 0.12;
    }

    const segmentMs = Math.max(1, (segment.endMs ?? segment.startMs) - segment.startMs);
    const density = segment.text.length / (segmentMs / 1000);

    return Math.min(1, 0.18 + density / 45);
  });

  return normalizePeaks(peaks);
}

function normalizePeaks(peaks: number[]) {
  const maxPeak = Math.max(...peaks, 0.01);

  return peaks.map((peak) => {
    const normalizedPeak = clamp(peak / maxPeak, 0, 1);
    const shapedPeak = normalizedPeak ** 1.45;

    return clamp(0.08 + shapedPeak * 0.92, 0.08, 1);
  });
}

function buildWaveformSections(
  segments: TranscriptSegment[],
  timelineDuration: number,
) {
  if (!timelineDuration) {
    return [];
  }

  return segments
    .map((segment, index) => {
      const nextSegment = segments[index + 1];
      const endMs = segment.endMs ?? nextSegment?.startMs ?? timelineDuration * 1000;
      const left = clamp((segment.startMs / 1000 / timelineDuration) * 100, 0, 100);
      const width = clamp(
        ((endMs - segment.startMs) / 1000 / timelineDuration) * 100,
        0.4,
        100 - left,
      );

      return {
        id: segment.id,
        left,
        speaker: segment.speaker,
        width,
      };
    })
    .filter((section) => section.width > 0);
}

function getWaveformSectionColor(speaker: string | null) {
  const speakerKey = getSpeakerKey(speaker);
  let hash = 0;

  for (let index = 0; index < speakerKey.length; index += 1) {
    hash = (hash * 31 + speakerKey.charCodeAt(index)) >>> 0;
  }

  return WAVEFORM_SECTION_COLORS[hash % WAVEFORM_SECTION_COLORS.length];
}

function getSegmentTimelineDuration(segments: TranscriptSegment[]) {
  const lastSegment = segments.at(-1);

  if (!lastSegment) {
    return 0;
  }

  return Math.max(lastSegment.endMs ?? lastSegment.startMs, 0) / 1000;
}

function findSegmentAtTime(segments: TranscriptSegment[], currentMs: number) {
  return (
    segments.find((segment, index) => {
      const nextSegment = segments[index + 1];
      const endMs =
        segment.endMs ?? nextSegment?.startMs ?? Number.POSITIVE_INFINITY;

      return currentMs >= segment.startMs && currentMs < endMs;
    }) ?? null
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getSpeakerKey(speaker: string | null) {
  return speaker ?? "__unknown__";
}
