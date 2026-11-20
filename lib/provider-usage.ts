import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import {
  meetings,
  providerUsageEvents,
  recordings,
  transcriptJobs,
} from "@/db/schema";
import {
  ELEVENLABS_BATCH_MODEL,
  ELEVENLABS_KEYTERM_PROMPTING_USD_MICROS_PER_HOUR,
  ELEVENLABS_PRICING_SNAPSHOT_DATE,
  ELEVENLABS_SCRIBE_USD_MICROS_PER_HOUR,
  type ElevenLabsBatchModel,
} from "@/lib/elevenlabs-model";

export const PROVIDER_PRICING_SNAPSHOT_DATE = "2026-07-23";
export const RECALL_RECORDING_USD_MICROS_PER_HOUR = 500_000;
// Preserve the prior estimate for callbacks from jobs submitted before the model upgrade.
const LEGACY_ELEVENLABS_RATE_WITH_ENTITY_DETECTION = 290_000;

export const providerPricingSources = {
  recall: "https://www.recall.ai/pricing",
  elevenlabs: "https://elevenlabs.io/pricing/api?price.section=speech_to_text",
  openrouter:
    "https://openrouter.ai/docs/cookbook/administration/usage-accounting",
} as const;

export type ProviderUsageCategory =
  | "assistant"
  | "recording"
  | "transcription"
  | "transcript_polish"
  | "translation";

type OpenRouterUsage = {
  completionTokens?: number;
  costUsd?: number;
  promptTokens?: number;
  totalTokens?: number;
};

export function prorateHourlyCostUsdMicros(
  durationMs: number,
  rateUsdMicrosPerHour: number,
) {
  if (
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    !Number.isFinite(rateUsdMicrosPerHour) ||
    rateUsdMicrosPerHour < 0
  ) {
    return 0;
  }

  return Math.round((durationMs / 3_600_000) * rateUsdMicrosPerHour);
}

export function getElevenLabsRateUsdMicrosPerHour(
  keytermsUsed: boolean,
  model: ElevenLabsBatchModel = ELEVENLABS_BATCH_MODEL,
) {
  return (
    (model === "scribe_v2"
      ? LEGACY_ELEVENLABS_RATE_WITH_ENTITY_DETECTION
      : ELEVENLABS_SCRIBE_USD_MICROS_PER_HOUR) +
    (keytermsUsed ? ELEVENLABS_KEYTERM_PROMPTING_USD_MICROS_PER_HOUR : 0)
  );
}

export function dollarsToUsdMicros(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.round(value * 1_000_000);
}

export async function recordRecallRecordingUsage(input: {
  durationMs?: number | null;
  meetingId: string;
  recordingId: string;
}) {
  const durationMs = input.durationMs ?? 0;
  const costUsdMicros = prorateHourlyCostUsdMicros(
    durationMs,
    RECALL_RECORDING_USD_MICROS_PER_HOUR,
  );

  if (costUsdMicros === 0) {
    return;
  }

  await recordMeetingProviderUsage({
    category: "recording",
    costSource: "published_rate",
    costUsdMicros,
    idempotencyKey: `recall:recording:${input.recordingId}`,
    meetingId: input.meetingId,
    metadata: {
      pricingDate: PROVIDER_PRICING_SNAPSHOT_DATE,
      rateUsdMicrosPerHour: RECALL_RECORDING_USD_MICROS_PER_HOUR,
      sourceUrl: providerPricingSources.recall,
    },
    operation: "meeting_recording",
    provider: "recall",
    quantity: Math.round(durationMs),
    unit: "milliseconds",
  });
}

