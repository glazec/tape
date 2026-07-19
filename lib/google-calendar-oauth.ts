import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { calendarConnections } from "@/db/schema";
import { getNeonAuthCookieSecret } from "@/lib/auth-config";
import { GOOGLE_CALENDAR_EVENT_READ_SCOPE } from "@/lib/google-calendar-constants";
import { parseGoogleCalendarOAuthEnv } from "@/lib/google-calendar-oauth-env";
import {
  createRecallCalendar,
  deleteRecallCalendar,
  updateRecallCalendar,
} from "@/lib/vendors/recall";
import type { WorkspaceContext } from "@/lib/workspace";

const GOOGLE_OAUTH_AUTHORIZE_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const encryptedTokenPrefix = "v1";

export const GOOGLE_CALENDAR_OAUTH_STATE_COOKIE =
  "google-calendar-oauth-state";

type GoogleTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
};

class GoogleCalendarOAuthError extends Error {
  constructor(message = "Calendar connection failed") {
    super(message);
  }
}

function getGoogleCalendarOAuthRedirectUri() {
  return new URL(
    "/api/calendar/oauth/callback",
    getAppUrl(),
  ).toString();
}

export function shouldUseSecureCalendarOAuthCookie() {
  return new URL(getAppUrl()).protocol === "https:";
}

export function buildGoogleCalendarOAuthUrl(state: string) {
  const googleEnv = parseGoogleCalendarOAuthEnv(process.env);
  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);

  url.searchParams.set("client_id", googleEnv.GOOGLE_CALENDAR_CLIENT_ID);
  url.searchParams.set("redirect_uri", getGoogleCalendarOAuthRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    ["openid", "email", GOOGLE_CALENDAR_EVENT_READ_SCOPE].join(" "),
  );
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", state);

  return url.toString();
}

export async function exchangeGoogleCalendarCode(code: string) {
  return requestGoogleToken({
    code,
    grant_type: "authorization_code",
    redirect_uri: getGoogleCalendarOAuthRedirectUri(),
  });
}

export async function storeGoogleCalendarTokens(input: {
  workspace: WorkspaceContext;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string | null;
}) {
  const existing = await findGoogleCalendarConnection(input.workspace);
  const encryptedAccessToken = encryptToken(input.accessToken);
  const encryptedRefreshToken = input.refreshToken
    ? encryptToken(input.refreshToken)
    : existing?.oauthRefreshToken;

  if (!encryptedRefreshToken) {
    throw new GoogleCalendarOAuthError("Google did not return a refresh token");
  }

  const recallCalendar = await ensureRecallCalendar({
    workspace: input.workspace,
    existing,
    refreshToken:
      input.refreshToken ??
      (existing?.oauthRefreshToken
        ? decryptToken(existing.oauthRefreshToken)
        : null),
  });

  if (existing) {
    await db
      .update(calendarConnections)
      .set({
        autoJoinEnabled: true,
        oauthAccessToken: encryptedAccessToken,
        oauthRefreshToken: encryptedRefreshToken,
        oauthAccessTokenExpiresAt: input.accessTokenExpiresAt,
        recallCalendarId: recallCalendar.id ?? existing.recallCalendarId,
        recallCalendarStatus:
          recallCalendar.status ?? existing.recallCalendarStatus,
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, existing.id));

    return existing.id;
  }

  const [connection] = await db
    .insert(calendarConnections)
    .values({
      teamId: input.workspace.teamId,
      userId: input.workspace.userId,
      provider: "google",
      externalCalendarId: "primary",
      autoJoinEnabled: true,
      oauthAccessToken: encryptedAccessToken,
      oauthRefreshToken: encryptedRefreshToken,
      oauthAccessTokenExpiresAt: input.accessTokenExpiresAt,
      recallCalendarId: recallCalendar.id,
      recallCalendarStatus: recallCalendar.status,
    })
    .returning({ id: calendarConnections.id });

  return connection.id;
}

