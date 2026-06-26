import { z } from "zod";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { transcriptJobs } from "@/db/schema";
import { inngest } from "./client";
import { autoJoinCalendarEvent as autoJoinSyncedCalendarEvent } from "@/lib/calendar-auto-join";
import { createReadUrl } from "@/lib/r2";
import { createElevenLabsTranscriptJob } from "@/lib/vendors/elevenlabs";
import { scheduleRecallBot } from "@/lib/vendors/recall";

const appUrlSchema = z.string().trim().url();

const scheduleMeetingBotDataSchema = z.object({
  meetingUrl: z.string().url(),
  startAt: z.string().datetime().optional(),
});

const calendarEventSyncedDataSchema = z.object({
  connection: z.object({
    id: z.string().uuid(),
    teamId: z.string().uuid(),
    userId: z.string().uuid(),
    autoJoinEnabled: z.boolean(),
  }),
  event: z.object({
    externalEventId: z.string().min(1),
    title: z.string().optional().default(""),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().optional().nullable(),
    attendeeEmails: z.array(z.string()).optional(),
    meetingUrl: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    hangoutLink: z.string().optional().nullable(),
    conferenceData: z
      .object({
        entryPoints: z
          .array(
            z.object({
              entryPointType: z.string().optional().nullable(),
              uri: z.string().optional().nullable(),
            }),
          )
          .optional()
          .nullable(),
      })
      .optional()
      .nullable(),
  }),
});

const transcribeAudioDataSchema = z.union([
  z.object({
    audioUrl: z.string().url(),
    meetingId: z.string().uuid().optional(),
    mediaAssetId: z.string().uuid().optional(),
    transcriptJobId: z.string().uuid().optional(),
  }),
  z.object({
    objectKey: z.string().min(1),
    meetingId: z.string().uuid().optional(),
    mediaAssetId: z.string().uuid().optional(),
    transcriptJobId: z.string().uuid().optional(),
  }),
]);

function getAppUrl() {
  return appUrlSchema.parse(process.env.NEXT_PUBLIC_APP_URL);
}

export const scheduleMeetingBot = inngest.createFunction(
  { id: "schedule-meeting-bot", triggers: [{ event: "meeting/schedule.bot" }] },
  async ({ event }) => {
    const data = scheduleMeetingBotDataSchema.parse(event.data);
    const appUrl = getAppUrl();

    return scheduleRecallBot({
      meetingUrl: data.meetingUrl,
      startAt: data.startAt,
      webhookUrl: `${appUrl}/api/recall/webhook`,
    });
  },
);

export const autoJoinCalendarEvent = inngest.createFunction(
  {
    id: "auto-join-calendar-event",
    triggers: [{ event: "calendar/event.synced" }],
  },
  async ({ event }) => {
    const data = calendarEventSyncedDataSchema.parse(event.data);

    return autoJoinSyncedCalendarEvent(data);
  },
);

export const transcribeAudio = inngest.createFunction(
  { id: "transcribe-audio", triggers: [{ event: "meeting/transcribe.audio" }] },
  async ({ event }) => {
    const data = transcribeAudioDataSchema.parse(event.data);
    const appUrl = getAppUrl();
    const audioUrl =
      "audioUrl" in data ? data.audioUrl : await createReadUrl({ key: data.objectKey });

    const response = await createElevenLabsTranscriptJob({
      audioUrl,
      webhookUrl: `${appUrl}/api/elevenlabs/webhook`,
      metadata: buildTranscriptMetadata(data),
    });

    const providerJobId = getProviderJobId(response);

    if (data.transcriptJobId) {
      await db
        .update(transcriptJobs)
        .set({
          providerJobId,
          status: providerJobId ? "running" : "queued",
          updatedAt: new Date(),
        })
        .where(eq(transcriptJobs.id, data.transcriptJobId));
    }

    return response;
  },
);

export const functions = [
  scheduleMeetingBot,
  autoJoinCalendarEvent,
  transcribeAudio,
];

function buildTranscriptMetadata(data: z.infer<typeof transcribeAudioDataSchema>) {
  const metadata: Record<string, string> = {};

  if ("objectKey" in data) {
    metadata.objectKey = data.objectKey;
  }

  if (data.meetingId) {
    metadata.meetingId = data.meetingId;
  }

  if (data.mediaAssetId) {
    metadata.mediaAssetId = data.mediaAssetId;
  }

  if (data.transcriptJobId) {
    metadata.transcriptJobId = data.transcriptJobId;
  }

  return metadata;
}

function getProviderJobId(response: unknown) {
  if (!response || typeof response !== "object") {
    return null;
  }

  const candidate = response as Record<string, unknown>;

  if (typeof candidate.request_id === "string") {
    return candidate.request_id;
  }

  if (typeof candidate.id === "string") {
    return candidate.id;
  }

  return null;
}
