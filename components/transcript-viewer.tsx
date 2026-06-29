"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
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
  RotateCcw,
  RotateCw,
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
  translatedText?: string | null;
  emotionLabel?: "hard" | "chill" | "neutral" | null;
  emotionReason?: string | null;
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
const WPM_GRAPH_MAX = 260;
const WPM_GRAPH_WINDOW_SECONDS = 30;
const WPM_GRAPH_MAX_WINDOW_SECONDS = 90;
const WPM_GRAPH_MIN_SAMPLE_SECONDS = 8;
const TRANSCRIPT_FALLBACK_WORD_PATTERN = /[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?/g;
const TRANSCRIPT_CJK_CHARACTER_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/g;
const transcriptWordSegmenter = createTranscriptWordSegmenter();

type TranscriptViewerProps = {
  audioUrl?: string | null;
  meetingId?: string | null;
  segments: TranscriptSegment[];
  speakerSuggestions?: SpeakerSuggestion[];
};

type WaveformSection = {
  emotionLabel: TranscriptSegment["emotionLabel"];
  id: string;
  label: string;
  left: number;
  speaker: string | null;
  speakerLabel: string;
  width: number;
};

type WpmSample = {
  endSecond: number;
  startSecond: number;
  wordCount: number;
};

type TranscriptTextToken = {
  isWordLike: boolean;
  text: string;
  wordIndex: number | null;
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
  const segmentRefs = useRef(new Map<string, HTMLLIElement>());
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const canEditSpeakers = Boolean(meetingId);
  const hasTranslations = useMemo(
    () => segments.some((segment) => Boolean(segment.translatedText?.trim())),
    [segments],
  );
  const [textVersion, setTextVersion] = useState<"zh" | "original">(
    hasTranslations ? "zh" : "original",
  );
  const canSeekTranscript = Boolean(audioUrl);
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

  async function seekToTranscriptWord(
    event: MouseEvent<HTMLButtonElement>,
    segment: TranscriptSegment,
    tokens: TranscriptTextToken[],
    segmentEndMs: number,
  ) {
    const wordIndex = getTranscriptWordIndex(event);
    const seekMs =
      wordIndex === null
        ? segment.startMs
        : getEstimatedWordStartMs(
            segment.startMs,
            segmentEndMs,
            tokens,
            wordIndex,
          );

    await seekTo(seekMs);
  }

  function scrollTranscriptToTime(timeSecond: number) {
    const targetSegment = findNearestSegmentAtTime(segments, timeSecond * 1000);
    const targetNode = targetSegment
      ? segmentRefs.current.get(targetSegment.id)
      : null;

    if (!targetNode) {
      return;
    }

    const topOffset = 96;
    const targetTop =
      targetNode.getBoundingClientRect().top + window.scrollY - topOffset;

    window.scrollTo({ behavior: "smooth", top: Math.max(0, targetTop) });
  }

  return (
    <>
      <section className={audioUrl ? "pb-48" : undefined}>
        <header className="mb-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">Transcript</h2>
            {hasTranslations ? (
              <div className="inline-flex w-fit rounded-md border bg-background p-0.5">
                <button
                  aria-pressed={textVersion === "zh"}
                  className={cn(
                    "h-7 rounded px-2 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    textVersion === "zh"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setTextVersion("zh")}
                  type="button"
                >
                  中文
                </button>
                <button
                  aria-pressed={textVersion === "original"}
                  className={cn(
                    "h-7 rounded px-2 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    textVersion === "original"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setTextVersion("original")}
                  type="button"
                >
                  Original
                </button>
              </div>
            ) : null}
          </div>
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
                  const speakerLabel = speaker.speaker ?? "Unknown speaker";
                  const content = (
                    <>
                      <span
                        aria-hidden="true"
                        className="size-2.5 rounded-full"
                        style={{
                          backgroundColor: getWaveformSpeakerColor(
                            speaker.speaker,
                          ),
                        }}
                      />
                      <span>{speakerLabel}</span>
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
                      title={speakerLabel}
                      type="button"
                    >
                      {content}
                    </button>
                  ) : (
                    <span
                      className="inline-flex h-8 items-center gap-2 rounded-md border px-2 text-sm font-medium"
                      key={getSpeakerKey(speaker.speaker)}
                      title={speakerLabel}
                    >
                      {content}
                    </span>
                  );
                })}
              </div>
            </div>
            <ol className="border-t">
              {segments.map((segment, index) => {
                const speakerLabel = segment.speaker ?? "Unknown speaker";
                const speakerKey = getSpeakerKey(segment.speaker);
                const isEditing = editingSpeaker?.segmentId === segment.id;
                const isSaving = savingSpeakerKey === speakerKey;
                const hasError = errorSpeakerKey === speakerKey;
                const isActive = activeSegmentId === segment.id;
                const translatedText = segment.translatedText?.trim();
                const shouldShowTranslation =
                  textVersion === "zh" && Boolean(translatedText);
                const displayedText = shouldShowTranslation
                  ? translatedText ?? ""
                  : segment.text;
                const textTokens = getTranscriptTextTokens(displayedText);
                const segmentEndMs = getSegmentDisplayEndMs(
                  segment,
                  segments,
                  index,
                );
                const activeWordIndex = isActive
                  ? getActiveWordIndex(
                      segment.startMs,
                      segmentEndMs,
                      textTokens,
                      currentTime * 1000,
                    )
                  : null;
                return (
                  <li
                    key={segment.id}
                    ref={(node) => {
                      if (node) {
                        segmentRefs.current.set(segment.id, node);
                        return;
                      }

                      segmentRefs.current.delete(segment.id);
                    }}
                    className={cn(
                      "grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border-b py-4 transition-colors",
                      isActive ? "bg-primary/5 px-3 sm:-mx-3" : undefined,
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1 flex size-7 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm"
                      style={{
                        backgroundColor: getWaveformSpeakerColor(
                          segment.speaker,
                        ),
                      }}
                    >
                      {getSpeakerInitial(speakerLabel)}
                    </span>
                    <div className="min-w-0">
                      <div className="mb-1.5 flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1">
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
                            aria-label={`Edit speaker ${speakerLabel}`}
                            className="group inline-flex min-h-8 items-center gap-2 rounded-lg px-0 text-left text-sm font-semibold text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                            onClick={() => startEditing(segment.speaker, segment.id)}
                            type="button"
                          >
                            <span>
                              {speakerLabel}
                            </span>
                            <Pencil className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                          </button>
                        ) : (
                          <p className="text-sm font-semibold text-foreground">
                            {speakerLabel}
                          </p>
                        )}
                        {canSeekTranscript ? (
                          <button
                            aria-label={`Play from ${formatTimestamp(segment.startMs)}`}
                            className="h-6 shrink-0 rounded-md text-left text-xs font-medium text-muted-foreground outline-none hover:text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                            onClick={() => seekTo(segment.startMs)}
                            type="button"
                          >
                            {formatTimestamp(segment.startMs)}
                          </button>
                        ) : (
                          <span className="text-xs font-medium text-muted-foreground">
                            {formatTimestamp(segment.startMs)}
                          </span>
                        )}
                        {segment.emotionLabel &&
                        segment.emotionLabel !== "neutral" ? (
                          <span className="inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium text-muted-foreground">
                            {formatEmotionLabel(segment.emotionLabel)}
                          </span>
                        ) : null}
                      </div>
                      <div className="group/original relative inline-block max-w-full">
                        {canSeekTranscript ? (
                          <button
                            aria-describedby={
                              shouldShowTranslation
                                ? `${segment.id}-original-text`
                                : undefined
                            }
                            aria-label={`Play transcript from ${formatTimestamp(segment.startMs)}`}
                            className="block max-w-full rounded-md text-left text-[0.95rem] leading-7 text-foreground outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
                            onClick={(event) =>
                              seekToTranscriptWord(
                                event,
                                segment,
                                textTokens,
                                segmentEndMs,
                              )
                            }
                            type="button"
                          >
                            <TranscriptText
                              activeWordIndex={activeWordIndex}
                              isInteractive
                              tokens={textTokens}
                            />
                          </button>
                        ) : (
                          <p
                            aria-describedby={
                              shouldShowTranslation
                                ? `${segment.id}-original-text`
                                : undefined
                            }
                            className="text-[0.95rem] leading-7 text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                            tabIndex={shouldShowTranslation ? 0 : undefined}
                          >
                            <TranscriptText
                              activeWordIndex={null}
                              isInteractive={false}
                              tokens={textTokens}
                            />
                          </p>
                        )}
                        {shouldShowTranslation ? (
                          <div
                            className="pointer-events-none absolute left-0 top-full z-30 mt-2 w-[min(32rem,calc(100vw-3rem))] translate-y-1 rounded-md border bg-background p-3 text-sm text-foreground opacity-0 shadow-lg ring-1 ring-border transition group-hover/original:translate-y-0 group-hover/original:opacity-100 group-focus-within/original:translate-y-0 group-focus-within/original:opacity-100"
                            id={`${segment.id}-original-text`}
                            role="tooltip"
                          >
                            <p className="leading-6">{segment.text}</p>
                          </div>
                        ) : null}
                      </div>
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
          onTimelineSeek={scrollTranscriptToTime}
          setCurrentTime={setCurrentTime}
          setDuration={setDuration}
          setIsPlaying={setIsPlaying}
          setPlaybackRate={setPlaybackRate}
        />
      ) : null}
    </>
  );
}

function TranscriptText({
  activeWordIndex,
  isInteractive,
  tokens,
}: {
  activeWordIndex: number | null;
  isInteractive: boolean;
  tokens: TranscriptTextToken[];
}) {
  return (
    <>
      {tokens.map((token, index) =>
        token.isWordLike ? (
          <span
            className={cn(
              "rounded-[3px] px-0.5 transition-colors",
              token.wordIndex === activeWordIndex
                ? "bg-primary text-primary-foreground"
                : isInteractive
                ? "hover:bg-primary/15"
                : undefined,
            )}
            data-transcript-word-index={token.wordIndex}
            key={`${index}:${token.text}`}
          >
            {token.text}
          </span>
        ) : (
          <span key={`${index}:${token.text}`}>{token.text}</span>
        ),
      )}
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
  onTimelineSeek,
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
  onTimelineSeek: (timeSecond: number) => void;
  setCurrentTime: (value: number) => void;
  setDuration: (value: number) => void;
  setIsPlaying: (value: boolean) => void;
  setPlaybackRate: (value: number) => void;
}) {
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [waveformStatus, setWaveformStatus] = useState<
    "idle" | "loading" | "ready" | "fallback"
  >("idle");
  const [hoveredWpmSnapshot, setHoveredWpmSnapshot] = useState<{
    leftPercent: number;
    timeSecond: number;
    wpmLabel: string;
  } | null>(null);
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
  const wpmSamples = useMemo(
    () => buildWaveformWpmSamples(segments, timelineDuration),
    [segments, timelineDuration],
  );
  const wpmLinePoints = useMemo(
    () =>
      buildWaveformWpmLinePoints(
        wpmSamples,
        timelineDuration,
        waveformBarCount,
      ),
    [timelineDuration, waveformBarCount, wpmSamples],
  );
  const activeWaveformWpm = useMemo(
    () => calculateSmoothedWpmAtSecond(wpmSamples, currentTime, timelineDuration),
    [currentTime, timelineDuration, wpmSamples],
  );
  const activeWaveformSection =
    sectionMarkers.find((section) => section.id === activeSegmentId) ?? null;
  const activeWpmLabel =
    activeWaveformWpm > 0 ? formatWpmLabel(activeWaveformWpm) : null;
  const wpmTooltipLabel = hoveredWpmSnapshot?.wpmLabel ?? activeWpmLabel;
  const activeWaveformLabel = activeWaveformSection
    ? activeWpmLabel
      ? `${activeWaveformSection.label}, ${activeWpmLabel}`
      : activeWaveformSection.label
    : null;
  const wpmTooltipPositionStyle = {
    left: hoveredWpmSnapshot
      ? `${hoveredWpmSnapshot.leftPercent}%`
      : "0.25rem",
    opacity: hoveredWpmSnapshot ? 1 : undefined,
    transform: hoveredWpmSnapshot
      ? getWaveformHoverTooltipTransform(hoveredWpmSnapshot.leftPercent)
      : undefined,
  };
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
    onTimelineSeek(nextTime);
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
    onTimelineSeek(nextTime);
  }

  function updateWpmHover(event: PointerEvent<HTMLSpanElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();

    setHoveredWpmSnapshot(
      getWaveformHoverSnapshot({
        boundsLeft: bounds.left,
        boundsWidth: bounds.width,
        clientX: event.clientX,
        samples: wpmSamples,
        timelineDuration,
      }),
    );
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
          aria-label={
            activeWaveformLabel
              ? `Audio waveform, ${activeWaveformLabel}`
              : "Audio waveform"
          }
          className="relative h-24 w-full overflow-hidden rounded-lg border bg-background px-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-1"
          onPointerDown={seekFromWaveform}
          type="button"
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-2 top-0 z-40 h-6 sm:inset-x-1"
          >
            <span className="pointer-events-none absolute inset-x-0 top-1 h-1 rounded-full bg-muted" />
            {sectionMarkers.map((section) => {
              const tooltipAlignClass = getWaveformTooltipAlignClass(
                section.left,
                section.width,
              );

              return (
                <span
                  className="group/rail absolute inset-y-0"
                  key={`${section.id}-speaker`}
                  style={{
                    left: `${section.left}%`,
                    width: `${section.width}%`,
                  }}
                  title={section.speakerLabel}
                >
                  <span
                    className="absolute inset-x-0 top-1 h-1 rounded-full"
                    style={{
                      backgroundColor: getWaveformSpeakerColor(section.speaker),
                      opacity: section.id === activeSegmentId ? 0.96 : 0.78,
                    }}
                  />
                  <span
                    className={cn(
                      "pointer-events-none absolute top-6 z-50 whitespace-nowrap rounded-sm border bg-background px-1.5 py-1 text-[0.65rem] font-medium leading-none text-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity group-hover/rail:opacity-100",
                      tooltipAlignClass,
                    )}
                  >
                    Speaker: {section.speakerLabel}
                  </span>
                </span>
              );
            })}
          </span>
          <span
            aria-hidden="true"
            className="absolute inset-x-2 bottom-4 top-8 z-0 flex items-center gap-[2px] opacity-70 sm:inset-x-1 sm:gap-px"
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
          {wpmLinePoints ? (
            <span
              aria-hidden="true"
              className="group/wpm absolute inset-x-2 bottom-5 top-4 z-10 sm:inset-x-1"
              onPointerLeave={() => setHoveredWpmSnapshot(null)}
              onPointerMove={updateWpmHover}
            >
              <svg
                className="h-full w-full"
                preserveAspectRatio="none"
                viewBox="0 0 100 100"
              >
                {[24, 50, 76].map((gridY) => (
                  <line
                    key={gridY}
                    stroke="var(--border)"
                    strokeDasharray="2 3"
                    strokeWidth="0.8"
                    vectorEffect="non-scaling-stroke"
                    x1="0"
                    x2="100"
                    y1={gridY}
                    y2={gridY}
                  />
                ))}
                <polyline
                  fill="none"
                  points={wpmLinePoints}
                  pointerEvents="stroke"
                  stroke="transparent"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="16"
                  vectorEffect="non-scaling-stroke"
                />
                <polyline
                  fill="none"
                  points={wpmLinePoints}
                  stroke="var(--background)"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="6"
                  vectorEffect="non-scaling-stroke"
                />
                <polyline
                  fill="none"
                  points={wpmLinePoints}
                  stroke="#f97316"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <span
                className="pointer-events-none absolute top-1 z-50 whitespace-nowrap rounded-sm border bg-background px-1.5 py-1 text-[0.65rem] font-medium leading-none text-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity group-hover/wpm:opacity-100"
                style={wpmTooltipPositionStyle}
              >
                WPM trend{wpmTooltipLabel ? `: ${wpmTooltipLabel}` : null}
              </span>
            </span>
          ) : null}
          {wpmLinePoints ? (
            <span className="sr-only">Words per minute trend</span>
          ) : null}
          <span
            aria-hidden="true"
            className="absolute inset-x-2 bottom-0 z-40 h-6 sm:inset-x-1"
          >
            <span className="pointer-events-none absolute inset-x-0 bottom-1 h-1 rounded-full bg-muted" />
            {sectionMarkers.map((section) => {
              const tooltipAlignClass = getWaveformTooltipAlignClass(
                section.left,
                section.width,
              );

              return (
                <span
                  className="group/rail absolute inset-y-0"
                  key={`${section.id}-rail`}
                  style={{
                    left: `${section.left}%`,
                    width: `${section.width}%`,
                  }}
                  title={formatEmotionTooltip(section.emotionLabel)}
                >
                  <span
                    className="absolute inset-x-0 bottom-1 h-1 rounded-full"
                    style={{
                      backgroundColor: getWaveformEmotionColor(section.emotionLabel),
                      opacity: getWaveformEmotionOpacity(
                        section.emotionLabel,
                        section.id === activeSegmentId,
                      ),
                    }}
                  />
                  <span
                    className={cn(
                      "pointer-events-none absolute bottom-6 z-50 whitespace-nowrap rounded-sm border bg-background px-1.5 py-1 text-[0.65rem] font-medium leading-none text-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity group-hover/rail:opacity-100",
                      tooltipAlignClass,
                    )}
                  >
                    Emotion: {formatEmotionName(section.emotionLabel)}
                  </span>
                </span>
              );
            })}
          </span>
          <span
            aria-hidden="true"
            className="absolute bottom-1 top-1 z-30 w-0.5 rounded-full bg-primary shadow-[0_0_0_1px_var(--background)]"
            style={{ left: `${progressPercent}%` }}
          />
          {activeWaveformSection ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-2 top-3 z-30 flex max-w-[calc(100%-1rem)] flex-wrap justify-end gap-1.5 text-[0.65rem] leading-none sm:right-1"
            >
              <span className="rounded-sm border bg-background/95 px-1.5 py-1 font-medium text-foreground shadow-sm ring-1 ring-border">
                Speaker: {activeWaveformSection.speakerLabel}
              </span>
              <span className="rounded-sm border bg-background/95 px-1.5 py-1 font-medium text-foreground shadow-sm ring-1 ring-border">
                Emotion: {formatEmotionName(activeWaveformSection.emotionLabel)}
              </span>
              {activeWpmLabel ? (
                <span className="rounded-sm border bg-background/95 px-1.5 py-1 font-medium text-foreground shadow-sm ring-1 ring-border">
                  WPM: {activeWpmLabel}
                </span>
              ) : null}
            </span>
          ) : null}
          <span aria-live="polite" className="sr-only">
            {activeWaveformLabel
              ? `Current section: ${activeWaveformLabel}`
              : waveformStatus === "ready"
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
        <div className="grid min-w-0 grid-cols-2 items-center gap-x-3 gap-y-2 sm:grid-cols-[5rem_1fr_5rem]">
          <p className="order-2 text-xs font-medium tabular-nums text-muted-foreground sm:order-none">
            {formatPlayerTime(currentTime)}
          </p>
          <div className="order-1 col-span-2 flex min-w-0 items-center justify-center gap-2 sm:order-none sm:col-span-1">
            <Button
              className="min-w-12 gap-1 rounded-full px-2"
              aria-label="Skip back 5 seconds"
              onClick={() => skipBy(-5)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <RotateCcw className="size-3.5" />
              <span className="text-xs font-semibold tabular-nums">5s</span>
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
              className="min-w-12 gap-1 rounded-full px-2"
              aria-label="Skip forward 5 seconds"
              onClick={() => skipBy(5)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <span className="text-xs font-semibold tabular-nums">5s</span>
              <RotateCw className="size-3.5" />
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
          <p className="order-3 text-right text-xs font-medium tabular-nums text-muted-foreground sm:order-none">
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
): WaveformSection[] {
  if (!timelineDuration) {
    return [];
  }

  return segments
    .map((segment, index) => {
      const endMs = getWaveformSegmentEndMs(
        segment,
        index,
        segments,
        timelineDuration,
      );
      const left = clamp((segment.startMs / 1000 / timelineDuration) * 100, 0, 100);
      const width = clamp(
        ((endMs - segment.startMs) / 1000 / timelineDuration) * 100,
        0.4,
        100 - left,
      );
      const speakerLabel = segment.speaker ?? "Unknown speaker";

      return {
        emotionLabel: segment.emotionLabel,
        id: segment.id,
        label: formatWaveformSectionLabel(
          segment.speaker,
          segment.emotionLabel,
        ),
        left,
        speaker: segment.speaker,
        speakerLabel,
        width,
      };
    })
    .filter((section) => section.width > 0);
}

function buildWaveformWpmSamples(
  segments: TranscriptSegment[],
  timelineDuration: number,
): WpmSample[] {
  if (!timelineDuration) {
    return [];
  }

  return segments
    .map((segment, index) => {
      const endMs = getWaveformSegmentEndMs(
        segment,
        index,
        segments,
        timelineDuration,
      );
      const startSecond = segment.startMs / 1000;
      const endSecond = Math.max(startSecond, endMs / 1000);

      return {
        endSecond,
        startSecond,
        wordCount: countTranscriptWords(segment.text),
      };
    })
    .filter(
      (sample) =>
        sample.wordCount > 0 && sample.endSecond > sample.startSecond,
    );
}

function buildWaveformWpmLinePoints(
  samples: WpmSample[],
  timelineDuration: number,
  pointCount: number,
) {
  if (samples.length === 0 || !timelineDuration || pointCount < 2) {
    return "";
  }

  let hasPace = false;
  const points = Array.from({ length: pointCount }, (_, index) => {
    const x = (index / (pointCount - 1)) * 100;
    const currentSecond = (x / 100) * timelineDuration;
    const wpm = calculateSmoothedWpmAtSecond(
      samples,
      currentSecond,
      timelineDuration,
    );
    const normalizedWpm = clamp(wpm / WPM_GRAPH_MAX, 0, 1);
    const y = 92 - normalizedWpm * 76;

    if (wpm > 0) {
      hasPace = true;
    }

    return `${formatChartCoordinate(x)},${formatChartCoordinate(y)}`;
  }).join(" ");

  return hasPace ? points : "";
}

function getWaveformSegmentEndMs(
  segment: TranscriptSegment,
  index: number,
  segments: TranscriptSegment[],
  timelineDuration: number,
) {
  const nextSegment = segments[index + 1];

  return segment.endMs ?? nextSegment?.startMs ?? timelineDuration * 1000;
}

function calculateSmoothedWpmAtSecond(
  samples: WpmSample[],
  currentSecond: number,
  timelineDuration: number,
) {
  if (samples.length === 0 || !timelineDuration) {
    return 0;
  }

  const windowSeconds = getWpmSmoothingWindowSeconds(timelineDuration);
  const windowStart = clamp(currentSecond - windowSeconds / 2, 0, timelineDuration);
  const windowEnd = clamp(currentSecond + windowSeconds / 2, 0, timelineDuration);
  let spokenSeconds = 0;
  let wordCount = 0;

  for (const sample of samples) {
    const overlapStart = Math.max(sample.startSecond, windowStart);
    const overlapEnd = Math.min(sample.endSecond, windowEnd);
    const overlapSeconds = Math.max(0, overlapEnd - overlapStart);

    if (!overlapSeconds) {
      continue;
    }

    const sampleSeconds = sample.endSecond - sample.startSecond;

    spokenSeconds += overlapSeconds;
    wordCount += sample.wordCount * (overlapSeconds / sampleSeconds);
  }

  if (spokenSeconds < WPM_GRAPH_MIN_SAMPLE_SECONDS) {
    return 0;
  }

  return Math.round(wordCount / (spokenSeconds / 60));
}

export function getWaveformHoverSnapshot({
  boundsLeft,
  boundsWidth,
  clientX,
  samples,
  timelineDuration,
}: {
  boundsLeft: number;
  boundsWidth: number;
  clientX: number;
  samples: WpmSample[];
  timelineDuration: number;
}) {
  if (!boundsWidth || !timelineDuration) {
    return null;
  }

  const leftPercent = clamp(((clientX - boundsLeft) / boundsWidth) * 100, 0, 100);
  const timeSecond = (leftPercent / 100) * timelineDuration;
  const wpm = calculateSmoothedWpmAtSecond(
    samples,
    timeSecond,
    timelineDuration,
  );

  if (!wpm) {
    return null;
  }

  return {
    leftPercent,
    timeSecond,
    wpmLabel: formatWpmLabel(wpm),
  };
}

function getWpmSmoothingWindowSeconds(timelineDuration: number) {
  return Math.min(
    WPM_GRAPH_MAX_WINDOW_SECONDS,
    Math.max(WPM_GRAPH_WINDOW_SECONDS, timelineDuration / 20),
  );
}

function countTranscriptWords(text: string) {
  const trimmedText = text.trim();

  if (!trimmedText) {
    return 0;
  }

  if (transcriptWordSegmenter) {
    let wordCount = 0;

    for (const segment of transcriptWordSegmenter.segment(trimmedText)) {
      if (segment.isWordLike) {
        wordCount += 1;
      }
    }

    if (wordCount > 0) {
      return wordCount;
    }
  }

  const latinWordCount =
    trimmedText
      .replace(TRANSCRIPT_CJK_CHARACTER_PATTERN, " ")
      .match(TRANSCRIPT_FALLBACK_WORD_PATTERN)?.length ?? 0;
  const cjkCharacterCount =
    trimmedText.match(TRANSCRIPT_CJK_CHARACTER_PATTERN)?.length ?? 0;

  return latinWordCount + cjkCharacterCount;
}

function createTranscriptWordSegmenter() {
  if (typeof Intl.Segmenter !== "function") {
    return null;
  }

  return new Intl.Segmenter(undefined, { granularity: "word" });
}

function getTranscriptTextTokens(text: string): TranscriptTextToken[] {
  if (!text) {
    return [];
  }

  if (transcriptWordSegmenter) {
    const tokens: TranscriptTextToken[] = [];
    let wordIndex = 0;

    for (const segment of transcriptWordSegmenter.segment(text)) {
      const isWordLike = Boolean(segment.isWordLike);
      tokens.push({
        isWordLike,
        text: segment.segment,
        wordIndex: isWordLike ? wordIndex : null,
      });

      if (isWordLike) {
        wordIndex += 1;
      }
    }

    if (tokens.length > 0) {
      return tokens;
    }
  }

  let wordIndex = 0;

  return (text.match(/\s+|[^\s]+/g) ?? [text]).map((part) => {
    const isWordLike = /[A-Za-z0-9\u3400-\u9fff\uf900-\ufaff]/.test(part);
    const token: TranscriptTextToken = {
      isWordLike,
      text: part,
      wordIndex: isWordLike ? wordIndex : null,
    };

    if (isWordLike) {
      wordIndex += 1;
    }

    return token;
  });
}

function getTranscriptWordCount(tokens: TranscriptTextToken[]) {
  return tokens.reduce(
    (count, token) => (token.isWordLike ? count + 1 : count),
    0,
  );
}

function getActiveWordIndex(
  startMs: number,
  endMs: number,
  tokens: TranscriptTextToken[],
  currentMs: number,
) {
  const wordCount = getTranscriptWordCount(tokens);

  if (wordCount === 0) {
    return null;
  }

  if (endMs <= startMs) {
    return 0;
  }

  const progress = clamp((currentMs - startMs) / (endMs - startMs), 0, 0.999);

  return Math.min(wordCount - 1, Math.floor(progress * wordCount));
}

function getEstimatedWordStartMs(
  startMs: number,
  endMs: number,
  tokens: TranscriptTextToken[],
  wordIndex: number,
) {
  const wordCount = getTranscriptWordCount(tokens);

  if (wordCount <= 1 || endMs <= startMs) {
    return startMs;
  }

  const boundedWordIndex = clamp(wordIndex, 0, wordCount - 1);
  const progress = boundedWordIndex / wordCount;

  return Math.floor(startMs + (endMs - startMs) * progress);
}

function getTranscriptWordIndex(event: MouseEvent<HTMLButtonElement>) {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const wordNode = target.closest<HTMLElement>("[data-transcript-word-index]");

  if (!wordNode || !event.currentTarget.contains(wordNode)) {
    return null;
  }

  const wordIndex = Number(wordNode.dataset.transcriptWordIndex);

  return Number.isInteger(wordIndex) ? wordIndex : null;
}

function getSegmentDisplayEndMs(
  segment: TranscriptSegment,
  segments: TranscriptSegment[],
  index: number,
) {
  const nextSegment = segments[index + 1];

  return segment.endMs ?? nextSegment?.startMs ?? segment.startMs;
}

function getWaveformSpeakerColor(speaker: string | null) {
  const speakerKey = getSpeakerKey(speaker);
  let hash = 0;

  for (let index = 0; index < speakerKey.length; index += 1) {
    hash = (hash * 31 + speakerKey.charCodeAt(index)) >>> 0;
  }

  return WAVEFORM_SECTION_COLORS[hash % WAVEFORM_SECTION_COLORS.length];
}

function getWaveformEmotionColor(
  emotionLabel?: TranscriptSegment["emotionLabel"],
) {
  if (emotionLabel === "hard") {
    return "#dc2626";
  }

  if (emotionLabel === "chill") {
    return "#059669";
  }

  return "transparent";
}

function getWaveformEmotionOpacity(
  emotionLabel: TranscriptSegment["emotionLabel"],
  isActive: boolean,
) {
  if (emotionLabel !== "hard" && emotionLabel !== "chill") {
    return 0;
  }

  return isActive ? 0.95 : 0.6;
}

function formatEmotionLabel(label: NonNullable<TranscriptSegment["emotionLabel"]>) {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatWaveformSectionLabel(
  speaker: string | null,
  emotionLabel?: TranscriptSegment["emotionLabel"],
) {
  const speakerLabel = speaker ?? "Unknown speaker";

  if (emotionLabel && emotionLabel !== "neutral") {
    return `${speakerLabel} · ${formatEmotionLabel(emotionLabel)}`;
  }

  return speakerLabel;
}

function formatEmotionTooltip(emotionLabel?: TranscriptSegment["emotionLabel"]) {
  if (!emotionLabel || emotionLabel === "neutral") {
    return "No emotion signal";
  }

  return `${formatEmotionName(emotionLabel)} emotion`;
}

function formatEmotionName(emotionLabel?: TranscriptSegment["emotionLabel"]) {
  if (emotionLabel && emotionLabel !== "neutral") {
    return formatEmotionLabel(emotionLabel);
  }

  return "None";
}

function getWaveformTooltipAlignClass(left: number, width: number) {
  const midpoint = left + width / 2;

  if (midpoint < 12) {
    return "left-0";
  }

  if (midpoint > 88) {
    return "right-0";
  }

  return "left-1/2 -translate-x-1/2";
}

function getWaveformHoverTooltipTransform(leftPercent: number) {
  if (leftPercent < 12) {
    return "translateX(0)";
  }

  if (leftPercent > 88) {
    return "translateX(-100%)";
  }

  return "translateX(-50%)";
}

function formatWpmLabel(wpm: number) {
  return `${wpm} wpm`;
}

function formatChartCoordinate(value: number) {
  return Number(value.toFixed(2)).toString();
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

function findNearestSegmentAtTime(
  segments: TranscriptSegment[],
  currentMs: number,
) {
  const directSegment = findSegmentAtTime(segments, currentMs);

  if (directSegment) {
    return directSegment;
  }

  return segments.reduce<TranscriptSegment | null>((closest, segment) => {
    const endMs = segment.endMs ?? segment.startMs;
    const distance =
      currentMs < segment.startMs
        ? segment.startMs - currentMs
        : Math.max(0, currentMs - endMs);

    if (!closest) {
      return segment;
    }

    const closestEndMs = closest.endMs ?? closest.startMs;
    const closestDistance =
      currentMs < closest.startMs
        ? closest.startMs - currentMs
        : Math.max(0, currentMs - closestEndMs);

    return distance < closestDistance ? segment : closest;
  }, null);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getSpeakerKey(speaker: string | null) {
  return speaker ?? "__unknown__";
}

function getSpeakerInitial(speaker: string) {
  return speaker.trim().charAt(0).toUpperCase() || "?";
}
