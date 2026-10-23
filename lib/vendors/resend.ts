import { z } from "zod";

import type { MeetingEmail } from "@/lib/meeting-email";

export async function sendResendEmail(email: MeetingEmail, idempotencyKey: string) {
  const apiKey = z.string().trim().min(1).parse(process.env.RESEND_API_KEY);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(email),
  });
  if (!response.ok) throw new Error(`Resend email failed with ${response.status}`);
  return z.object({ id: z.string().min(1) }).parse(await response.json()).id;
}
