import {
  getMeetingDisplayStatus,
  type MeetingDisplayStatus,
  type MeetingRecordStatus,
  type TranscriptJobStatus,
} from "@/lib/meeting-display-status";

export type DashboardWorkflowMeeting = {
  durationMs?: number | null;
  title: string;
  startedAt: string;
  endedAt?: string | null;
  status: MeetingRecordStatus;
  transcriptJobStatus?: TranscriptJobStatus | null;
  hasRecallBot?: boolean;
  segments?: DashboardWorkflowSegment[];
};

export type DashboardWorkflowSegment = {
  speaker: string | null;
  startMs: number;
  endMs: number | null;
  text: string;
  emotionLabel?: DashboardMeetingEmotion | null;
};

type NextMeeting = {
  title: string;
  startedAt: string;
};

type DashboardMeetingEmotion = "hard" | "chill" | "neutral";

export type DashboardUserStats = {
  last7DaysMeetings: number;
  previous7DaysMeetings: number;
  meetingChangePercent: number;
  meetingHours: number;
  spokenWords: number;
  talkSharePercent: number | null;
  dominantEmotion: DashboardMeetingEmotion | null;
  dominantEmotionPercent: number | null;
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
  userStats: DashboardUserStats;
};

export type DashboardWorkflowSummaryOptions = {
  userEmail?: string | null;
  userName?: string | null;
  userSpeakerAliases?: string[];
};

