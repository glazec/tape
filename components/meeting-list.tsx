import Link from "next/link";

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

const statusStyles: Record<MeetingListItem["status"], string> = {
  scheduled: "border-[var(--border)] text-[var(--muted)]",
  recording: "border-blue-200 bg-blue-50 text-blue-700",
  processing: "border-amber-200 bg-amber-50 text-amber-700",
  ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-red-200 bg-red-50 text-red-700",
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
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-white">
      <div className="grid grid-cols-12 gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-xs font-semibold uppercase tracking-normal text-[var(--muted)]">
        <span className="col-span-6">Meeting</span>
        <span className="col-span-2 hidden sm:block">Platform</span>
        <span className="col-span-2 hidden md:block">Started</span>
        <span className="col-span-6 text-right sm:col-span-4 md:col-span-2">
          Status
        </span>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {meetings.map((meeting) => (
          <li key={meeting.id}>
            <Link
              href={`/meetings/${meeting.id}`}
              className="grid grid-cols-12 gap-4 px-4 py-4 hover:bg-[var(--surface)]"
            >
              <span className="col-span-6 min-w-0">
                <span className="block truncate text-sm font-semibold text-[var(--text)]">
                  {meeting.title}
                </span>
                <span className="mt-1 block text-xs text-[var(--muted)] sm:hidden">
                  {platformLabels[meeting.platform]}
                </span>
              </span>
              <span className="col-span-2 hidden text-sm text-[var(--muted)] sm:block">
                {platformLabels[meeting.platform]}
              </span>
              <span className="col-span-2 hidden text-sm text-[var(--muted)] md:block">
                {formatStartedAt(meeting.startedAt)}
              </span>
              <span className="col-span-6 flex justify-end sm:col-span-4 md:col-span-2">
                <span
                  className={`inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium ${statusStyles[meeting.status]}`}
                >
                  {statusLabels[meeting.status]}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
