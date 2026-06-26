import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";
import {
  exchangeGoogleCalendarCode,
  GOOGLE_CALENDAR_OAUTH_STATE_COOKIE,
  storeGoogleCalendarTokens,
} from "@/lib/google-calendar-oauth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const error = requestUrl.searchParams.get("error");
  const cookieStore = await cookies();
  const storedState = cookieStore.get(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE)?.value;

  if (error || !code) {
    return redirectToDashboard("calendarError=google_denied");
  }

  if (!state || !storedState || state !== storedState) {
    return redirectToDashboard("calendarError=state_mismatch");
  }

  const user = await getCurrentUser();

  if (!user) {
    return redirectToSignIn();
  }

  try {
    const workspace = await getOrCreateWorkspaceForSessionUser(user);
    const tokens = await exchangeGoogleCalendarCode(code);

    await storeGoogleCalendarTokens({
      workspace,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshToken: tokens.refreshToken,
    });

    return redirectToDashboard("syncCalendar=1");
  } catch {
    return redirectToDashboard("calendarError=connect_failed");
  }
}

function redirectToDashboard(search: string) {
  const response = NextResponse.redirect(
    new URL(`/dashboard?${search}`, getAppUrl()),
  );

  expireOAuthStateCookie(response);

  return response;
}

function redirectToSignIn() {
  const response = NextResponse.redirect(new URL("/auth/sign-in", getAppUrl()));

  expireOAuthStateCookie(response);

  return response;
}

function expireOAuthStateCookie(response: NextResponse) {
  response.cookies.set(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE, "", {
    maxAge: 0,
    path: "/api/calendar/oauth",
  });
}

function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
