import {
  getMeetingDisplayStatus,
  type MeetingDisplayStatus,
  type MeetingRecordStatus,
  type TranscriptJobStatus,
} from "@/lib/meeting-display-status";

export type DashboardWorkflowMeeting = {
  title: string;
  startedAt: string;
  status: MeetingRecordStatus;
  transcriptJobStatus?: TranscriptJobStatus | null;
  hasRecallBot?: boolean;
};

type NextMeeting = {
  title: string;
  startedAt: string;
};

export type DashboardWorkflowSummaryModel = {
  upcomingBotJoins: number;
  readyTranscripts: number;
  activeWork: number;
  failedMeetings: number;
  scheduledWithoutBot: number;
  overdueScheduled: number;
  needsAttention: number;
  nextBotJoin: NextMeeting | null;
};

const activeStatuses = new Set<MeetingDisplayStatus>([
  "recording",
  "queued",
  "transcribing",
  "processing",
]);

export function getDashboardWorkflowSummary(
  meetings: DashboardWorkflowMeeting[],
  now = new Date(),
): DashboardWorkflowSummaryModel {
  const nowTime = now.getTime();
  const summary: DashboardWorkflowSummaryModel = {
    upcomingBotJoins: 0,
    readyTranscripts: 0,
    activeWork: 0,
    failedMeetings: 0,
    scheduledWithoutBot: 0,
    overdueScheduled: 0,
    needsAttention: 0,
    nextBotJoin: null,
  };

  for (const meeting of meetings) {
    const status = getMeetingDisplayStatus({
      meetingStatus: meeting.status,
      transcriptJobStatus: meeting.transcriptJobStatus,
    });
    const meetingTime = new Date(meeting.startedAt).getTime();
    const isFutureMeeting = meetingTime >= nowTime;

    if (status === "ready") {
      summary.readyTranscripts += 1;
    }

    if (status === "failed") {
      summary.failedMeetings += 1;
    }

    if (activeStatuses.has(status)) {
      summary.activeWork += 1;
    }

    if (status !== "scheduled") {
      continue;
    }

    if (!isFutureMeeting) {
      summary.overdueScheduled += 1;
      continue;
    }

    if (meeting.hasRecallBot) {
      summary.upcomingBotJoins += 1;

      if (
        !summary.nextBotJoin ||
        meetingTime < new Date(summary.nextBotJoin.startedAt).getTime()
      ) {
        summary.nextBotJoin = {
          title: meeting.title,
          startedAt: meeting.startedAt,
        };
      }

      continue;
    }

    summary.scheduledWithoutBot += 1;
  }

  summary.needsAttention =
    summary.failedMeetings +
    summary.scheduledWithoutBot +
    summary.overdueScheduled;

  return summary;
}
