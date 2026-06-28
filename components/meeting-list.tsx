"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getMeetingDisplayStatus,
  type MeetingDisplayStatus,
  type MeetingRecordStatus,
  type TranscriptJobStatus,
} from "@/lib/meeting-display-status";
import { LocalDateTime } from "@/components/local-date-time";
import type { MeetingLibrarySort } from "@/lib/meeting-library-view-options";

type MeetingListBaseItem = {
  id: string;
  title: string;
  platform: "google_meet" | "in_person" | "zoom" | "upload";
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number | null;
  participantCount?: number;
  status: MeetingRecordStatus;
  transcriptJobStatus?: TranscriptJobStatus | null;
  hasRecallBot?: boolean;
  accessScope?: "workspace" | "shared";
  primaryEntity?: string | null;
};

export type MeetingListItem = MeetingListBaseItem & {
  relatedMeetings?: MeetingListRelatedItem[];
};

export type MeetingListRelatedItem = MeetingListBaseItem;

type MeetingListProps = {
  emptyMessage?: string;
  meetings: MeetingListItem[];
  sort?: MeetingLibrarySort;
  sortLinks?: Partial<
    Record<"duration" | "participantCount" | "startedAt" | "title", string>
  >;
};

const platformLabels: Record<MeetingListItem["platform"], string> = {
  google_meet: "Google Meet",
  in_person: "In person",
  zoom: "Zoom",
  upload: "Upload",
};

const statusLabels: Record<MeetingDisplayStatus, string> = {
  scheduled: "Scheduled",
  recording: "Recording",
  queued: "In progress",
  transcribing: "In progress",
  processing: "In progress",
  ready: "Ready",
  failed: "Failed",
};

