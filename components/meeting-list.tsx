"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  History,
  LogIn,
} from "lucide-react";

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
import { cn } from "@/lib/utils";

type MeetingListBaseItem = {
  id: string;
  title: string;
  platform: "google_meet" | "in_person" | "zoom" | "upload";
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number | null;
  participantCount?: number;
  participantNames?: string[];
  status: MeetingRecordStatus;
  transcriptJobStatus?: TranscriptJobStatus | null;
  hasRecallBot?: boolean;
  accessScope?: "workspace" | "shared";
  primaryEntity?: string | null;
};

export type MeetingListItem = MeetingListBaseItem & {
  hasMoreRelatedMeetings?: boolean;
  relatedHistoryHref?: string;
  relatedHistoryMonths?: number;
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
  missed: "No recording",
  cancelled: "Cancelled",
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
    <div className="bg-card">
      <Table>
        <TableHeader className="bg-muted/30">
          <TableRow className="hover:bg-muted/30">
            <TableHead
              aria-sort={getHeaderAriaSort("title", sort)}
              className="pl-8"
            >
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
            <TableHead className="w-28 text-center">Status</TableHead>
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
                    ? [
                        ...relatedMeetings.map((relatedMeeting) => (
                          <MeetingTableRow
                            isChild
                            key={relatedMeeting.id}
                            meeting={relatedMeeting}
                          />
                        )),
                        meeting.hasMoreRelatedMeetings &&
                        meeting.relatedHistoryHref ? (
                          <RelatedHistoryRow
                            href={meeting.relatedHistoryHref}
                            key={`${meeting.id}:related-history`}
                            months={meeting.relatedHistoryMonths}
                          />
                        ) : null,
                      ]
                    : null}
                </Fragment>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function RelatedHistoryRow({
  href,
  months,
}: {
  href: string;
  months?: number;
}) {
  return (
    <TableRow className="bg-muted/15 hover:bg-muted/25">
      <TableCell colSpan={6} className="py-3 pl-16">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <Link
            className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-sm font-medium text-foreground hover:bg-muted"
            href={href}
          >
            <History aria-hidden="true" className="size-4" />
            Load older related
          </Link>
          <span>Search before last {months ?? 6} months</span>
        </div>
      </TableCell>
    </TableRow>
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
      className={cn(
        "group/meeting-row meeting-row",
        isChild && "bg-muted/15 hover:bg-muted/30",
      )}
    >
      <TableCell className="min-w-56 py-3">
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
        <ParticipantCount
          count={meeting.participantCount}
          names={meeting.participantNames}
        />
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        {formatMeetingDuration({
          durationMs: meeting.durationMs,
          endedAt: meeting.endedAt,
          startedAt: meeting.startedAt,
          status: meeting.status,
        })}
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        <LocalDateTime value={meeting.startedAt} />
      </TableCell>
      <TableCell className="w-28 text-center">
        {displayStatus === "scheduled" &&
        meeting.hasRecallBot &&
        meeting.accessScope !== "shared" ? (
          <ScheduledMeetingAction meeting={meeting} />
        ) : (
          <Badge variant={getStatusVariant(displayStatus)}>
            {statusLabels[displayStatus]}
          </Badge>
        )}
      </TableCell>
    </TableRow>
  );
}

