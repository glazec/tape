import { normalizeElevenLabsWebhook } from "@/lib/vendors/elevenlabs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (body === null) {
    return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  try {
    const event = normalizeElevenLabsWebhook(body);

    return Response.json({ received: true, event });
  } catch {
    return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
  }
}
