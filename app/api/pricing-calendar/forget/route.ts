import { NextResponse } from "next/server";

import {
  PRICING_CALENDAR_TOKEN_COOKIE,
  PRICING_CALENDAR_TOKEN_COOKIE_PATH,
  shouldUseSecurePricingCalendarCookie,
} from "@/lib/pricing-calendar-oauth";

export const runtime = "nodejs";

/**
 * Drops the calendar access token as soon as the estimate has been rendered, so
 * the grant does not sit in the browser for the rest of its short lifetime.
 */
export async function POST() {
  const response = NextResponse.json({ forgotten: true });

  response.cookies.set(PRICING_CALENDAR_TOKEN_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: PRICING_CALENDAR_TOKEN_COOKIE_PATH,
    sameSite: "lax",
    secure: shouldUseSecurePricingCalendarCookie(),
  });

  return response;
}
