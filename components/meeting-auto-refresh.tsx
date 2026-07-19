"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import {
  isTranslationActive,
  type MeetingTranslationStatus,
} from "@/lib/meeting-translation-status";
import {
  getMeetingDisplayStatus,
  type MeetingRecordStatus,
  type TranscriptJobStatus,
} from "@/lib/meeting-display-status";

const MEETING_AUTO_REFRESH_INTERVAL_MS = 5000;

type MeetingAutoRefreshProps = {
  meetingStatus: MeetingRecordStatus;
  segmentCount: number;
  transcriptJobStatus?: TranscriptJobStatus | null;
  translationStatus?: MeetingTranslationStatus | null;
};

export function MeetingAutoRefresh(props: MeetingAutoRefreshProps) {
  const router = useRouter();
  const shouldRefresh = shouldAutoRefreshMeeting(props);

  useEffect(() => {
    if (!shouldRefresh) {
      return;
    }

    const intervalId = window.setInterval(() => {
      router.refresh();
    }, MEETING_AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [router, shouldRefresh]);

  return null;
}

export function shouldAutoRefreshMeeting({
  meetingStatus,
  segmentCount,
  transcriptJobStatus,
  translationStatus,
}: MeetingAutoRefreshProps) {
  if (translationStatus && isTranslationActive(translationStatus)) {
    return true;
  }

  if (segmentCount > 0) {
    return false;
  }

  const displayStatus = getMeetingDisplayStatus({
    meetingStatus,
    transcriptJobStatus,
  });

  return !["ready", "failed", "missed", "cancelled"].includes(displayStatus);
}
