import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { calendarConnections } from "@/db/schema";
import { inngest } from "@/inngest/client";
import type { SessionUser } from "@/lib/auth";
import { auth } from "@/lib/auth/server";
import type { SyncedCalendarEvent } from "@/lib/calendar-auto-join";
import {
  ensureGoogleCalendarRecallCalendar,
  getStoredGoogleCalendarAccessToken,
} from "@/lib/google-calendar-oauth";
import type { WorkspaceContext } from "@/lib/workspace";

const GOOGLE_CALENDAR_EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const DEFAULT_SYNC_WINDOW_DAYS = 14;

type GoogleCalendarSyncInput = {
  sessionUser: SessionUser;
  workspace: WorkspaceContext;
  autoJoinEnabled: boolean;
  now?: Date;
};

type GoogleCalendarApiEvent = {
  id?: unknown;
  summary?: unknown;
  description?: unknown;
  location?: unknown;
  hangoutLink?: unknown;
  start?: {
    dateTime?: unknown;
    date?: unknown;
  };
  end?: {
    dateTime?: unknown;
    date?: unknown;
  };
  attendees?: Array<{
    email?: unknown;
  }>;
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType?: unknown;
      uri?: unknown;
    }>;
  };
};

type GoogleCalendarApiResponse = {
  items?: GoogleCalendarApiEvent[];
};

export class GoogleCalendarAccessTokenError extends Error {
  constructor() {
    super("Google Calendar access token unavailable");
  }
}

export class GoogleCalendarFetchError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string) {
    super(`Google Calendar fetch failed with ${status} ${statusText}`);
    this.status = status;
  }
}

export async function getGoogleCalendarAccessToken(workspace?: WorkspaceContext) {
  if (workspace) {
    const storedAccessToken = await getStoredGoogleCalendarAccessToken(workspace);

    if (storedAccessToken) {
      return storedAccessToken;
    }
  }

  const { data, error } = await auth.getAccessToken({
    providerId: "google",
  });

  if (error || !data?.accessToken) {
    throw new GoogleCalendarAccessTokenError();
  }

  return data.accessToken;
}

export async function fetchGoogleCalendarEvents(input: {
  accessToken: string;
  now?: Date;
}) {
  const response = await fetch(buildGoogleCalendarEventsUrl(input.now), {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new GoogleCalendarFetchError(response.status, response.statusText);
  }

  const data = (await response.json()) as GoogleCalendarApiResponse;

  return (data.items ?? []).map(normalizeGoogleCalendarEvent).filter(Boolean);
}

export async function syncGooglePrimaryCalendarEvents(
  input: GoogleCalendarSyncInput,
) {
  const accessToken = await getGoogleCalendarAccessToken(input.workspace);
  await ensureGoogleCalendarRecallCalendar(input.workspace);
  const connection = await getOrCreateGoogleCalendarConnection({
    workspace: input.workspace,
    autoJoinEnabled: input.autoJoinEnabled,
  });
  const events = await fetchGoogleCalendarEvents({
    accessToken,
    now: input.now,
  });

  if (events.length > 0) {
    await inngest.send(
      events.map((event) => ({
        name: "calendar/event.synced",
        data: {
          connection: {
            id: connection.id,
            teamId: input.workspace.teamId,
            userId: input.workspace.userId,
            autoJoinEnabled: input.autoJoinEnabled,
          },
          event,
        },
      })),
    );
  }

  return {
    connectionId: connection.id,
    syncedEventCount: events.length,
  };
}

function buildGoogleCalendarEventsUrl(now = new Date()) {
  const timeMin = now.toISOString();
  const timeMax = new Date(
    now.getTime() + DEFAULT_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const url = new URL(GOOGLE_CALENDAR_EVENTS_URL);

  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set(
    "fields",
    [
      "items(id,summary,description,location,hangoutLink,start,end,attendees(email),conferenceData(entryPoints(entryPointType,uri)))",
    ].join(","),
  );

  return url.toString();
}

async function getOrCreateGoogleCalendarConnection(input: {
  workspace: WorkspaceContext;
  autoJoinEnabled: boolean;
}) {
  const existing = await db
    .select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.teamId, input.workspace.teamId),
        eq(calendarConnections.userId, input.workspace.userId),
        eq(calendarConnections.provider, "google"),
        eq(calendarConnections.externalCalendarId, "primary"),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(calendarConnections)
      .set({
        autoJoinEnabled: input.autoJoinEnabled,
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, existing[0].id));

    return existing[0];
  }

  const [connection] = await db
    .insert(calendarConnections)
    .values({
      teamId: input.workspace.teamId,
      userId: input.workspace.userId,
      provider: "google",
      externalCalendarId: "primary",
      autoJoinEnabled: input.autoJoinEnabled,
    })
    .returning({ id: calendarConnections.id });

  return connection;
}

function normalizeGoogleCalendarEvent(
  event: GoogleCalendarApiEvent,
): SyncedCalendarEvent | null {
  const externalEventId = getString(event.id);
  const startsAt = getString(event.start?.dateTime) ?? getString(event.start?.date);

  if (!externalEventId || !startsAt) {
    return null;
  }

  return {
    externalEventId,
    title: getString(event.summary) ?? "Untitled calendar event",
    startsAt,
    endsAt: getString(event.end?.dateTime) ?? getString(event.end?.date) ?? null,
    attendeeEmails: (event.attendees ?? [])
      .map((attendee) => getString(attendee.email))
      .filter((email): email is string => Boolean(email)),
    meetingUrl: null,
    location: getString(event.location),
    description: getString(event.description),
    hangoutLink: getString(event.hangoutLink),
    conferenceData: event.conferenceData
      ? {
          entryPoints: (event.conferenceData.entryPoints ?? []).map(
            (entryPoint) => ({
              entryPointType: getString(entryPoint.entryPointType),
              uri: getString(entryPoint.uri),
            }),
          ),
        }
      : null,
  };
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
