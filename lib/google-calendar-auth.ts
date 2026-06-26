import { GOOGLE_CALENDAR_EVENT_READ_SCOPE } from "@/lib/google-calendar-constants";

export { GOOGLE_CALENDAR_EVENT_READ_SCOPE };

export function buildGoogleSignInOptions() {
  return {
    provider: "google" as const,
    callbackURL: "/dashboard",
    errorCallbackURL: "/auth/sign-in",
  };
}

type ConnectGoogleCalendarResult =
  | { ok: true; url: string }
  | { ok: false; message: string };

export async function connectGoogleCalendar(): Promise<ConnectGoogleCalendarResult> {
  return { ok: true as const, url: "/api/calendar/oauth/start" };
}
