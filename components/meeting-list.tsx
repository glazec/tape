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
  platform: "google_meet" | "zoom" | "upload";
  startedAt: string;
  status: MeetingRecordStatus;
  transcriptJobStatus?: TranscriptJobStatus | null;
  hasRecallBot?: boolean;
};

type MeetingListProps = {
  meetings: MeetingListItem[];
};

const platformLabels: Record<MeetingListItem["platform"], string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  upload: "Upload",
};

const statusLabels: Record<MeetingDisplayStatus, string> = {
  scheduled: "Scheduled",
  recording: "Recording",
  queued: "Queued",
  transcribing: "Transcribing",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

export function MeetingList({ meetings }: MeetingListProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Meeting</TableHead>
          <TableHead className="hidden sm:table-cell">Platform</TableHead>
          <TableHead className="hidden md:table-cell">Started</TableHead>
          <TableHead className="text-right">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {meetings.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={4}
              className="h-24 text-center text-muted-foreground"
            >
              No meetings found
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
                    displayStatus={displayStatus}
                    hasRecallBot={meeting.hasRecallBot}
                  />
                </TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">
                  {platformLabels[meeting.platform]}
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
  displayStatus,
  hasRecallBot,
}: {
  displayStatus: MeetingDisplayStatus;
  hasRecallBot?: boolean;
}) {
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
