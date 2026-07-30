import { cookies } from "next/headers";

import {
  fetchGoogleAccountEmail,
  fetchGoogleCalendarEvents,
  GoogleCalendarReadError,
} from "@/lib/google-calendar-events";
import {
  buildCalendarEstimatePayload,
  CALENDAR_LOOKBACK_DAYS,
  type CalendarEstimatePayload,
} from "@/lib/pricing-calendar-estimate";
import {
  decryptPricingCalendarToken,
  PRICING_CALENDAR_TOKEN_COOKIE,
} from "@/lib/pricing-calendar-oauth";

export type PricingCalendarEstimateResult =
  | { status: "ready"; payload: CalendarEstimatePayload }
  | { status: "error"; message: string; retryable?: boolean };

/**
 * Reads the visitor's recent calendar once, while the landing page renders, and
 * returns only aggregates: which same-domain colleagues appear and how long
 * each meeting ran. The access token lives in a short-lived encrypted cookie and
 * nothing here is written to the database.
 */
export async function readPricingCalendarEstimate(): Promise<PricingCalendarEstimateResult> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(PRICING_CALENDAR_TOKEN_COOKIE)?.value;
  const accessToken = cookie ? decryptPricingCalendarToken(cookie) : null;

  if (!accessToken) {
    return {
      status: "error",
      message:
        "That calendar link expired. Connect again to rebuild the estimate.",
    };
  }

  const timeMax = new Date();
  const timeMin = new Date(
    timeMax.getTime() - CALENDAR_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );

  try {
    const [organizerEmail, calendarResult] = await Promise.all([
      fetchGoogleAccountEmail(accessToken),
      fetchGoogleCalendarEvents({ accessToken, timeMin, timeMax }),
    ]);

    const lookbackDays = calendarResult.truncated
      ? (calendarResult.eventDateSpanDays ?? 1)
      : CALENDAR_LOOKBACK_DAYS;

    return {
      status: "ready",
      payload: buildCalendarEstimatePayload({
        organizerEmail,
        rawEvents: calendarResult.events,
        lookbackDays,
        eventLimitReached: calendarResult.truncated,
      }),
    };
  } catch (error) {
    if (error instanceof GoogleCalendarReadError) {
      return {
        status: "error",
        message:
          error.status === 401 || error.status === 403
            ? "Google declined the calendar read. Connect again to retry."
            : "Could not read the calendar just now. Try again in a moment.",
      };
    }

    return {
      status: "error",
      message: "Could not build the estimate from that calendar.",
    };
  }
}
