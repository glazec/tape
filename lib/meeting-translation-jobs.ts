import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { meetings } from "@/db/schema";
import { currentTranscriptJobIdsSubquery } from "@/lib/current-transcript-job";
import {
  normalizeTranslationLanguage,
  type TranslationLanguage,
} from "@/lib/meeting-translation-language";

export async function markMeetingTranslationQueued(
  meetingId: string,
  transcriptJobId?: string,
) {
  await db
    .update(meetings)
    .set({
      translationCompletedAt: null,
      translationErrorMessage: null,
      translationStatus: "queued",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(meetings.id, meetingId),
        translationGenerationCondition(meetingId, transcriptJobId),
      ),
    );
}

export async function getStoredMeetingTranslationLanguage(meetingId: string) {
  const [meeting] = await db
    .select({ translationLanguage: meetings.translationLanguage })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);

  if (!meeting) {
    throw new Error("Meeting not found");
  }

  return normalizeTranslationLanguage(meeting.translationLanguage);
}

export async function markMeetingTranslationRunning(
  meetingId: string,
  translationLanguage: TranslationLanguage,
  transcriptJobId?: string,
) {
  await db
    .update(meetings)
    .set({
      translationCompletedAt: null,
      translationErrorMessage: null,
      translationStartedAt: new Date(),
      translationStatus: "running",
      translationLanguage,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(meetings.id, meetingId),
        translationGenerationCondition(meetingId, transcriptJobId),
      ),
    );
}

export async function markMeetingTranslationCompleted(
  meetingId: string,
  translationLanguage?: TranslationLanguage,
  transcriptJobId?: string,
) {
  await db
    .update(meetings)
    .set({
      translationCompletedAt: new Date(),
      translationErrorMessage: null,
      translationStatus: "completed",
      ...(translationLanguage ? { translationLanguage } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(meetings.id, meetingId),
        translationGenerationCondition(meetingId, transcriptJobId),
      ),
    );
}

export async function markMeetingTranslationFailed(
  meetingId: string,
  error: unknown,
  transcriptJobId?: string,
) {
  await db
    .update(meetings)
    .set({
      translationErrorMessage: getTranslationErrorMessage(error),
      translationStatus: "failed",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(meetings.id, meetingId),
        translationGenerationCondition(meetingId, transcriptJobId),
      ),
    );
}

export async function markMeetingTranslationFailedIfActive(
  meetingId: string,
  error: unknown,
  transcriptJobId?: string,
) {
  await db
    .update(meetings)
    .set({
      translationErrorMessage: getTranslationErrorMessage(error),
      translationStatus: "failed",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(meetings.id, meetingId),
        inArray(meetings.translationStatus, ["queued", "running"]),
        translationGenerationCondition(meetingId, transcriptJobId),
      ),
    );
}

function translationGenerationCondition(
  meetingId: string,
  transcriptJobId?: string,
) {
  return transcriptJobId
    ? sql`${transcriptJobId} in ${currentTranscriptJobIdsSubquery(meetingId)}`
    : undefined;
}

function getTranslationErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.slice(0, 500);
  }

  return "Translation failed";
}
