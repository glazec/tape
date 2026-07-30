import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import {
  buildPricingCalendarOAuthUrl,
  getPricingCalendarAppUrl,
  isPricingCalendarConfigured,
  PRICING_CALENDAR_COOKIE_PATH,
  PRICING_CALENDAR_STATE_COOKIE,
  PRICING_CALENDAR_STATE_MAX_AGE_SECONDS,
  shouldUseSecurePricingCalendarCookie,
} from "@/lib/pricing-calendar-oauth";

export const runtime = "nodejs";

/**
 * Public on purpose: a visitor estimates their cost before they have an
 * account, so this route never requires or creates a Tape session.
 */
export async function GET() {
  const landingUrl = new URL("/", getPricingCalendarAppUrl());

  if (!isPricingCalendarConfigured()) {
    landingUrl.search = "?calendar=unavailable";
    landingUrl.hash = "pricing";

    return NextResponse.redirect(landingUrl);
  }

  const state = randomBytes(32).toString("base64url");
  const response = NextResponse.redirect(buildPricingCalendarOAuthUrl(state));

  response.cookies.set(PRICING_CALENDAR_STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: PRICING_CALENDAR_STATE_MAX_AGE_SECONDS,
    path: PRICING_CALENDAR_COOKIE_PATH,
    sameSite: "lax",
    secure: shouldUseSecurePricingCalendarCookie(),
  });

  return response;
}