const activeStatuses = new Set<MeetingDisplayStatus>([
  "recording",
  "queued",
  "transcribing",
  "processing",
]);
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TRANSCRIPT_FALLBACK_WORD_PATTERN = /[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?/g;
const TRANSCRIPT_CJK_CHARACTER_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/g;
const dashboardWordSegmenter = createDashboardWordSegmenter();

export function getDashboardWorkflowSummary(
  meetings: DashboardWorkflowMeeting[],
  now = new Date(),
  options: DashboardWorkflowSummaryOptions = {},
): DashboardWorkflowSummaryModel {
  const visibleMeetings = meetings.filter(
    (meeting) => meeting.status !== "cancelled",
  );
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
    userStats: getDashboardUserStats(visibleMeetings, now, options),
  };

  for (const meeting of visibleMeetings) {
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

function getDashboardUserStats(
  meetings: DashboardWorkflowMeeting[],
  now: Date,
  options: DashboardWorkflowSummaryOptions,
): DashboardUserStats {
  const nowTime = now.getTime();
  const currentStartTime = nowTime - SEVEN_DAYS_MS;
  const previousStartTime = nowTime - SEVEN_DAYS_MS * 2;
  const userAliases = getUserSpeakerAliases(options);
  const emotionScores: Record<DashboardMeetingEmotion, number> = {
    hard: 0,
    chill: 0,
    neutral: 0,
  };
  let last7DaysMeetings = 0;
  let previous7DaysMeetings = 0;
  let meetingDurationMs = 0;
  let spokenWords = 0;
  let totalDurationMs = 0;
  let userDurationMs = 0;

  for (const meeting of meetings) {
    const meetingTime = new Date(meeting.startedAt).getTime();

    if (!Number.isFinite(meetingTime) || meetingTime > nowTime) {
      continue;
    }

    const isCurrentPeriod = meetingTime >= currentStartTime;
    const isPreviousPeriod =
      meetingTime >= previousStartTime && meetingTime < currentStartTime;

    if (!isCurrentPeriod && !isPreviousPeriod) {
      continue;
    }

    if (isCurrentPeriod) {
      last7DaysMeetings += 1;
      meetingDurationMs += getMeetingDurationMs(meeting);
    } else {
      previous7DaysMeetings += 1;
      continue;
    }

    for (const segment of meeting.segments ?? []) {
      const durationMs = getSegmentDurationMs(segment);
      const isUserSegment =
        userAliases.size > 0 && isMatchingUserSpeaker(segment.speaker, userAliases);

      totalDurationMs += durationMs;

      if (segment.emotionLabel) {
        emotionScores[segment.emotionLabel] += durationMs > 0 ? durationMs : 1;
      }

      if (!isUserSegment) {
        continue;
      }

      spokenWords += countTranscriptWords(segment.text);
      userDurationMs += durationMs;
    }
  }

  const dominantEmotionStats = getDominantEmotionStats(emotionScores);

  return {
    last7DaysMeetings,
    previous7DaysMeetings,
    meetingChangePercent: getMeetingChangePercent(
      last7DaysMeetings,
      previous7DaysMeetings,
    ),
    meetingHours: roundToSingleDecimal(meetingDurationMs / 3600000),
    spokenWords,
    talkSharePercent:
      userDurationMs > 0 && totalDurationMs > 0
        ? Math.round((userDurationMs / totalDurationMs) * 100)
        : null,
    dominantEmotion: dominantEmotionStats.emotion,
    dominantEmotionPercent: dominantEmotionStats.percent,
  };
}

function getMeetingChangePercent(current: number, previous: number) {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }

  return Math.round(((current - previous) / previous) * 100);
}

function getMeetingDurationMs(meeting: DashboardWorkflowMeeting) {
  if (meeting.durationMs && meeting.durationMs > 0) {
    return meeting.durationMs;
  }

  const segmentDurations = meeting.segments
    ?.map((segment) => segment.endMs ?? 0)
    .filter((endMs) => endMs > 0);

  return segmentDurations?.length ? Math.max(...segmentDurations) : 0;
}

function roundToSingleDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

function getSegmentDurationMs(segment: DashboardWorkflowSegment) {
  if (segment.endMs === null) {
    return 0;
  }

  return Math.max(0, segment.endMs - segment.startMs);
}

function getDominantEmotionStats(
  emotionScores: Record<DashboardMeetingEmotion, number>,
) {
  let dominantEmotion: DashboardMeetingEmotion | null = null;
  let dominantScore = 0;
  let totalScore = 0;

  for (const emotion of ["hard", "chill", "neutral"] as const) {
    totalScore += emotionScores[emotion];

    if (emotionScores[emotion] > dominantScore) {
      dominantEmotion = emotion;
      dominantScore = emotionScores[emotion];
    }
  }

  return {
    emotion: dominantEmotion,
    percent:
      dominantEmotion && totalScore > 0
        ? Math.round((dominantScore / totalScore) * 100)
        : null,
  };
}

function getUserSpeakerAliases(options: DashboardWorkflowSummaryOptions) {
  const aliases = new Set<string>();

  for (const alias of options.userSpeakerAliases ?? []) {
    addSpeakerAlias(aliases, alias);
  }

  addSpeakerAlias(aliases, options.userName);

  if (options.userName) {
    addSpeakerAlias(aliases, options.userName.split(/\s+/)[0]);
  }

  addSpeakerAlias(aliases, options.userEmail);

  if (options.userEmail) {
    const localPart = options.userEmail.split("@")[0];
    addSpeakerAlias(aliases, localPart);
    addSpeakerAlias(aliases, localPart?.replace(/[._-]+/g, " "));
  }

  return aliases;
}

function addSpeakerAlias(aliases: Set<string>, value?: string | null) {
  const alias = normalizeSpeakerLabel(value);

  if (alias) {
    aliases.add(alias);
  }
}

function isMatchingUserSpeaker(
  speaker: string | null,
  userAliases: Set<string>,
) {
  const speakerLabel = normalizeSpeakerLabel(speaker);

  return Boolean(speakerLabel && userAliases.has(speakerLabel));
}

function normalizeSpeakerLabel(value?: string | null) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
}

function countTranscriptWords(text: string) {
  const trimmedText = text.trim();

  if (!trimmedText) {
    return 0;
  }

  if (dashboardWordSegmenter) {
    let wordCount = 0;

    for (const segment of dashboardWordSegmenter.segment(trimmedText)) {
      if (segment.isWordLike) {
        wordCount += 1;
      }
    }

    if (wordCount > 0) {
      return wordCount;
    }
  }

  const latinWordCount =
    trimmedText
      .replace(TRANSCRIPT_CJK_CHARACTER_PATTERN, " ")
      .match(TRANSCRIPT_FALLBACK_WORD_PATTERN)?.length ?? 0;
  const cjkCharacterCount =
    trimmedText.match(TRANSCRIPT_CJK_CHARACTER_PATTERN)?.length ?? 0;

  return latinWordCount + cjkCharacterCount;
}

function createDashboardWordSegmenter() {
  if (typeof Intl.Segmenter !== "function") {
    return null;
  }

  return new Intl.Segmenter(undefined, { granularity: "word" });
}
