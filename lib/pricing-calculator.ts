// Duplicated from lib/provider-usage.ts (snapshot 2026-07-23) so this module
// stays import-free of the DB client for the public landing bundle.
const RECALL_RECORDING_USD_MICROS_PER_HOUR = 500_000; // $0.50 / hr
const ELEVENLABS_SCRIBE_USD_MICROS_PER_HOUR = 220_000; // $0.22 / hr

export const CALCULATOR_RATES_SNAPSHOT_DATE = "2026-07-28";

/**
 * Working days per month used to turn a "per day" meeting habit into a
 * monthly meeting-hour total.
 */
export const WORKING_DAYS_PER_MONTH = 21.7;

/** Average calendar weeks per month, derived from a 365.25 day year. */
export const WEEKS_PER_MONTH = 365.25 / 7 / 12;

/** Estimated OpenRouter LLM cost per hour of meeting (summaries + polish). */
export const LLM_USD_MICROS_PER_MEETING_HOUR = 100_000; // $0.10 / hr

/** Fixed monthly hosting estimate (app + workers), not per meeting-hour. */
export const HOSTING_USD_MICROS_PER_MONTH = 5_000_000; // $5 / mo

/**
 * The two capture paths Tape ships. Only these are priced, so the estimate
 * never quotes a provider the code does not integrate.
 */
export const recordingProviders = [
  {
    id: "recall",
    label: "Calendar bot (Recall.ai)",
    rateUsdMicrosPerHour: RECALL_RECORDING_USD_MICROS_PER_HOUR, // $0.50 / hr
    source: "https://www.recall.ai/pricing",
  },
  {
    id: "mac-app",
    label: "Mac app, no bot",
    // Records mic and system audio on the user's Mac; no capture fee.
    rateUsdMicrosPerHour: 0,
    source: "https://github.com/glazec/tape",
  },
] as const;

/** Tape transcribes with ElevenLabs Scribe only. */
export const sttProviders = [
  {
    id: "elevenlabs",
    label: "ElevenLabs Scribe",
    rateUsdMicrosPerHour: ELEVENLABS_SCRIBE_USD_MICROS_PER_HOUR, // $0.22 / hr
    source: "https://elevenlabs.io/pricing/api?price.section=speech_to_text",
  },
] as const;

export const databaseProviders = [
  {
    id: "neon",
    label: "Neon",
    // Usage-based ($0.106/CU-hr + storage, scale-to-zero, no monthly minimum).
    // ~$5/mo estimate for a small always-on workspace.
    monthlyUsdMicros: 5_000_000,
    approximate: true,
    source: "https://neon.com/pricing",
  },
  {
    id: "supabase",
    label: "Supabase Pro",
    monthlyUsdMicros: 25_000_000, // $25 / mo flat
    source: "https://supabase.com/pricing",
  },
  {
    id: "aws-rds",
    label: "AWS RDS Postgres",
    monthlyUsdMicros: 25_000_000, // ~$25 / mo db.t4g.small always-on
    approximate: true,
    source: "https://aws.amazon.com/rds/postgresql/pricing",
  },
] as const;

/** Per-seat SaaS quotes, annual billing, independent of provider choices. */
export const comparisonQuotes = [
  {
    id: "fireflies",
    label: "Fireflies Pro",
    perSeatMonthlyUsdMicros: 10_000_000, // $10 / seat / mo
    source: "https://fireflies.ai/pricing",
  },
  {
    id: "otter",
    label: "Otter Pro",
    perSeatMonthlyUsdMicros: 8_333_333, // $8.33 / seat / mo
    source: "https://otter.ai/pricing",
  },
  {
    id: "granola",
    label: "Granola Business",
    perSeatMonthlyUsdMicros: 14_000_000, // $14 / seat / mo
    source: "https://granola.ai/pricing",
  },
] as const;

export type RecordingProviderId = (typeof recordingProviders)[number]["id"];
export type SttProviderId = (typeof sttProviders)[number]["id"];
export type DatabaseProviderId = (typeof databaseProviders)[number]["id"];

