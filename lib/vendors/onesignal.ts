import { z } from "zod";

const oneSignalEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z
    .string()
    .trim()
    .url(),
  NEXT_PUBLIC_ONESIGNAL_APP_ID: z.string().trim().min(1),
  ONESIGNAL_REST_API_KEY: z.string().trim().min(1),
});

type OneSignalNotificationResponse = {
  id?: unknown;
  errors?: unknown;
};

export async function sendOneSignalLocationReminder(input: {
  idempotencyKey: string;
  externalUserId: string;
  meetingId: string;
  meetingTitle: string;
  location: string;
}) {
  const env = oneSignalEnvSchema.parse(process.env);
  const body = {
    app_id: env.NEXT_PUBLIC_ONESIGNAL_APP_ID,
    target_channel: "push",
    isIos: true,
    isAndroid: true,
    isAnyWeb: true,
    idempotency_key: input.idempotencyKey,
    include_aliases: {
      external_id: [input.externalUserId],
    },
    headings: { en: "Meeting starts soon" },
    contents: { en: `${input.meetingTitle} at ${input.location}` },
    url: `${env.NEXT_PUBLIC_APP_URL}/meetings/${input.meetingId}/record`,
  };
  const response = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      Authorization: `Key ${env.ONESIGNAL_REST_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json().catch(() => null)) as
    | OneSignalNotificationResponse
    | null;

  if (!response.ok) {
    throw new Error(
      `OneSignal notification failed with ${response.status} ${response.statusText}`,
    );
  }

  if (data?.errors) {
    throw new Error(
      `OneSignal notification failed: ${formatOneSignalErrors(data.errors)}`,
    );
  }

  if (typeof data?.id !== "string" || data.id.trim() === "") {
    throw new Error("OneSignal notification failed: missing notification id");
  }

  return data;
}

function formatOneSignalErrors(errors: unknown) {
  if (!errors || typeof errors !== "object") {
    return String(errors);
  }

  return Object.entries(errors)
    .flatMap(([key, value]) =>
      value && typeof value === "object"
        ? Object.keys(value).map((nestedKey) => `${key}.${nestedKey}`)
        : [key],
    )
    .join(", ");
}
