import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { buildAppUrl, detectMeetingPlatform } from "@/lib/meeting-links";
import { scheduleRecallBot } from "@/lib/vendors/recall";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    meetingUrl: z.string().url(),
  })
  .strict();

type RecallBotResponse = {
  id?: unknown;
};

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const result = requestSchema.safeParse(body);

  if (!result.success) {
    return Response.json({ error: "Invalid meeting link" }, { status: 400 });
  }

  const platform = detectMeetingPlatform(result.data.meetingUrl);

  if (!platform) {
    return Response.json(
      { error: "Unsupported meeting link" },
      { status: 400 },
    );
  }

  try {
    const bot = (await scheduleRecallBot({
      meetingUrl: result.data.meetingUrl,
      webhookUrl: buildAppUrl("/api/recall/webhook"),
    })) as RecallBotResponse;

    if (typeof bot.id !== "string") {
      throw new Error("Recall bot response missing id");
    }

    return Response.json({
      botId: bot.id,
      meetingUrl: result.data.meetingUrl,
      platform,
      status: "scheduled",
    });
  } catch {
    return Response.json({ error: "Meeting bot unavailable" }, { status: 502 });
  }
}
