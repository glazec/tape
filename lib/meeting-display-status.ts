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
  | "joining"
  | "waiting_room"
  | "queued"
  | "transcribing";

export function getMeetingDisplayStatus(input: {
  botState?: string | null;
  meetingStatus: MeetingRecordStatus;
  transcriptJobStatus?: TranscriptJobStatus | null;
}): MeetingDisplayStatus {
  // Joining and waiting for admission are not recording states.
  if (
    (input.botState === "waiting_room" || input.botState === "joining") &&
    (input.meetingStatus === "scheduled" || input.meetingStatus === "recording")
  ) {
    return input.botState;
  }

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

const activeStatuses = new Set<MeetingDisplayStatus>([
  "joining", "waiting_room", "recording", "queued", "transcribing", "processing",
]);

export function isActiveMeetingStatus(status: MeetingDisplayStatus) {
  return activeStatuses.has(status);
}

type MeetingPartState = {
  status: MeetingRecordStatus;
  botState?: string | null;
  transcriptJobStatus?: TranscriptJobStatus | null;
  kind?: string;
};

export function getComposedMeetingState(
  primary: MeetingPartState,
  sources: MeetingPartState[],
): MeetingPartState {
  if (sources.length === 0) return primary;
  const states = [primary, ...sources].map((part) => ({
    status: !["scheduled", "recording"].includes(part.status) &&
      ["queued", "running"].includes(part.transcriptJobStatus ?? "")
      ? "processing" as const : part.status,
    botState: part.botState ?? (
      part.kind === "continuation" && part.status === "scheduled" ? "joining" : null
    ),
  }));
  // A live recording takes precedence over another part waiting for admission.
  for (const status of ["recording", "waiting_room", "joining", "scheduled", "processing", "failed"]) {
    const active = states.find((part) => getMeetingDisplayStatus({
      meetingStatus: part.status,
      botState: part.botState,
    }) === status);
    if (active) return active;
  }
  return primary;
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
    case "joining":
    case "bot joining":
    case "waiting_room":
    case "in waiting room":
      return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200";
    case "recording":
      return "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200";
    default:
      return "";
  }
}
