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

export type MeetingListItem = {
  id: string;
  title: string;
  platform: "google_meet" | "zoom" | "upload";
  startedAt: string;
  status: "scheduled" | "recording" | "processing" | "ready" | "failed";
};

type MeetingListProps = {
  meetings: MeetingListItem[];
};

const platformLabels: Record<MeetingListItem["platform"], string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  upload: "Upload",
};

const statusLabels: Record<MeetingListItem["status"], string> = {
  scheduled: "Scheduled",
  recording: "Recording",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

function formatStartedAt(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

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
        {meetings.map((meeting) => (
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
            </TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">
              {platformLabels[meeting.platform]}
            </TableCell>
            <TableCell className="hidden text-muted-foreground md:table-cell">
              {formatStartedAt(meeting.startedAt)}
            </TableCell>
            <TableCell className="text-right">
              <Badge variant={getStatusVariant(meeting.status)}>
                {statusLabels[meeting.status]}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function getStatusVariant(status: MeetingListItem["status"]) {
  if (status === "failed") {
    return "destructive";
  }

  if (status === "scheduled") {
    return "outline";
  }

  if (status === "processing") {
    return "secondary";
  }

  return "default";
}
