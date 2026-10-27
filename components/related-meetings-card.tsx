"use client";

import Link from "next/link";
import { ChevronDown, FileText, History } from "lucide-react";
import { useId, useState } from "react";

import { LocalDateTime } from "@/components/local-date-time";
import type { MeetingDetailRelatedMeeting } from "@/lib/meeting-queries";
import { cn } from "@/lib/utils";

type RelatedMeetingsCardProps = {
  meetings: MeetingDetailRelatedMeeting[];
};

export function RelatedMeetingsCard({ meetings }: RelatedMeetingsCardProps) {
  if (meetings.length === 0) {
    return null;
  }

  return (
    <details className="group relative inline-block overflow-visible">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-full border px-3 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:min-h-7 [&::-webkit-details-marker]:hidden">
        <History aria-hidden="true" className="size-3.5" />
        <span id="related-meetings-title">Related meetings</span>
        <span className="tabular-nums text-foreground">{meetings.length}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 transition-transform group-open:rotate-180"
        />
      </summary>
      <section
        aria-labelledby="related-meetings-title"
        className="absolute left-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg"
      >
        <ul className="flex max-h-80 flex-col overflow-y-auto">
          {meetings.map((meeting) => (
            <RelatedMeetingItem key={meeting.id} meeting={meeting} />
          ))}
        </ul>
      </section>
    </details>
  );
}

function RelatedMeetingItem({
  meeting,
}: {
  meeting: MeetingDetailRelatedMeeting;
}) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const previewId = useId();
  const previewLabelId = `${previewId}-label`;

  return (
    <li
      className="relative"
      onBlur={() => setIsPreviewOpen(false)}
      onFocus={() => setIsPreviewOpen(true)}
      onMouseEnter={() => setIsPreviewOpen(true)}
      onMouseLeave={() => setIsPreviewOpen(false)}
    >
      <div className="rounded-md px-2.5 py-2 transition-colors hover:bg-muted/60">
        <Link
          aria-controls={previewId}
          aria-describedby={previewLabelId}
          aria-expanded={isPreviewOpen}
          className="block break-words text-sm text-foreground after:absolute after:inset-0"
          href={`/meetings/${meeting.id}`}
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

      <div
        aria-labelledby={previewLabelId}
        className={cn(
          "absolute right-0 top-full z-50 mt-2 w-[min(30rem,calc(100vw-2rem))] rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg lg:right-auto lg:left-full lg:top-0 lg:ml-3 lg:mt-0",
          isPreviewOpen ? "block" : "hidden",
        )}
        id={previewId}
        role="tooltip"
      >
        <div
          className="mb-3 flex items-center gap-2 text-sm font-semibold"
          id={previewLabelId}
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
    </li>
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
