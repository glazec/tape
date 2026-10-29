import { handleRecallCalendarWebhook } from "@/lib/recall-calendar-webhook-handler";

export const runtime = "nodejs";
export const POST = handleRecallCalendarWebhook;
