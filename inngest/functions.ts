import { z } from "zod";

import { inngest } from "./client";
import { createElevenLabsTranscriptJob } from "@/lib/vendors/elevenlabs";
import { scheduleRecallBot } from "@/lib/vendors/recall";

const appUrlSchema = z.string().url();

const scheduleMeetingBotDataSchema = z.object({
  meetingUrl: z.string().url(),
  startAt: z.string().datetime().optional(),
});

const transcribeAudioDataSchema = z.object({
  audioUrl: z.string().url(),
});

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

export const transcribeAudio = inngest.createFunction(
  { id: "transcribe-audio", triggers: [{ event: "meeting/transcribe.audio" }] },
  async ({ event }) => {
    const data = transcribeAudioDataSchema.parse(event.data);
    const appUrl = getAppUrl();

    return createElevenLabsTranscriptJob({
      audioUrl: data.audioUrl,
      webhookUrl: `${appUrl}/api/elevenlabs/webhook`,
    });
  },
);

export const functions = [scheduleMeetingBot, transcribeAudio];
