import {
  createDecipheriv,
  createHash,
} from "node:crypto";

import { neon } from "@neondatabase/serverless";
import { z } from "zod";

import { getNeonAuthCookieSecret } from "@/lib/auth-config";
import {
  evaluateCalendarConnectionEvidence,
  type CalendarConnectionEvidence,
} from "@/lib/calendar-connection-live-check";
import { parseGoogleCalendarOAuthEnv } from "@/lib/google-calendar-oauth-env";

const liveCalendarEnvSchema = z.object({
  CALENDAR_LIVE_TEST_EMAIL: z.email(),
  DATABASE_URL: z.url(),
  RECALL_API_KEY: z.string().trim().min(1),
  RECALL_API_BASE_URL: z.url().optional(),
});

const defaultRecallApiBaseUrl = "https://us-east-1.recall.ai";

async function main() {
  const liveEnv = liveCalendarEnvSchema.parse(process.env);
  const googleEnv = parseGoogleCalendarOAuthEnv(process.env);
  const cookieSecret = getNeonAuthCookieSecret(process.env);
  const sql = neon(liveEnv.DATABASE_URL);
  const [connection] = await sql`
    SELECT
      u.email,
      cc.auto_join_enabled,
      cc.oauth_access_token,
      cc.oauth_refresh_token,
      cc.recall_calendar_id,
      cc.recall_calendar_status,
      cc.recall_calendar_last_synced_at,
      (SELECT count(*)::int FROM calendar_events ce WHERE ce.connection_id = cc.id) AS stored_event_count,
      (SELECT count(*)::int FROM meetings m JOIN calendar_events ce ON ce.id = m.calendar_event_id WHERE ce.connection_id = cc.id) AS linked_meeting_count,
      to_regclass('public.meeting_share_rules')::text AS share_rules_table
    FROM calendar_connections cc
    JOIN users u ON u.id = cc.user_id
    WHERE lower(u.email) = lower(${liveEnv.CALENDAR_LIVE_TEST_EMAIL})
    ORDER BY (cc.recall_calendar_id IS NOT NULL) DESC, cc.updated_at DESC
    LIMIT 1
  `;

  if (!connection) {
    throw new Error(
      `No calendar connection exists for ${liveEnv.CALENDAR_LIVE_TEST_EMAIL}`,
    );
  }

  const accessToken = decryptStoredToken(
    getString(connection.oauth_access_token),
    cookieSecret,
  );
  const refreshToken = decryptStoredToken(
    getString(connection.oauth_refresh_token),
    cookieSecret,
  );
  const recallCalendarId = getString(connection.recall_calendar_id);
  const googleRefresh = await refreshGoogleAccessToken({
    clientId: googleEnv.GOOGLE_CALENDAR_CLIENT_ID,
    clientSecret: googleEnv.GOOGLE_CALENDAR_CLIENT_SECRET,
    refreshToken,
  });
  const googleTokenInfo = await inspectGoogleToken(googleRefresh.accessToken);
  const googleCalendar = await readGoogleCalendar(googleRefresh.accessToken);
  const recallCalendar = await readRecallCalendar({
    apiBaseUrl: liveEnv.RECALL_API_BASE_URL ?? defaultRecallApiBaseUrl,
    apiKey: liveEnv.RECALL_API_KEY,
    calendarId: recallCalendarId,
  });

  const evidence: CalendarConnectionEvidence = {
    targetEmail: liveEnv.CALENDAR_LIVE_TEST_EMAIL,
    connectionEmail: getString(connection.email) ?? "missing",
    autoJoinEnabled: connection.auto_join_enabled === true,
    hasAccessToken: Boolean(accessToken),
    hasRefreshToken: Boolean(refreshToken),
    hasRecallCalendar: Boolean(recallCalendarId),
    localRecallStatus: getString(connection.recall_calendar_status),
    lastSyncedAt: getIsoString(connection.recall_calendar_last_synced_at),
    storedEventCount: getCount(connection.stored_event_count),
    linkedMeetingCount: getCount(connection.linked_meeting_count),
    shareRulesMigrationPresent: Boolean(connection.share_rules_table),
    googleRefreshStatus: googleRefresh.status,
    googleTokenInfoStatus: googleTokenInfo.status,
    googleTokenEmail: googleTokenInfo.email,
    googleTokenScopes: googleTokenInfo.scopes,
    googleCalendarStatus: googleCalendar.status,
    googleCalendarResponseValid: googleCalendar.valid,
    recallCalendarStatus: recallCalendar.calendarStatus,
    recallRemoteStatus: recallCalendar.remoteStatus,
    recallPlatform: recallCalendar.platform,
    recallEventsStatus: recallCalendar.eventsStatus,
    recallEventCount: recallCalendar.eventCount,
  };
  const result = evaluateCalendarConnectionEvidence(evidence);

  if (!result.ok) {
    console.error("Calendar live verification failed:");
    for (const issue of result.issues) {
      console.error(`• ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        email: evidence.connectionEmail,
        googleCalendarRead: true,
        googleScopes: evidence.googleTokenScopes.sort(),
        recallStatus: evidence.recallRemoteStatus,
        recallEventCount: evidence.recallEventCount,
        storedEventCount: evidence.storedEventCount,
        linkedMeetingCount: evidence.linkedMeetingCount,
        lastSyncedAt: evidence.lastSyncedAt,
      },
      null,
      2,
    ),
  );
}

async function refreshGoogleAccessToken(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string | null;
}) {
  if (!input.refreshToken) {
    return { status: 0, accessToken: null };
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await readJsonObject(response);

  return {
    status: response.status,
    accessToken: getString(body?.access_token),
  };
}

async function inspectGoogleToken(accessToken: string | null) {
  if (!accessToken) {
    return { status: 0, email: null, scopes: [] as string[] };
  }

  const url = new URL("https://oauth2.googleapis.com/tokeninfo");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url);
  const body = await readJsonObject(response);

  return {
    status: response.status,
    email: getString(body?.email),
    scopes: getString(body?.scope)?.split(" ").filter(Boolean) ?? [],
  };
}

async function readGoogleCalendar(accessToken: string | null) {
  if (!accessToken) {
    return { status: 0, valid: false };
  }

  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set(
    "timeMin",
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  );
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await readJsonObject(response);

  return {
    status: response.status,
    valid: Array.isArray(body?.items),
  };
}

async function readRecallCalendar(input: {
  apiBaseUrl: string;
  apiKey: string;
  calendarId: string | null;
}) {
  if (!input.calendarId) {
    return {
      calendarStatus: 0,
      remoteStatus: null,
      platform: null,
      eventsStatus: 0,
      eventCount: 0,
    };
  }

  const apiBaseUrl = input.apiBaseUrl.replace(/\/$/, "");
  const headers = { Authorization: `Token ${input.apiKey}` };
  const calendarResponse = await fetch(
    `${apiBaseUrl}/api/v2/calendars/${encodeURIComponent(input.calendarId)}/`,
    { headers },
  );
  const calendarBody = await readJsonObject(calendarResponse);
  const eventsUrl = new URL(`${apiBaseUrl}/api/v2/calendar-events/`);
  eventsUrl.searchParams.set("calendar_id", input.calendarId);
  eventsUrl.searchParams.set(
    "start_time__gte",
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  );
  const eventsResponse = await fetch(eventsUrl, { headers });
  const eventsBody = await readJsonObject(eventsResponse);

  return {
    calendarStatus: calendarResponse.status,
    remoteStatus: getString(calendarBody?.status),
    platform: getString(calendarBody?.platform),
    eventsStatus: eventsResponse.status,
    eventCount: Array.isArray(eventsBody?.results)
      ? eventsBody.results.length
      : 0,
  };
}

function decryptStoredToken(value: string | null, secret: string) {
  if (!value) {
    return null;
  }

  const [version, iv, tag, encrypted] = value.split(":");

  if (version !== "v1" || !iv || !tag || !encrypted) {
    return value;
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    createHash("sha256").update(secret).digest(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function readJsonObject(response: Response) {
  const value = await response.json().catch(() => null);

  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getIsoString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" && Number.isFinite(new Date(value).getTime())) {
    return new Date(value).toISOString();
  }

  return null;
}

function getCount(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

main().catch((error) => {
  if (error instanceof z.ZodError) {
    console.error("Calendar live verification configuration is incomplete:");
    for (const issue of error.issues) {
      console.error(`• ${issue.path.join(".")}: ${issue.message}`);
    }
  } else {
    console.error(
      `Calendar live verification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
  process.exitCode = 1;
});