export async function recordElevenLabsTranscriptUsage(input: {
  fallbackDurationMs?: number;
  keytermsUsed?: boolean;
  model?: ElevenLabsBatchModel;
  transcriptJobId: string;
}) {
  const [job] = await db
    .select({
      billingKeytermsUsed: transcriptJobs.billingKeytermsUsed,
      durationMs: recordings.durationMs,
      meetingId: transcriptJobs.meetingId,
      providerJobId: transcriptJobs.providerJobId,
    })
    .from(transcriptJobs)
    .leftJoin(recordings, eq(recordings.id, transcriptJobs.recordingId))
    .where(eq(transcriptJobs.id, input.transcriptJobId))
    .limit(1);
  const durationMs = job?.durationMs ?? input.fallbackDurationMs ?? 0;
  const model = input.model ?? "scribe_v2";
  const keytermsUsed = input.keytermsUsed ?? job?.billingKeytermsUsed ?? false;
  const rateUsdMicrosPerHour = getElevenLabsRateUsdMicrosPerHour(keytermsUsed, model);
  const costUsdMicros = prorateHourlyCostUsdMicros(
    durationMs,
    rateUsdMicrosPerHour,
  );

  if (!job || !job.providerJobId || costUsdMicros === 0) {
    return;
  }

  await recordMeetingProviderUsage({
    category: "transcription",
    costSource: "published_rate",
    costUsdMicros,
    idempotencyKey: `elevenlabs:transcription:${input.transcriptJobId}`,
    meetingId: job.meetingId,
    metadata: {
      entityDetection: true,
      keytermsUsed,
      pricingDate: model === "scribe_v2"
        ? PROVIDER_PRICING_SNAPSHOT_DATE
        : ELEVENLABS_PRICING_SNAPSHOT_DATE,
      providerJobId: job.providerJobId,
      rateUsdMicrosPerHour,
      sourceUrl: providerPricingSources.elevenlabs,
    },
    model,
    operation: "speech_to_text",
    provider: "elevenlabs",
    quantity: Math.round(durationMs),
    unit: "milliseconds",
  });
}

export async function recordOpenRouterCompletionUsage(input: {
  category: Extract<
    ProviderUsageCategory,
    "assistant" | "transcript_polish" | "translation"
  >;
  operation?: "chat_completion" | "decisions";
  generationId?: string | null;
  meetingId?: string | null;
  metadata?: Record<string, unknown>;
  model?: string | null;
  usage?: OpenRouterUsage | null;
}) {
  const generationId = input.generationId?.trim();
  const meetingId = input.meetingId?.trim();
  const costUsdMicros = dollarsToUsdMicros(input.usage?.costUsd ?? 0);

  if (!generationId || !meetingId || costUsdMicros === 0) {
    return;
  }

  await recordMeetingProviderUsage({
    category: input.category,
    costSource: "provider_reported",
    costUsdMicros,
    idempotencyKey: `openrouter:generation:${generationId}`,
    meetingId,
    metadata: {
      ...input.metadata,
      completionTokens: input.usage?.completionTokens ?? null,
      pricingDate: PROVIDER_PRICING_SNAPSHOT_DATE,
      promptTokens: input.usage?.promptTokens ?? null,
      sourceUrl: providerPricingSources.openrouter,
    },
    model: input.model ?? undefined,
    operation: input.operation ?? "chat_completion",
    provider: "openrouter",
    quantity: Math.max(0, Math.round(input.usage?.totalTokens ?? 0)),
    unit: "tokens",
  });
}

async function recordMeetingProviderUsage(input: {
  category: ProviderUsageCategory;
  costSource: "provider_reported" | "published_rate";
  costUsdMicros: number;
  idempotencyKey: string;
  meetingId: string;
  metadata: Record<string, unknown>;
  model?: string;
  operation: string;
  provider: string;
  quantity: number;
  unit: string;
}) {
  const [meeting] = await db
    .select({
      teamId: meetings.teamId,
      title: meetings.title,
      userId: meetings.ownerUserId,
    })
    .from(meetings)
    .where(eq(meetings.id, input.meetingId))
    .limit(1);

  if (!meeting) {
    return;
  }

  await db
    .insert(providerUsageEvents)
    .values({
      category: input.category,
      costSource: input.costSource,
      costUsdMicros: input.costUsdMicros,
      idempotencyKey: input.idempotencyKey,
      meetingId: input.meetingId,
      metadata: {
        ...input.metadata,
        meetingTitle: meeting.title,
      },
      model: input.model,
      operation: input.operation,
      provider: input.provider,
      quantity: input.quantity,
      teamId: meeting.teamId,
      unit: input.unit,
      userId: meeting.userId,
    })
    .onConflictDoNothing({
      target: providerUsageEvents.idempotencyKey,
    });
}
