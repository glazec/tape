export type MeetingRecordStatus =
  | "scheduled"
  | "recording"
  | "processing"
  | "ready"
  | "failed"
  | "missed"
  | "cancelled";

export type TranscriptJobStatus = "queued" | "running" | "completed" | "failed";

export type MeetingDisplayStatus =
  | MeetingRecordStatus
  | "queued"
  | "transcribing";

export function getMeetingDisplayStatus(input: {
  meetingStatus: MeetingRecordStatus;
  transcriptJobStatus?: TranscriptJobStatus | null;
}): MeetingDisplayStatus {
  if (input.meetingStatus !== "processing") {
    return input.meetingStatus;
  }

  if (input.transcriptJobStatus === "queued") {
    return "queued";
  }

  if (input.transcriptJobStatus === "running") {
    return "transcribing";
  }

  if (input.transcriptJobStatus === "failed") {
    return "failed";
  }

  return "processing";
}

// Keep labels as well as color so status remains understandable without color.
export function getMeetingStatusClassName(status: string): string {
  switch (status.toLowerCase()) {
    case "scheduled":
      return "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
    case "ready":
      return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200";
    case "queued":
    case "transcribing":
    case "processing":
    case "in progress":
      return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200";
    case "recording":
      return "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200";
    default:
      return "";
  }
}
