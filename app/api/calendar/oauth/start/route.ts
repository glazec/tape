import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import {
  buildGoogleCalendarOAuthUrl,
  GOOGLE_CALENDAR_OAUTH_STATE_COOKIE,
  shouldUseSecureCalendarOAuthCookie,
} from "@/lib/google-calendar-oauth";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.redirect(new URL("/auth/sign-in", getAppUrl()));
  }

  const state = randomBytes(32).toString("base64url");
  const response = NextResponse.redirect(buildGoogleCalendarOAuthUrl(state));

  response.cookies.set(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: 10 * 60,
    path: "/api/calendar/oauth",
    sameSite: "lax",
    secure: shouldUseSecureCalendarOAuthCookie(),
  });

  return response;
}

function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