export async function disconnectGoogleCalendarForWorkspace(
  workspace: WorkspaceContext,
) {
  const existing = await findGoogleCalendarConnection(workspace);

  if (!existing) {
    return false;
  }

  if (existing.recallCalendarId) {
    await deleteRecallCalendar({ calendarId: existing.recallCalendarId });
  }

  await db
    .update(calendarConnections)
    .set({
      autoJoinEnabled: false,
      oauthAccessToken: null,
      oauthRefreshToken: null,
      oauthAccessTokenExpiresAt: null,
      recallCalendarId: null,
      recallCalendarStatus: null,
      recallCalendarLastSyncedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(calendarConnections.id, existing.id));

  return true;
}

async function ensureRecallCalendar(input: {
  workspace: WorkspaceContext;
  existing: Awaited<ReturnType<typeof findGoogleCalendarConnection>>;
  refreshToken: string | null;
}) {
  if (!input.refreshToken) {
    return {
      id: input.existing?.recallCalendarId ?? null,
      status: input.existing?.recallCalendarStatus ?? null,
    };
  }

  const googleEnv = parseGoogleCalendarOAuthEnv(process.env);
  const metadata = {
    teamId: input.workspace.teamId,
    userId: input.workspace.userId,
  };

  if (input.existing?.recallCalendarId) {
    const calendar = await updateRecallCalendar({
      calendarId: input.existing.recallCalendarId,
      oauthRefreshToken: input.refreshToken,
      metadata,
    });

    return {
      id:
        getString((calendar as { id?: unknown }).id) ??
        input.existing.recallCalendarId,
      status:
        getString((calendar as { status?: unknown }).status) ??
        input.existing.recallCalendarStatus,
    };
  }

  const calendar = await createRecallCalendar({
    oauthClientId: googleEnv.GOOGLE_CALENDAR_CLIENT_ID,
    oauthClientSecret: googleEnv.GOOGLE_CALENDAR_CLIENT_SECRET,
    oauthRefreshToken: input.refreshToken,
    platform: "google_calendar",
    metadata,
  });

  return {
    id: getString((calendar as { id?: unknown }).id),
    status: getString((calendar as { status?: unknown }).status),
  };
}

async function requestGoogleToken(params: Record<string, string>) {
  const googleEnv = parseGoogleCalendarOAuthEnv(process.env);
  const body = new URLSearchParams({
    client_id: googleEnv.GOOGLE_CALENDAR_CLIENT_ID,
    client_secret: googleEnv.GOOGLE_CALENDAR_CLIENT_SECRET,
    ...params,
  });
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });
  const data = (await response.json().catch(() => ({}))) as GoogleTokenResponse;

  if (!response.ok || data.error) {
    throw new GoogleCalendarOAuthError(
      getString(data.error_description) ??
        getString(data.error) ??
        "Google token request failed",
    );
  }

  const accessToken = getString(data.access_token);
  const expiresIn = getNumber(data.expires_in);

  if (!accessToken || !expiresIn) {
    throw new GoogleCalendarOAuthError("Google token response is incomplete");
  }

  return {
    accessToken,
    refreshToken: getString(data.refresh_token),
    accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

async function findGoogleCalendarConnection(workspace: WorkspaceContext) {
  const [connection] = await db
    .select({
      id: calendarConnections.id,
      oauthRefreshToken: calendarConnections.oauthRefreshToken,
      recallCalendarId: calendarConnections.recallCalendarId,
      recallCalendarStatus: calendarConnections.recallCalendarStatus,
    })
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.teamId, workspace.teamId),
        eq(calendarConnections.userId, workspace.userId),
        eq(calendarConnections.provider, "google"),
        eq(calendarConnections.externalCalendarId, "primary"),
      ),
    )
    .limit(1);

  return connection ?? null;
}

function encryptToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getTokenEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    encryptedTokenPrefix,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

function decryptToken(value: string) {
  const [version, iv, tag, encrypted] = value.split(":");

  if (version !== encryptedTokenPrefix || !iv || !tag || !encrypted) {
    return value;
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getTokenEncryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function getTokenEncryptionKey() {
  return createHash("sha256").update(getNeonAuthCookieSecret()).digest();
}

function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
