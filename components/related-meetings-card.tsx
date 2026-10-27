"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { useId, useState } from "react";

import { LocalDateTime } from "@/components/local-date-time";
import type { MeetingDetailRelatedMeeting } from "@/lib/meeting-queries";
import { cn } from "@/lib/utils";

type RelatedMeetingsCardProps = {
  meetings: MeetingDetailRelatedMeeting[];
};

export function RelatedMeetingsCard({ meetings }: RelatedMeetingsCardProps) {
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const baseId = useId();

  if (meetings.length === 0) {
    return null;
  }

  return (
    <details className="group relative inline-block overflow-visible">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-sm text-sm text-muted-foreground underline decoration-border underline-offset-4 outline-none transition-colors hover:text-foreground hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 [&::-webkit-details-marker]:hidden">
        <span className="tabular-nums">{meetings.length}</span>
        <span id="related-meetings-title">Related meetings</span>
      </summary>
      <section
        aria-labelledby="related-meetings-title"
        className="absolute left-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg"
        onMouseLeave={() => setActiveMeetingId(null)}
      >
        {/* The list scrolls on its own; previews live outside it so the
            scroll box never clips them or scrolls sideways to reach them. */}
        <ul className="flex max-h-80 flex-col overflow-x-hidden overflow-y-auto overscroll-contain">
          {meetings.map((meeting) => (
            <RelatedMeetingItem
              isActive={activeMeetingId === meeting.id}
              key={meeting.id}
              meeting={meeting}
              onActivate={() => setActiveMeetingId(meeting.id)}
              onDeactivate={() =>
                setActiveMeetingId((current) =>
                  current === meeting.id ? null : current,
                )
              }
              previewId={`${baseId}-${meeting.id}`}
            />
          ))}
        </ul>
        {meetings.map((meeting) => (
          <RelatedMeetingPreview
            isOpen={activeMeetingId === meeting.id}
            key={meeting.id}
            meeting={meeting}
            previewId={`${baseId}-${meeting.id}`}
          />
        ))}
      </section>
    </details>
  );
}

function RelatedMeetingItem({
  isActive,
  meeting,
  onActivate,
  onDeactivate,
  previewId,
}: {
  isActive: boolean;
  meeting: MeetingDetailRelatedMeeting;
  onActivate: () => void;
  onDeactivate: () => void;
  previewId: string;
}) {
  return (
    <li
      className="relative min-w-0"
      onBlur={onDeactivate}
      onFocus={onActivate}
      onMouseEnter={onActivate}
    >
      <div
        className={cn(
          "rounded-md px-2.5 py-2 transition-colors hover:bg-muted/60",
          isActive && "bg-muted/60",
        )}
      >
        <Link
          aria-controls={previewId}
          aria-describedby={`${previewId}-label`}
          aria-expanded={isActive}
          className="block truncate text-sm text-foreground after:absolute after:inset-0"
          href={`/meetings/${meeting.id}`}
          title={meeting.title}
        >
          {meeting.title}
        </Link>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {isUpcoming(meeting.startedAt) ? (
            <span className="text-foreground">Upcoming · </span>
          ) : (
            <span className="sr-only">Started </span>
          )}
          <LocalDateTime value={meeting.startedAt} />
        </p>
      </div>
    </li>
  );
}

function RelatedMeetingPreview({
  isOpen,
  meeting,
  previewId,
}: {
  isOpen: boolean;
  meeting: MeetingDetailRelatedMeeting;
  previewId: string;
}) {
  return (
    <div
      aria-labelledby={`${previewId}-label`}
      className={cn(
        "absolute left-0 top-full z-50 mt-2 w-[min(30rem,calc(100vw-2rem))] rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg overflow-visible lg:left-full lg:top-0 lg:ml-2 lg:mt-0 lg:w-80",
        isOpen ? "block" : "hidden",
      )}
      id={previewId}
      role="tooltip"
    >
      <div
        className="mb-3 flex items-center gap-2 text-sm font-semibold"
        id={`${previewId}-label`}
      >
        <FileText aria-hidden="true" className="size-4" />
        Transcript preview
      </div>
      {meeting.transcriptPreview.length > 0 ? (
        <>
          <ol className="max-h-80 space-y-3 overflow-y-auto pr-2 lg:max-h-48">
            {meeting.transcriptPreview.map((segment) => (
              <li className="text-sm leading-6" key={segment.id}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {segment.speaker?.trim() || "Unknown speaker"}
                  </span>
                  <span className="tabular-nums">
                    {formatTimestamp(segment.startMs)}
                  </span>
                </div>
                <p>{segment.text}</p>
              </li>
            ))}
          </ol>
          {meeting.hasMoreTranscriptSegments ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Open the meeting for the full transcript.
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          Transcript is not ready yet.
        </p>
      )}
    </div>
  );
}

function formatTimestamp(startMs: number) {
  const totalSeconds = Math.floor(startMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function isUpcoming(startedAt: string) {
  return new Date(startedAt).getTime() > Date.now();
}