/** The three provider choices that drive every cost line. */
export type ProviderSelection = {
  recordingProviderId: RecordingProviderId;
  sttProviderId: SttProviderId;
  databaseProviderId: DatabaseProviderId;
};

export type CalculatorInput = ProviderSelection & {
  teamSize: number;
  meetingHoursPerPersonPerDay: number;
  /**
   * Average number of your own teammates on a meeting. An internal call is
   * recorded once no matter how many colleagues attend, so this de-duplicates
   * shared meetings: recorded hours = person hours / attendees.
   */
  avgAttendeesPerMeeting: number;
};

export type UsageAssumptions = {
  teamSize: number;
  /** Typical scheduled meeting time for one teammate. */
  meetingHoursPerPersonPerWeek: number;
  /** Tape users on the same call, used to collapse duplicate recordings. */
  avgTapeUsersPerMeeting: number;
  /** Share of scheduled meeting time that Tape will actually record. */
  recordingCoveragePercent: number;
};

export type MonthlyUsageEstimate = {
  teamSize: number;
  personMeetingHoursPerMonth: number;
  recordedMeetingHoursPerMonth: number;
};

/**
 * Cost inputs when the meeting hours are already known — measured from a real
 * calendar rather than derived from the sliders.
 */
export type HoursCostInput = ProviderSelection & {
  teamSize: number;
  /** Meeting time summed across every person (what per-seat tools bill on). */
  personMeetingHoursPerMonth: number;
  /** Distinct meetings recorded once each (what Tape bills on). */
  recordedMeetingHoursPerMonth: number;
};

export type CalculatorBreakdown = {
  /** Sum of meeting time across every person (what per-seat tools bill on). */
  personMeetingHoursPerMonth: number;
  /** Distinct meetings actually recorded and processed (what Tape bills on). */
  recordedMeetingHoursPerMonth: number;
  recordingUsdMicros: number;
  sttUsdMicros: number;
  llmUsdMicros: number;
  databaseUsdMicros: number;
  hostingUsdMicros: number;
  totalUsdMicros: number;
  perPersonUsdMicros: number;
};

function roundUsdMicros(value: number) {
  return Math.max(0, Math.round(value));
}

/**
 * Converts the four visible usage assumptions into the hours that drive cost.
 * Keeping this separate from provider prices makes both manual and calendar
 * estimates use the same model.
 */
export function estimateMonthlyUsage(
  input: UsageAssumptions,
): MonthlyUsageEstimate {
  const teamSize =
    Number.isFinite(input.teamSize) && input.teamSize > 0
      ? Math.round(input.teamSize)
      : 0;
  const meetingHoursPerPersonPerWeek =
    Number.isFinite(input.meetingHoursPerPersonPerWeek) &&
    input.meetingHoursPerPersonPerWeek > 0
      ? input.meetingHoursPerPersonPerWeek
      : 0;
  const recordingCoveragePercent = Number.isFinite(
    input.recordingCoveragePercent,
  )
    ? Math.min(100, Math.max(0, input.recordingCoveragePercent))
    : 0;
  const avgTapeUsersPerMeeting = Number.isFinite(
    input.avgTapeUsersPerMeeting,
  )
    ? Math.min(
        Math.max(1, input.avgTapeUsersPerMeeting),
        Math.max(1, teamSize),
      )
    : 1;
  const personMeetingHoursPerMonth =
    teamSize * meetingHoursPerPersonPerWeek * WEEKS_PER_MONTH;

  return {
    teamSize,
    personMeetingHoursPerMonth,
    recordedMeetingHoursPerMonth:
      (personMeetingHoursPerMonth * (recordingCoveragePercent / 100)) /
      avgTapeUsersPerMeeting,
  };
}

export function personMeetingHours(
  teamSize: number,
  meetingHoursPerPersonPerDay: number,
) {
  if (
    !Number.isFinite(teamSize) ||
    teamSize <= 0 ||
    !Number.isFinite(meetingHoursPerPersonPerDay) ||
    meetingHoursPerPersonPerDay <= 0
  ) {
    return 0;
  }

  return teamSize * meetingHoursPerPersonPerDay * WORKING_DAYS_PER_MONTH;
}

