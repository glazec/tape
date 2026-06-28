import Link from "next/link";

import { Badge } from "@/components/ui/badge";
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

export type MeetingListItem = {
  id: string;
  title: string;
  platform: "google_meet" | "in_person" | "zoom" | "upload";
  startedAt: string;
  endedAt?: string | null;
  participantCount?: number;
  status: MeetingRecordStatus;
  transcriptJobStatus?: TranscriptJobStatus | null;
  hasRecallBot?: boolean;
  accessScope?: "workspace" | "shared";
  relatedMeetings?: Array<{
    id: string;
    title: string;
    startedAt: string;
  }>;
};

type MeetingListProps = {
  emptyMessage?: string;
  meetings: MeetingListItem[];
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
}: MeetingListProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Meeting</TableHead>
          <TableHead className="hidden sm:table-cell">Platform</TableHead>
          <TableHead className="hidden md:table-cell">Participants</TableHead>
          <TableHead className="hidden md:table-cell">Duration</TableHead>
          <TableHead className="hidden md:table-cell">Started</TableHead>
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
            const displayStatus = getMeetingDisplayStatus({
              meetingStatus: meeting.status,
              transcriptJobStatus: meeting.transcriptJobStatus,
            });

            return (
              <TableRow key={meeting.id}>
                <TableCell className="min-w-48">
                  <Link
                    href={`/meetings/${meeting.id}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {meeting.title}
                  </Link>
                  <span className="mt-1 block text-xs text-muted-foreground sm:hidden">
                    {platformLabels[meeting.platform]}
                  </span>
                  <MeetingCoverageNote
                    accessScope={meeting.accessScope}
                    displayStatus={displayStatus}
                    hasRecallBot={meeting.hasRecallBot}
                  />
                  {meeting.relatedMeetings?.length ? (
                    <div className="mt-3 border-l pl-3">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        Related
                      </p>
                      <ul className="space-y-1">
                        {meeting.relatedMeetings.map((related) => (
                          <li key={related.id}>
                            <Link
                              className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                              href={`/meetings/${related.id}`}
                            >
                              {related.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">
                  {platformLabels[meeting.platform]}
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {formatParticipantCount(meeting.participantCount)}
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {formatMeetingDuration(meeting.startedAt, meeting.endedAt)}
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
          })
        )}
      </TableBody>
    </Table>
  );
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

function formatMeetingDuration(startedAt: string, endedAt?: string | null) {
  if (!endedAt) {
    return "Unknown";
  }

  const startedTime = new Date(startedAt).getTime();
  const endedTime = new Date(endedAt).getTime();
  const durationMs = endedTime - startedTime;

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "Unknown";
  }

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
