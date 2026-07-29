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

/** Estimated OpenRouter LLM cost per hour of meeting (summaries + polish). */
export const LLM_USD_MICROS_PER_MEETING_HOUR = 100_000; // $0.10 / hr

/** Fixed monthly hosting estimate (app + workers), not per meeting-hour. */
export const HOSTING_USD_MICROS_PER_MONTH = 5_000_000; // $5 / mo

export const recordingProviders = [
  {
    id: "attendee",
    label: "Attendee (SaaS)",
    rateUsdMicrosPerHour: 500_000, // $0.50 / hr; 5 hrs free, volume to $0.35
    source: "https://attendee.dev/pricing",
  },
  {
    id: "recall",
    label: "Recall.ai",
    rateUsdMicrosPerHour: RECALL_RECORDING_USD_MICROS_PER_HOUR, // $0.50 / hr
    source: "https://www.recall.ai/pricing",
  },
] as const;

export const sttProviders = [
  {
    id: "elevenlabs",
    label: "ElevenLabs Scribe",
    rateUsdMicrosPerHour: ELEVENLABS_SCRIBE_USD_MICROS_PER_HOUR, // $0.22 / hr
    source: "https://elevenlabs.io/pricing/api?price.section=speech_to_text",
  },
  {
    id: "aws-transcribe",
    label: "AWS Transcribe",
    rateUsdMicrosPerHour: 1_440_000, // $1.44 / hr ($0.024/min tier 1)
    source: "https://aws.amazon.com/transcribe/pricing",
  },
  {
    id: "fish-audio",
    label: "Fish Audio",
    rateUsdMicrosPerHour: 360_000, // $0.36 / hr
    source: "https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits",
  },
  {
    id: "ali-dashscope",
    label: "Ali (Paraformer)",
    rateUsdMicrosPerHour: 300_000, // ~$0.30 / hr, usage-based; per-hour not publicly fixed
    approximate: true,
    source: "https://www.alibabacloud.com/help/en/model-studio/asr-model",
  },
] as const;

export const databaseProviders = [
  {
    id: "neon",
    label: "Neon",
    monthlyUsdMicros: 19_000_000, // ~$19 / mo usage floor
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

export type CalculatorInput = {
  teamSize: number;
  meetingHoursPerPersonPerDay: number;
  recordingProviderId: RecordingProviderId;
  sttProviderId: SttProviderId;
  databaseProviderId: DatabaseProviderId;
};

export type CalculatorBreakdown = {
  meetingHoursPerMonth: number;
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

export function monthlyMeetingHours(
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

export function computeMonthlyCost(input: CalculatorInput): CalculatorBreakdown {
  const meetingHoursPerMonth = monthlyMeetingHours(
    input.teamSize,
    input.meetingHoursPerPersonPerDay,
  );

  const recording = recordingProviders.find(
    (provider) => provider.id === input.recordingProviderId,
  ) ?? recordingProviders[0];
  const stt = sttProviders.find(
    (provider) => provider.id === input.sttProviderId,
  ) ?? sttProviders[0];
  const database = databaseProviders.find(
    (provider) => provider.id === input.databaseProviderId,
  ) ?? databaseProviders[0];

  const recordingUsdMicros = roundUsdMicros(
    meetingHoursPerMonth * recording.rateUsdMicrosPerHour,
  );
  const sttUsdMicros = roundUsdMicros(
    meetingHoursPerMonth * stt.rateUsdMicrosPerHour,
  );
  const llmUsdMicros = roundUsdMicros(
    meetingHoursPerMonth * LLM_USD_MICROS_PER_MEETING_HOUR,
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
    meetingHoursPerMonth,
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