/**
 * Distinct recorded hours after collapsing internal attendees. Each shared
 * meeting is captured once, so we divide person-hours by the average number of
 * teammates per meeting (never more than the team itself).
 */
export function recordedMeetingHours(
  teamSize: number,
  meetingHoursPerPersonPerDay: number,
  avgAttendeesPerMeeting: number,
) {
  const personHours = personMeetingHours(teamSize, meetingHoursPerPersonPerDay);
  if (personHours === 0) {
    return 0;
  }

  const attendees = Math.min(
    Math.max(1, avgAttendeesPerMeeting),
    Math.max(1, teamSize),
  );

  return personHours / attendees;
}

export function computeMonthlyCost(
  input: CalculatorInput,
): CalculatorBreakdown {
  return computeCostFromHours({
    teamSize: input.teamSize,
    personMeetingHoursPerMonth: personMeetingHours(
      input.teamSize,
      input.meetingHoursPerPersonPerDay,
    ),
    // Internal meetings are recorded once, so cost scales with distinct
    // recorded hours, not the sum across every attendee.
    recordedMeetingHoursPerMonth: recordedMeetingHours(
      input.teamSize,
      input.meetingHoursPerPersonPerDay,
      input.avgAttendeesPerMeeting,
    ),
    recordingProviderId: input.recordingProviderId,
    sttProviderId: input.sttProviderId,
    databaseProviderId: input.databaseProviderId,
  });
}

/**
 * Prices a known number of meeting hours. Shared by the slider estimate and
 * the calendar-measured estimate so both bill identically.
 */
export function computeCostFromHours(
  input: HoursCostInput,
): CalculatorBreakdown {
  const personMeetingHoursPerMonth = Math.max(
    0,
    Number.isFinite(input.personMeetingHoursPerMonth)
      ? input.personMeetingHoursPerMonth
      : 0,
  );
  const recordedMeetingHoursPerMonth = Math.max(
    0,
    Number.isFinite(input.recordedMeetingHoursPerMonth)
      ? input.recordedMeetingHoursPerMonth
      : 0,
  );

  const recording =
    recordingProviders.find(
      (provider) => provider.id === input.recordingProviderId,
    ) ?? recordingProviders[0];
  const stt =
    sttProviders.find((provider) => provider.id === input.sttProviderId) ??
    sttProviders[0];
  const database =
    databaseProviders.find(
      (provider) => provider.id === input.databaseProviderId,
    ) ?? databaseProviders[0];

  const recordingUsdMicros = roundUsdMicros(
    recordedMeetingHoursPerMonth * recording.rateUsdMicrosPerHour,
  );
  const sttUsdMicros = roundUsdMicros(
    recordedMeetingHoursPerMonth * stt.rateUsdMicrosPerHour,
  );
  const llmUsdMicros = roundUsdMicros(
    recordedMeetingHoursPerMonth * LLM_USD_MICROS_PER_MEETING_HOUR,
  );
  const databaseUsdMicros = database.monthlyUsdMicros;
  const hostingUsdMicros = HOSTING_USD_MICROS_PER_MONTH;

  const totalUsdMicros =
    recordingUsdMicros +
    sttUsdMicros +
    llmUsdMicros +
    databaseUsdMicros +
    hostingUsdMicros;

  const perPersonUsdMicros =
    input.teamSize > 0 ? Math.round(totalUsdMicros / input.teamSize) : 0;

  return {
    personMeetingHoursPerMonth,
    recordedMeetingHoursPerMonth,
    recordingUsdMicros,
    sttUsdMicros,
    llmUsdMicros,
    databaseUsdMicros,
    hostingUsdMicros,
    totalUsdMicros,
    perPersonUsdMicros,
  };
}

export function comparisonTotalUsdMicros(
  perSeatMonthlyUsdMicros: number,
  teamSize: number,
) {
  if (teamSize <= 0) {
    return 0;
  }

  return Math.round(perSeatMonthlyUsdMicros * teamSize);
}
