import { type NextRequest, NextResponse } from "next/server";

import {
  encryptPricingCalendarToken,
  exchangePricingCalendarCode,
  getPricingCalendarAppUrl,
  PRICING_CALENDAR_COOKIE_PATH,
  PRICING_CALENDAR_STATE_COOKIE,
  PRICING_CALENDAR_TOKEN_COOKIE,
  PRICING_CALENDAR_TOKEN_COOKIE_PATH,
  PRICING_CALENDAR_TOKEN_MAX_AGE_SECONDS,
  shouldUseSecurePricingCalendarCookie,
} from "@/lib/pricing-calendar-oauth";

export const runtime = "nodejs";

function landingRedirect(status: "connected" | "error" | "denied") {
  const url = new URL("/", getPricingCalendarAppUrl());
  url.search = `?calendar=${status}`;
  url.hash = "pricing";

  return NextResponse.redirect(url);
}

function clearStateCookie(response: NextResponse) {
  response.cookies.set(PRICING_CALENDAR_STATE_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: PRICING_CALENDAR_COOKIE_PATH,
    sameSite: "lax",
    secure: shouldUseSecurePricingCalendarCookie(),
  });

  return response;
}

/**
 * Exchanges the Google code for a short-lived access token and hands it back to
 * the browser as an encrypted httpOnly cookie. No session is created and
 * nothing is persisted, so this cannot sign the visitor into Tape.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const expectedState = request.cookies.get(PRICING_CALENDAR_STATE_COOKIE)
    ?.value;

  if (requestUrl.searchParams.get("error")) {
    return clearStateCookie(landingRedirect("denied"));
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return clearStateCookie(landingRedirect("error"));
  }

  try {
    const token = await exchangePricingCalendarCode(code);
    const response = clearStateCookie(landingRedirect("connected"));

    response.cookies.set(
      PRICING_CALENDAR_TOKEN_COOKIE,
      encryptPricingCalendarToken(token.accessToken),
      {
        httpOnly: true,
        maxAge: Math.min(
          PRICING_CALENDAR_TOKEN_MAX_AGE_SECONDS,
          token.expiresInSeconds,
        ),
        path: PRICING_CALENDAR_TOKEN_COOKIE_PATH,
        sameSite: "lax",
        secure: shouldUseSecurePricingCalendarCookie(),
      },
    );

    return response;
  } catch {
    return clearStateCookie(landingRedirect("error"));
  }
}