export function MeetingList({
  emptyMessage = "No meetings found",
  meetings,
  sort = "smart",
  sortLinks,
}: MeetingListProps) {
  const [expandedMeetingIds, setExpandedMeetingIds] = useState<Set<string>>(
    () => getDefaultExpandedMeetingIds(meetings),
  );

  function toggleMeeting(meetingId: string) {
    setExpandedMeetingIds((current) => {
      const next = new Set(current);

      if (next.has(meetingId)) {
        next.delete(meetingId);
      } else {
        next.add(meetingId);
      }

      return next;
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead aria-sort={getHeaderAriaSort("title", sort)}>
            <SortableHeader
              activeDirection={getSortDirection("title", sort)}
              href={sortLinks?.title}
              label="Meeting"
            />
          </TableHead>
          <TableHead className="hidden sm:table-cell">Platform</TableHead>
          <TableHead
            aria-sort={getHeaderAriaSort("participantCount", sort)}
            className="hidden md:table-cell"
          >
            <SortableHeader
              activeDirection={getSortDirection("participantCount", sort)}
              href={sortLinks?.participantCount}
              label="Participants"
            />
          </TableHead>
          <TableHead
            aria-sort={getHeaderAriaSort("duration", sort)}
            className="hidden md:table-cell"
          >
            <SortableHeader
              activeDirection={getSortDirection("duration", sort)}
              href={sortLinks?.duration}
              label="Duration"
            />
          </TableHead>
          <TableHead
            aria-sort={getHeaderAriaSort("startedAt", sort)}
            className="hidden md:table-cell"
          >
            <SortableHeader
              activeDirection={getSortDirection("startedAt", sort)}
              href={sortLinks?.startedAt}
              label="Started"
            />
          </TableHead>
          <TableHead className="text-right">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {meetings.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={6}
              className="h-24 text-center text-muted-foreground"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          meetings.map((meeting) => {
            const relatedMeetings = meeting.relatedMeetings ?? [];
            const isExpanded = expandedMeetingIds.has(meeting.id);

            return (
              <Fragment key={meeting.id}>
                <MeetingTableRow
                  isExpanded={isExpanded}
                  meeting={meeting}
                  onToggle={() => toggleMeeting(meeting.id)}
                  relatedCount={relatedMeetings.length}
                />
                {isExpanded
                  ? relatedMeetings.map((relatedMeeting) => (
                      <MeetingTableRow
                        isChild
                        key={relatedMeeting.id}
                        meeting={relatedMeeting}
                      />
                    ))
                  : null}
              </Fragment>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

function getDefaultExpandedMeetingIds(meetings: MeetingListItem[]) {
  return new Set(
    meetings
      .filter((meeting) => (meeting.relatedMeetings?.length ?? 0) > 0)
      .map((meeting) => meeting.id),
  );
}

function MeetingTableRow({
  isChild = false,
  isExpanded = false,
  meeting,
  onToggle,
  relatedCount = 0,
}: {
  isChild?: boolean;
  isExpanded?: boolean;
  meeting: MeetingListBaseItem;
  onToggle?: () => void;
  relatedCount?: number;
}) {
  const displayStatus = getMeetingDisplayStatus({
    meetingStatus: meeting.status,
    transcriptJobStatus: meeting.transcriptJobStatus,
  });

  return (
    <TableRow
      aria-expanded={relatedCount > 0 ? isExpanded : undefined}
      className={isChild ? "bg-muted/20 hover:bg-muted/40" : undefined}
    >
      <TableCell className="min-w-56">
        <MeetingTitleCell
          isChild={isChild}
          isExpanded={isExpanded}
          meeting={meeting}
          onToggle={onToggle}
          relatedCount={relatedCount}
        />
      </TableCell>
      <TableCell className="hidden text-muted-foreground sm:table-cell">
        {platformLabels[meeting.platform]}
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        {formatParticipantCount(meeting.participantCount)}
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        {formatMeetingDuration({
          durationMs: meeting.durationMs,
          endedAt: meeting.endedAt,
          startedAt: meeting.startedAt,
        })}
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        <LocalDateTime value={meeting.startedAt} />
      </TableCell>
      <TableCell className="text-right">
        <Badge variant={getStatusVariant(displayStatus)}>
          {statusLabels[displayStatus]}
        </Badge>
      </TableCell>
    </TableRow>
  );
}

function MeetingTitleCell({
  isChild,
  isExpanded,
  meeting,
  onToggle,
  relatedCount,
}: {
  isChild: boolean;
  isExpanded: boolean;
  meeting: MeetingListBaseItem;
  onToggle?: () => void;
  relatedCount: number;
}) {
  const displayStatus = getMeetingDisplayStatus({
    meetingStatus: meeting.status,
    transcriptJobStatus: meeting.transcriptJobStatus,
  });

  return (
    <div className="flex min-w-0 items-start gap-1">
      {relatedCount > 0 ? (
        <Button
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${meeting.title}`}
          className="mt-0.5 size-5 rounded-md"
          onClick={onToggle}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          {isExpanded ? (
            <ChevronDown aria-hidden="true" />
          ) : (
            <ChevronRight aria-hidden="true" />
          )}
        </Button>
      ) : isChild ? (
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-5 items-center justify-center"
        >
          <span className="block h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
        </span>
      ) : null}
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link
            href={`/meetings/${meeting.id}`}
            className="font-medium text-foreground hover:underline"
          >
            {meeting.title}
          </Link>
          {relatedCount > 0 ? (
            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              {relatedCount === 1
                ? "1 related"
                : `${relatedCount} related`}
            </span>
          ) : null}
        </div>
        <span className="mt-1 block text-xs text-muted-foreground sm:hidden">
          {platformLabels[meeting.platform]}
        </span>
        <MeetingCoverageNote
          accessScope={meeting.accessScope}
          displayStatus={displayStatus}
          hasRecallBot={meeting.hasRecallBot}
        />
        {meeting.primaryEntity ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            Detected entity:{" "}
            <span className="font-medium text-foreground">
              {formatDetectedEntity(meeting.primaryEntity)}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function formatDetectedEntity(entity: string) {
  return entity
    .trim()
    .split(/\s+/)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function SortableHeader({
  activeDirection,
  href,
  label,
}: {
  activeDirection: "asc" | "desc" | null;
  href?: string;
  label: string;
}) {
  const content = (
    <>
      {label}
      {activeDirection === "asc" ? (
        <ArrowUp aria-hidden="true" />
      ) : activeDirection === "desc" ? (
        <ArrowDown aria-hidden="true" />
      ) : null}
    </>
  );

  if (!href) {
    return <span className="inline-flex items-center gap-1">{content}</span>;
  }

  return (
    <Link
      className="inline-flex items-center gap-1 hover:text-primary hover:underline"
      href={href}
    >
      {content}
    </Link>
  );
}

function getHeaderAriaSort(columnId: string, sort: MeetingLibrarySort) {
  const direction = getSortDirection(columnId, sort);

  if (direction === "asc") {
    return "ascending";
  }

  if (direction === "desc") {
    return "descending";
  }

  return undefined;
}

function getSortDirection(columnId: string, sort: MeetingLibrarySort) {
  if (columnId === "title") {
    return sort === "title_asc" ? "asc" : sort === "title_desc" ? "desc" : null;
  }

  if (columnId === "participantCount") {
    return sort === "participants_asc"
      ? "asc"
      : sort === "participants_desc"
        ? "desc"
        : null;
  }

  if (columnId === "duration") {
    return sort === "duration_asc"
      ? "asc"
      : sort === "duration_desc"
        ? "desc"
        : null;
  }

  if (columnId === "startedAt") {
    return sort === "time_asc" ? "asc" : sort === "time_desc" ? "desc" : null;
  }

  return null;
}

function MeetingCoverageNote({
  accessScope,
  displayStatus,
  hasRecallBot,
}: {
  accessScope?: "workspace" | "shared";
  displayStatus: MeetingDisplayStatus;
  hasRecallBot?: boolean;
}) {
  if (accessScope === "shared") {
    return (
      <span className="mt-1 block text-xs text-muted-foreground">
        Shared with you
      </span>
    );
  }

  if (displayStatus === "scheduled") {
    return (
      <span className="mt-1 block text-xs text-muted-foreground">
        {hasRecallBot ? "Bot scheduled" : "No bot linked"}
      </span>
    );
  }

  if (displayStatus === "recording") {
    return (
      <span className="mt-1 block text-xs text-muted-foreground">
        Bot in meeting
      </span>
    );
  }

  if (displayStatus === "failed") {
    return (
      <span className="mt-1 block text-xs text-destructive">
        Needs review
      </span>
    );
  }

  return null;
}

function getStatusVariant(status: MeetingDisplayStatus) {
  if (status === "failed") {
    return "destructive";
  }

  if (status === "scheduled" || status === "queued") {
    return "outline";
  }

  if (status === "processing" || status === "transcribing") {
    return "secondary";
  }

  return "default";
}

function formatParticipantCount(count: number | undefined) {
  if (typeof count !== "number") {
    return "Unknown";
  }

  return count === 1 ? "1 person" : `${count} people`;
}

function formatMeetingDuration(input: {
  durationMs?: number | null;
  endedAt?: string | null;
  startedAt: string;
}) {
  if (input.endedAt) {
    const startedTime = new Date(input.startedAt).getTime();
    const endedTime = new Date(input.endedAt).getTime();
    const durationMs = endedTime - startedTime;

    if (Number.isFinite(durationMs) && durationMs > 0) {
      return formatDurationMs(durationMs);
    }
  }

  if (typeof input.durationMs === "number" && input.durationMs > 0) {
    return formatDurationMs(input.durationMs);
  }

  return "Unknown";
}

function formatDurationMs(durationMs: number) {
  const totalMinutes = Math.max(1, Math.round(durationMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours && minutes) {
    return `${hours}h ${minutes}m`;
  }

  if (hours) {
    return `${hours}h`;
  }

  return `${minutes}m`;
}
