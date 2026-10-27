"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  History,
  LogIn,
  RotateCcw,
} from "lucide-react";

import { MeetingBotRecoveryPanel } from "@/components/meeting-bot-recovery-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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
  platform:
    | "google_meet"
    | "in_person"
    | "microsoft_teams"
    | "zoom"
    | "upload";
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number | null;
  participantCount?: number;
  participantNames?: string[];
  status: MeetingRecordStatus;
  transcriptJobStatus?: TranscriptJobStatus | null;
  hasRecallBot?: boolean;
  canRecoverBot?: boolean;
  meetingUrl?: string | null;
  accessScope?: "workspace" | "shared";
  primaryEntity?: string | null;
};

export type MeetingListItem = MeetingListBaseItem & {
  hasMoreRelatedMeetings?: boolean;
  relatedHistoryHref?: string;
  relatedHistoryMonths?: number;
  relatedMeetings?: MeetingListRelatedItem[];
  olderRelatedMeetings?: MeetingListRelatedItem[];
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
  microsoft_teams: "Microsoft Teams",
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
  // Series start collapsed: the library reads as one timeline, and a
  // series opens only when someone asks for its history.
  const [expandedMeetingIds, setExpandedMeetingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const dayLabels = useDayGroupLabels(meetings, sort);

  const [visibleRelatedCounts, setVisibleRelatedCounts] = useState<Record<string, number>>({});

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
    <div>
      <Table>
        {/* The rows describe themselves; headers stay for screen readers and
            keep their sort links reachable by keyboard. */}
        <TableHeader className="sr-only">
          <TableRow className="border-border/60 hover:bg-transparent">
            <TableHead
              aria-sort={getHeaderAriaSort("startedAt", sort)}
              className="hidden w-28 pl-0 text-xs font-normal text-muted-foreground md:table-cell"
            >
              <SortableHeader
                activeDirection={getSortDirection("startedAt", sort)}
                href={sortLinks?.startedAt}
                label="Time"
              />
            </TableHead>
            <TableHead
              aria-sort={getHeaderAriaSort("title", sort)}
              className="text-xs font-normal text-muted-foreground"
            >
              <SortableHeader
                activeDirection={getSortDirection("title", sort)}
                href={sortLinks?.title}
                label="Meeting"
              />
            </TableHead>
            <TableHead className="w-28 pr-4 text-right text-xs font-normal text-muted-foreground">
              Status
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {meetings.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={3}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            meetings.map((meeting, index) => {
              const recentMeetings = meeting.relatedMeetings ?? [];
              const relatedMeetings = [...recentMeetings, ...(meeting.olderRelatedMeetings ?? [])];
              const visibleCount = visibleRelatedCounts[meeting.id] ?? Math.min(3, recentMeetings.length);
              const hasMore = visibleCount < relatedMeetings.length;
              const isExpanded = expandedMeetingIds.has(meeting.id);
              const groupLabel = dayLabels?.[index] ?? null;

              return (
                <Fragment key={meeting.id}>
                  {groupLabel ? (
                    <TableRow className="border-0 hover:bg-transparent">
                      <TableCell
                        className="border-b border-border pt-8 pb-2 pl-0 text-[0.8125rem] font-semibold text-foreground"
                        colSpan={3}
                        scope="rowgroup"
                      >
                        {groupLabel}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  <MeetingTableRow
                    grouped={dayLabels !== null}
                    isExpanded={isExpanded}
                    meeting={meeting}
                    moreAction={
                      !isExpanded ? null : hasMore ? (
                        <button
                          aria-label={`Load more meetings for ${meeting.title}`}
                          className="rounded-sm text-xs text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() =>
                            setVisibleRelatedCounts((counts) => ({
                              ...counts,
                              [meeting.id]: visibleCount + 4,
                            }))
                          }
                          type="button"
                        >
                          Show more
                        </button>
                      ) : meeting.hasMoreRelatedMeetings &&
                        !meeting.olderRelatedMeetings &&
                        meeting.relatedHistoryHref ? (
                        <RelatedHistoryLink
                          href={meeting.relatedHistoryHref}
                          months={meeting.relatedHistoryMonths}
                        />
                      ) : null
                    }
                    onToggle={() => toggleMeeting(meeting.id)}
                    relatedCount={relatedMeetings.length || (meeting.hasMoreRelatedMeetings ? 1 : 0)}
                  />
                  {isExpanded
                    ? [
                        ...relatedMeetings.slice(0, visibleCount).map((relatedMeeting) => (
                          <MeetingTableRow
                            isChild
                            key={relatedMeeting.id}
                            meeting={relatedMeeting}
                          />
                        )),
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

function RelatedHistoryLink({
  href,
  months,
}: {
  href: string;
  months?: number;
}) {
  return (
    <Link
      className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground hover:decoration-foreground"
      href={href}
      scroll={false}
      title={`Search before last ${months ?? 6} months`}
    >
      <History aria-hidden="true" className="size-3" />
      Earlier
      <span className="sr-only">
        : Load more meetings. Search before last {months ?? 6} months
      </span>
    </Link>
  );
}

function MeetingTableRow({
  grouped = false,
  isChild = false,
  isExpanded = false,
  meeting,
  moreAction = null,
  onToggle,
  relatedCount = 0,
}: {
  grouped?: boolean;
  isChild?: boolean;
  isExpanded?: boolean;
  meeting: MeetingListBaseItem;
  moreAction?: ReactNode;
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
        "group/meeting-row meeting-row border-border/45",
        isChild && "border-b-0",
      )}
    >
      <TableCell
        className={cn(
          "hidden w-28 pl-0 align-top whitespace-nowrap text-sm tabular-nums md:table-cell",
          isChild ? "pt-2.5 text-muted-foreground/80" : "pt-3.5 text-muted-foreground",
        )}
      >
        <LocalDateTime timeOnly={grouped && !isChild} value={meeting.startedAt} />
      </TableCell>
      <TableCell className={cn("min-w-56", isChild ? "py-2" : "py-3")}>
        <MeetingTitleCell
          isChild={isChild}
          isExpanded={isExpanded}
          meeting={meeting}
          moreAction={moreAction}
          onToggle={onToggle}
          relatedCount={relatedCount}
        />
      </TableCell>
      <TableCell className="w-28 pr-4 align-top pt-3 text-right">
        {displayStatus === "failed" && meeting.canRecoverBot ? (
          <FailedMeetingAction meeting={meeting} />
        ) : displayStatus === "scheduled" &&
        meeting.hasRecallBot &&
        meeting.accessScope !== "shared" ? (
          <ScheduledMeetingAction meeting={meeting} />
        ) : (
          <MeetingStatusLabel status={displayStatus} />
        )}
      </TableCell>
    </TableRow>
  );
}

function FailedMeetingAction({ meeting }: { meeting: MeetingListBaseItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [complete, setComplete] = useState(false);
  const [joining, setJoining] = useState(false);
  const doneRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (complete) {
      doneRef.current?.focus();
    }
  }, [complete]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && joining) {
      return;
    }

    setOpen(nextOpen);
    if (!nextOpen) {
      if (complete) {
        router.refresh();
      }
      setComplete(false);
    }
  }

  return (
    <span className="inline-grid w-[5.625rem] items-center justify-items-end">
      <span className="meeting-join-badge col-start-1 row-start-1 hidden transition-opacity">
        <MeetingStatusLabel status="failed" />
      </span>
      <Button
        aria-haspopup="dialog"
        aria-label={`Rejoin ${meeting.title}`}
        className="meeting-join-action col-start-1 row-start-1 h-5 w-[5.625rem] rounded-4xl border-primary bg-background px-2 py-0.5 text-xs text-primary shadow-none hover:bg-primary/10 hover:text-primary [@media(hover:none)]:h-11 [@media(hover:none)]:text-sm"
        data-state="idle"
        onClick={() => setOpen(true)}
        ref={triggerRef}
        size="xs"
        type="button"
        variant="outline"
      >
        <RotateCcw aria-hidden="true" />
        Rejoin
      </Button>
      <Dialog onOpenChange={handleOpenChange} open={open}>
        {open ? (
          <DialogContent finalFocus={triggerRef}>
            <DialogTitle>Continue this meeting</DialogTitle>
            <DialogDescription className="mt-2">
              {meeting.meetingUrl
                ? "Tape did not capture a usable record. Send the bot back to the same call or use a new Google Meet or Zoom link."
                : "Tape did not capture a usable record. Enter a new Google Meet or Zoom link to continue under this meeting record."}
            </DialogDescription>
            <div className="mt-5">
              <MeetingBotRecoveryPanel
                meetingId={meeting.id}
                meetingUrl={meeting.meetingUrl ?? null}
                onComplete={() => setComplete(true)}
                onStateChange={(state) => setJoining(state === "joining")}
                presentation="dialog"
                refreshOnComplete={false}
              />
            </div>
            <div className="mt-5 flex justify-end">
              <DialogClose
                className={buttonVariants({
                  className: "min-h-11",
                  variant: complete ? "default" : "ghost",
                })}
                disabled={joining}
                ref={doneRef}
                type="button"
              >
                {complete ? "Done" : "Cancel"}
              </DialogClose>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </span>
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
    <span className="inline-grid w-[5.625rem] items-center justify-items-end">
      {state === "idle" ? (
        <span className="meeting-join-badge col-start-1 row-start-1 hidden transition-opacity">
          <MeetingStatusLabel status="scheduled" />
        </span>
      ) : null}
      <Button
        aria-busy={state === "joining"}
        aria-label={`Join ${meeting.title} now`}
        className={cn(
          "meeting-join-action col-start-1 row-start-1 h-5 w-[5.625rem] rounded-4xl border-primary bg-background px-2 py-0.5 text-xs text-primary shadow-none hover:bg-primary/10 hover:text-primary [@media(hover:none)]:h-11 [@media(hover:none)]:text-sm",
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
  moreAction,
  onToggle,
  relatedCount,
}: {
  isChild: boolean;
  isExpanded: boolean;
  meeting: MeetingListBaseItem;
  moreAction: ReactNode;
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
        "flex min-w-0 items-start",
        isChild &&
          "relative pl-4 before:absolute before:bottom-1 before:left-0 before:top-1 before:w-px before:bg-border",
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link
            className={cn(
              isChild ? "text-sm hover:underline" : "font-medium hover:underline",
              shouldDimMeetingCopy
                ? "text-muted-foreground hover:text-foreground"
                : "text-foreground",
            )}
            href={`/meetings/${meeting.id}`}
          >
            {meeting.title}
          </Link>
          {relatedCount > 0 ? (
            // The related count is the toggle, so rows need no chevron
            // column and titles share one left edge.
            <button
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${meeting.title}`}
              className="inline-flex items-center gap-0.5 rounded-sm text-xs tabular-nums text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onToggle}
              type="button"
            >
              {relatedCount === 1 ? "1 related" : `${relatedCount} related`}
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-3 transition-transform",
                  isExpanded && "rotate-180",
                )}
              />
            </button>
          ) : null}
          {moreAction}
        </div>
        <MeetingMeta displayStatus={displayStatus} meeting={meeting} />
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

function getMeetingCoverageNote({
  accessScope,
  displayStatus,
  hasRecallBot,
  platform,
}: {
  accessScope?: "workspace" | "shared";
  displayStatus: MeetingDisplayStatus;
  hasRecallBot?: boolean;
  platform: MeetingListBaseItem["platform"];
}) {
  if (accessScope === "shared") {
    return "Shared with you";
  }

  if (displayStatus === "scheduled") {
    // "Bot scheduled" would repeat the Scheduled status beside it.
    return hasRecallBot
      ? null
      : platform === "microsoft_teams"
        ? "Local recording planned"
        : "No bot linked";
  }

  if (displayStatus === "recording") {
    return platform === "in_person" || platform === "microsoft_teams"
      ? "Recording locally"
      : "Bot in meeting";
  }

  if (displayStatus === "failed") {
    return "Needs review";
  }

  if (displayStatus === "missed") {
    return "Bot did not join";
  }

  return null;
}

/**
 * Platform, people, and length read as one quiet line under the title, so the
 * row carries one subject instead of four equal-weight columns. Facts that are
 * not known are left out rather than printed as "Unknown".
 */
function MeetingMeta({
  displayStatus,
  meeting,
}: {
  displayStatus: MeetingDisplayStatus;
  meeting: MeetingListBaseItem;
}) {
  const duration = formatMeetingDuration({
    durationMs: meeting.durationMs,
    endedAt: meeting.endedAt,
    startedAt: meeting.startedAt,
    status: meeting.status,
  });
  const coverageNote = getMeetingCoverageNote({
    accessScope: meeting.accessScope,
    displayStatus,
    hasRecallBot: meeting.hasRecallBot,
    platform: meeting.platform,
  });
  const parts: ReactNode[] = [
    <span key="platform">{platformLabels[meeting.platform]}</span>,
  ];

  if (typeof meeting.participantCount === "number") {
    parts.push(
      <ParticipantCount
        count={meeting.participantCount}
        key="people"
        names={meeting.participantNames}
      />,
    );
  }

  if (duration) {
    parts.push(
      <span className="tabular-nums" key="duration">
        {duration}
      </span>,
    );
  }

  if (coverageNote) {
    parts.push(<span key="coverage">{coverageNote}</span>);
  }

  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          {part}
        </Fragment>
      ))}
      {/* The Started column is hidden below md, so the date joins the line. */}
      <span className="inline-flex items-center gap-x-1.5 md:hidden">
        <span aria-hidden="true">·</span>
        <LocalDateTime value={meeting.startedAt} />
      </span>
    </span>
  );
}

const statusDotClassNames: Partial<Record<MeetingDisplayStatus, string>> = {
  scheduled: "bg-slate-400",
  ready: "bg-emerald-500",
  queued: "bg-amber-500",
  transcribing: "bg-amber-500",
  processing: "bg-amber-500",
  recording: "bg-rose-500",
  failed: "bg-destructive",
};

/** Status as a colored dot and its label: legible without color, and quiet. */
function MeetingStatusLabel({ status }: { status: MeetingDisplayStatus }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      data-status={status}
    >
      {statusDotClassNames[status] ? (
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", statusDotClassNames[status])}
        />
      ) : null}
      {statusLabels[status]}
    </span>
  );
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

  return null;
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

const groupableSorts = new Set<MeetingLibrarySort>(["smart", "time_desc", "time_asc"]);

/**
 * Day headers for a time ordered library: upcoming meetings under one
 * "Upcoming" header, then one header per local day. Computed only in the
 * browser, because day boundaries depend on the viewer's timezone.
 */
function useDayGroupLabels(
  meetings: MeetingListItem[],
  sort: MeetingLibrarySort,
) {
  const isClient = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  if (!isClient || !groupableSorts.has(sort)) {
    return null;
  }

  const now = new Date();
  const labels = meetings.map((meeting) => {
    const startedAt = new Date(meeting.startedAt);

    return meeting.status === "scheduled" &&
      startedAt.getTime() > now.getTime()
      ? "Upcoming"
      : formatDayLabel(startedAt, now);
  });

  // Only the first meeting of each run carries the header.
  return labels.map((label, index) =>
    index > 0 && labels[index - 1] === label ? null : label,
  );
}

function subscribeToNothing() {
  return () => {};
}

function formatDayLabel(date: Date, now: Date) {
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (days === 0) {
    return "Today";
  }

  if (days === 1) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}
