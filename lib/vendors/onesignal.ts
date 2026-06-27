import { z } from "zod";

const oneSignalEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z
    .string()
    .trim()
    .url()
    .default("https://meeting-note-swart.vercel.app"),
  NEXT_PUBLIC_ONESIGNAL_APP_ID: z.string().trim().min(1),
  ONESIGNAL_REST_API_KEY: z.string().trim().min(1),
});

export async function sendOneSignalLocationReminder(input: {
  externalUserId: string;
  meetingId: string;
  meetingTitle: string;
  location: string;
}) {
  const env = oneSignalEnvSchema.parse(process.env);
  const body = {
    app_id: env.NEXT_PUBLIC_ONESIGNAL_APP_ID,
    target_channel: "push",
    include_aliases: {
      external_id: [input.externalUserId],
    },
    headings: { en: "Meeting starts soon" },
    contents: { en: `${input.meetingTitle} at ${input.location}` },
    url: `${env.NEXT_PUBLIC_APP_URL}/meetings/${input.meetingId}`,
  };
  const response = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      Authorization: `Key ${env.ONESIGNAL_REST_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `OneSignal notification failed with ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}