function ScheduledMeetingAction({ meeting }: { meeting: MeetingListBaseItem }) {
  const endpoint = `/api/meetings/${meeting.id}/join`;
  const [state, setState] = useState<"idle" | "joining" | "joined" | "error">(
    "idle",
  );

  async function handleJoinNow() {
    setState("joining");

    try {
      const response = await fetch(endpoint, { method: "POST" });

      if (!response.ok) {
        throw new Error("Meeting bot could not join");
      }

      setState("joined");
    } catch {
      setState("error");
    }
  }

  const announcement =
    state === "joined"
      ? `Bot is joining ${meeting.title} and should appear within about 30 seconds`
      : state === "error"
        ? `Bot could not join ${meeting.title}`
        : state === "joining"
          ? `Asking the bot to join ${meeting.title}`
          : "";

  return (
    <span className="inline-grid w-[5.625rem] items-center justify-items-center">
      {state === "idle" ? (
        <Badge
          className="meeting-join-badge col-start-1 row-start-1 hidden transition-opacity"
          variant="outline"
        >
          Scheduled
        </Badge>
      ) : null}
      <Button
        aria-busy={state === "joining"}
        aria-label={`Join ${meeting.title} now`}
        className={cn(
          "meeting-join-action col-start-1 row-start-1 h-5 w-[5.625rem] rounded-4xl border-primary bg-background px-2 py-0.5 text-xs text-primary shadow-none hover:bg-primary/10 hover:text-primary",
          state === "error" &&
            "border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive",
        )}
        data-endpoint={endpoint}
        data-state={state}
        disabled={state === "joining" || state === "joined"}
        onClick={handleJoinNow}
        size="xs"
        title="Send the bot to this meeting now"
        type="button"
        variant="outline"
      >
        <LogIn aria-hidden="true" />
        {state === "joining"
          ? "Joining..."
          : state === "joined"
            ? "Bot joining"
            : state === "error"
              ? "Try again"
              : "Join now"}
      </Button>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </span>
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
  const shouldDimMeetingCopy =
    displayStatus === "failed" || displayStatus === "missed";

  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-1",
        isChild &&
          "relative pl-8 before:absolute before:bottom-1 before:left-3 before:top-1 before:w-px before:bg-border",
      )}
    >
      {relatedCount > 0 ? (
        <Button
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${meeting.title}`}
          className="mt-0.5 size-5 shrink-0 rounded-md"
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
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center"
        />
      ) : (
        <span aria-hidden="true" className="mt-0.5 flex size-5 shrink-0" />
      )}
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link
            className={cn(
              "font-medium hover:underline",
              shouldDimMeetingCopy
                ? "text-muted-foreground hover:text-foreground"
                : "text-foreground",
            )}
            href={`/meetings/${meeting.id}`}
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
      </div>
    </div>
  );
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
      <span className="mt-1 block text-xs text-muted-foreground">
        Needs review
      </span>
    );
  }

  if (displayStatus === "missed") {
    return (
      <span className="mt-1 block text-xs text-muted-foreground">
        Bot did not join
      </span>
    );
  }

  return null;
}

function getStatusVariant(status: MeetingDisplayStatus) {
  if (status === "failed") {
    return "destructive";
  }

  if (status === "ready") {
    return "secondary";
  }

  if (
    status === "scheduled" ||
    status === "queued" ||
    status === "missed" ||
    status === "cancelled"
  ) {
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

function ParticipantCount({
  count,
  names,
}: {
  count: number | undefined;
  names?: string[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const label = formatParticipantCount(count);
  const participantNames =
    names?.map((name) => name.trim()).filter(Boolean).slice(0, 50) ?? [];

  if (participantNames.length === 0) {
    return <span>{label}</span>;
  }

  const namesText = participantNames.join(", ");

  return (
    <span
      aria-label={`Participants: ${namesText}`}
      className="relative inline-flex cursor-default"
      onBlur={() => setIsOpen(false)}
      onFocus={() => setIsOpen(true)}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      tabIndex={0}
    >
      <span>{label}</span>
      <span
        className={cn(
          "pointer-events-none absolute left-0 top-full z-50 mt-2 min-w-48 max-w-72 rounded-lg border bg-popover px-3 py-2 text-left text-xs leading-5 whitespace-normal text-popover-foreground shadow-lg",
          isOpen ? "block" : "hidden",
        )}
      >
        {participantNames.map((name) => (
          <span className="block" key={name}>
            {name}
          </span>
        ))}
      </span>
    </span>
  );
}

function formatMeetingDuration(input: {
  durationMs?: number | null;
  endedAt?: string | null;
  startedAt: string;
  status: MeetingRecordStatus;
}) {
  if (typeof input.durationMs === "number" && input.durationMs > 0) {
    return formatDurationMs(input.durationMs);
  }

  if (
    input.status === "scheduled" &&
    new Date(input.startedAt).getTime() > Date.now() &&
    input.endedAt
  ) {
    const startedTime = new Date(input.startedAt).getTime();
    const endedTime = new Date(input.endedAt).getTime();
    const durationMs = endedTime - startedTime;

    if (Number.isFinite(durationMs) && durationMs > 0) {
      return formatDurationMs(durationMs);
    }
  }

  return "Unknown";
}

function formatDurationMs(durationMs: number) {
  const totalMinutes = Math.max(1, Math.floor(durationMs / 60000));
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
