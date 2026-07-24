import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SharedOnlyAccessError } from "@/lib/access-errors";
import { getCurrentUser } from "@/lib/auth";
import {
  exchangeGoogleCalendarCode,
  GOOGLE_CALENDAR_OAUTH_SETUP_COOKIE,
  GOOGLE_CALENDAR_OAUTH_STATE_COOKIE,
  storeGoogleCalendarTokens,
} from "@/lib/google-calendar-oauth";
import { syncRecallCalendarEventsForWorkspace } from "@/lib/recall-calendar";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
} from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const error = requestUrl.searchParams.get("error");
  const cookieStore = await cookies();
  const storedState = cookieStore.get(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE)?.value;
  const returnToSetup =
    cookieStore.get(GOOGLE_CALENDAR_OAUTH_SETUP_COOKIE)?.value === "1";

  if (error || !code) {
    return redirectToDashboard("calendarError=google_denied", returnToSetup);
  }

  if (!state || !storedState || state !== storedState) {
    return redirectToDashboard("calendarError=state_mismatch", returnToSetup);
  }

  const user = await getCurrentUser();

  if (!user) {
    return redirectToSignIn();
  }

  try {
    const workspace = await getOrCreateWorkspaceForSessionUser(user);
    await assertCanCreateMeetings(workspace);

    const tokens = await exchangeGoogleCalendarCode(code);

    await storeGoogleCalendarTokens({
      workspace,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshToken: tokens.refreshToken,
    });

    try {
      await syncRecallCalendarEventsForWorkspace({
        workspace,
        autoJoinEnabled: true,
      });
    } catch (syncError) {
      console.error("calendar_oauth_initial_sync_failed", {
        error: serializeError(syncError),
        userId: user.id,
      });

      return redirectToDashboard(
        "calendarError=sync_failed&syncCalendar=1",
        returnToSetup,
      );
    }

    return redirectToDashboard("syncCalendar=1", returnToSetup);
  } catch (error) {
    if (error instanceof SharedOnlyAccessError) {
      return redirectToDashboard();
    }

    console.error("calendar_oauth_callback_failed", {
      error: serializeError(error),
      userId: user.id,
    });

    return redirectToDashboard("calendarError=connect_failed", returnToSetup);
  }
}

function redirectToDashboard(search?: string, returnToSetup = false) {
  const searchParams = new URLSearchParams(search);

  if (returnToSetup) {
    searchParams.set("setup", "1");
  }

  const serializedSearch = searchParams.toString();
  const path = serializedSearch
    ? `/dashboard?${serializedSearch}`
    : "/dashboard";
  const response = NextResponse.redirect(new URL(path, getAppUrl()));

  expireOAuthStateCookie(response);

  return response;
}

function redirectToSignIn() {
  const response = NextResponse.redirect(new URL("/auth/sign-in", getAppUrl()));

  expireOAuthStateCookie(response);

  return response;
}

function expireOAuthStateCookie(response: NextResponse) {
  for (const name of [
    GOOGLE_CALENDAR_OAUTH_STATE_COOKIE,
    GOOGLE_CALENDAR_OAUTH_SETUP_COOKIE,
  ]) {
    response.cookies.set(name, "", {
      maxAge: 0,
      path: "/api/calendar/oauth",
    });
  }
}

function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

function serializeError(error: unknown) {
  return error instanceof Error
    ? { message: error.message, name: error.name }
    : { message: "Unknown error", name: "UnknownError" };
}
