"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowUpRight, CircleAlert, Loader2 } from "lucide-react";

import { MeetingAutoRefresh } from "@/components/meeting-auto-refresh";
import { formatMeetingHeaderDateTime } from "@/components/meeting-header-metadata";
import { TranscriptViewer } from "@/components/transcript-viewer";
import { getMeetingDisplayStatus } from "@/lib/meeting-display-status";
import type { MeetingTranscript } from "@/lib/meeting-queries";
import { moveRecordingTimestampToAppendedTimeline } from "@/lib/meeting-recording-timeline";
import { getTranscriptViewerRenderKey } from "@/lib/meeting-transcript-render-key";
import type { TranslationLanguage } from "@/lib/meeting-translation-language";

export function MeetingComposedTranscripts({
  meetings,
  primaryMeetingId,
  preferredTranslationLanguage,
}: {
  meetings: MeetingTranscript[];
  primaryMeetingId: string;
  preferredTranslationLanguage?: TranslationLanguage;
}) {
  return (
    <div className="space-y-10">
      {meetings.map((meeting, index) => {
        const status = getMeetingDisplayStatus({
          meetingStatus: meeting.status,
          transcriptJobStatus: meeting.transcriptJobStatus,
        });
        const parts = meeting.recordingParts ?? [];
        const visualAssets =
          parts.length > 1
            ? meeting.visualAssets.map((asset) => ({
                ...asset,
                timestampMs:
                  asset.timestampMs === null
                    ? null
                    : moveRecordingTimestampToAppendedTimeline(
                        parts,
                        asset.timestampMs,
                      ),
              }))
            : meeting.visualAssets;
        const waiting = [
          "scheduled",
          "joining",
          "recording",
          "processing",
          "queued",
          "transcribing",
        ].includes(status);
        return (
          <section
            className="min-w-0"
            aria-labelledby={`recording-part-${meeting.id}`}
            key={meeting.id}
          >
            <MeetingAutoRefresh
              meetingStatus={meeting.status}
              segmentCount={meeting.segments.length}
              transcriptJobStatus={meeting.transcriptJobStatus}
              translationStatus={meeting.translationSummary.status}
            />
            <RecordingPartHeader
              meeting={meeting}
              partNumber={index + 1}
              isPrimary={meeting.id === primaryMeetingId}
            />
            {meeting.segments.length ? (
              <TranscriptViewer
                key={getTranscriptViewerRenderKey({
                  displayStatus: status,
                  meetingId: meeting.id,
                  polishedSegments: meeting.segments.filter((segment) =>
                    Boolean(segment.polishedText?.trim()),
                  ).length,
                  segmentCount: meeting.segments.length,
                  translatedSegments:
                    meeting.translationSummary.translatedSegments,
                  translationStatus: meeting.translationSummary.status,
                })}
                meetingId={meeting.canManage ? meeting.id : null}
                audioParts={parts.length > 1 ? parts : undefined}
                audioUrl={meeting.audioUrl}
                segments={meeting.segments}
                speakerAliases={meeting.speakerAliases}
                speakerSuggestions={meeting.speakerSuggestions}
                preferredTranslationLanguage={
                  preferredTranslationLanguage ?? meeting.translationLanguage
                }
                translationLanguage={meeting.translationLanguage}
                translationSummary={meeting.translationSummary}
                visualAssets={visualAssets}
              />
            ) : (
              <div className="rounded-lg bg-muted/25 px-4 py-5">
                <div className="flex items-start gap-3">
                  {waiting ? (
                    <Loader2
                      className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <CircleAlert
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium" role="status">
                      {emptyPartTitle(status)}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {waiting
                        ? "The transcript will appear here when it is ready."
                        : "The other recordings in this meeting are still available."}
                    </p>
                    {!waiting && meeting.id !== primaryMeetingId ? (
                      <Link
                        className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
                        href={`/meetings/${encodeURIComponent(meeting.id)}`}
                      >
                        View original meeting
                        <ArrowUpRight className="size-3.5" aria-hidden="true" />
                      </Link>
                    ) : null}
                  </div>
                </div>
                {meeting.audioUrl ? (
                  <audio
                    className="mt-4 w-full"
                    controls
                    preload="metadata"
                    src={meeting.audioUrl}
                    aria-label={`Recording for part ${index + 1}`}
                  />
                ) : null}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function RecordingPartHeader({
  meeting,
  partNumber,
  isPrimary,
}: {
  meeting: MeetingTranscript;
  partNumber: number;
  isPrimary: boolean;
}) {
  const status = getMeetingDisplayStatus({
    meetingStatus: meeting.status,
    transcriptJobStatus: meeting.transcriptJobStatus,
  });
  const dateLabel = useSyncExternalStore(
    subscribe,
    () =>
      meeting.startedAt ? formatMeetingHeaderDateTime(meeting.startedAt) : "",
    () => "",
  );
  return (
    <div className="mb-4 flex min-w-0 items-start gap-3 border-t pt-5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">
          Part {partNumber}
          {dateLabel ? ` · ${dateLabel}` : ""}
          {meeting.segments.length
            ? ` · ${status === "ready" ? "Ready" : emptyPartTitle(status)}`
            : ""}
        </p>
        <h3
          id={`recording-part-${meeting.id}`}
          className="mt-1 break-words text-sm font-semibold leading-6"
        >
          {meeting.title}
        </h3>
      </div>
      {!isPrimary ? (
        <Link
          href={`/meetings/${encodeURIComponent(meeting.id)}`}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          aria-label={`View original meeting: ${meeting.title}`}
        >
          Original
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

function subscribe() {
  return () => {};
}

function emptyPartTitle(status: string) {
  if (status === "recording") return "Recording in progress";
  if (status === "joining") return "Bot joining";
  if (["processing", "queued", "transcribing"].includes(status))
    return "Preparing transcript";
  if (status === "scheduled") return "Waiting for recording";
  if (status === "failed") return "This recording needs attention";
  if (status === "cancelled") return "Recording cancelled";
  if (status === "missed") return "No recording captured";
  return "No transcript available";
}
