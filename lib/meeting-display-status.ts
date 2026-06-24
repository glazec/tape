export type MeetingRecordStatus =
  | "scheduled"
  | "recording"
  | "processing"
  | "ready"
  | "failed";

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
