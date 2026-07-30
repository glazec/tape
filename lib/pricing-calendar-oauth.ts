import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { getNeonAuthCookieSecret } from "@/lib/auth-config";
import { GOOGLE_CALENDAR_EVENT_READ_SCOPE } from "@/lib/google-calendar-constants";
import { parseGoogleCalendarOAuthEnv } from "@/lib/google-calendar-oauth-env";

const GOOGLE_OAUTH_AUTHORIZE_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const encryptedTokenPrefix = "v1";

export const PRICING_CALENDAR_STATE_COOKIE = "tape-pricing-calendar-state";
export const PRICING_CALENDAR_TOKEN_COOKIE = "tape-pricing-calendar-token";

/** The state cookie only matters to the callback, so keep it off page requests. */
export const PRICING_CALENDAR_COOKIE_PATH = "/api/pricing-calendar";

/**
 * The token cookie is read while rendering the landing page itself, so it needs
 * the root path. It stays httpOnly, encrypted, and expires within minutes.
 */
export const PRICING_CALENDAR_TOKEN_COOKIE_PATH = "/";

/** The visitor has a few minutes to land back on the page and read the estimate. */
export const PRICING_CALENDAR_TOKEN_MAX_AGE_SECONDS = 5 * 60;

export const PRICING_CALENDAR_STATE_MAX_AGE_SECONDS = 10 * 60;

export class PricingCalendarOAuthError extends Error {
  constructor(message = "Calendar connection failed") {
    super(message);
    this.name = "PricingCalendarOAuthError";
  }
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getPricingCalendarAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/**
 * Distinct from the signed-in calendar connection callback, so the anonymous
 * estimate flow can never land in the workspace token store.
 */
export function getPricingCalendarRedirectUri() {
  return new URL(
    "/api/pricing-calendar/callback",
    getPricingCalendarAppUrl(),
  ).toString();
}

export function shouldUseSecurePricingCalendarCookie() {
  return new URL(getPricingCalendarAppUrl()).protocol === "https:";
}

export function isPricingCalendarConfigured() {
  try {
    parseGoogleCalendarOAuthEnv(process.env);
    getNeonAuthCookieSecret();

    return true;
  } catch {
    return false;
  }
}

/**
 * Read-only calendar consent for a one-off estimate. `access_type` stays online
 * so Google issues no refresh token: the grant dies with the access token, and
 * this flow never signs the visitor into Tape.
 */
export function buildPricingCalendarOAuthUrl(state: string) {
  const googleEnv = parseGoogleCalendarOAuthEnv(process.env);
  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);

  url.searchParams.set("client_id", googleEnv.GOOGLE_CALENDAR_CLIENT_ID);
  url.searchParams.set("redirect_uri", getPricingCalendarRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    ["openid", "email", GOOGLE_CALENDAR_EVENT_READ_SCOPE].join(" "),
  );
  url.searchParams.set("access_type", "online");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", state);

  return url.toString();
}

export async function exchangePricingCalendarCode(code: string) {
  const googleEnv = parseGoogleCalendarOAuthEnv(process.env);
  const body = new URLSearchParams({
    client_id: googleEnv.GOOGLE_CALENDAR_CLIENT_ID,
    client_secret: googleEnv.GOOGLE_CALENDAR_CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: getPricingCalendarRedirectUri(),
  });
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: unknown;
    expires_in?: unknown;
    error?: unknown;
    error_description?: unknown;
  };

  if (!response.ok || data.error) {
    throw new PricingCalendarOAuthError(
      getString(data.error_description) ??
        getString(data.error) ??
        "Google token request failed",
    );
  }

  const accessToken = getString(data.access_token);
  const expiresIn = getNumber(data.expires_in);

  if (!accessToken || !expiresIn) {
    throw new PricingCalendarOAuthError(
      "Google token response is incomplete",
    );
  }

  return { accessToken, expiresInSeconds: expiresIn };
}

function getTokenEncryptionKey() {
  return createHash("sha256").update(getNeonAuthCookieSecret()).digest();
}

/**
 * The access token only ever travels in an encrypted httpOnly cookie. Nothing
 * about the visitor or their calendar is written to the database.
 */
export function encryptPricingCalendarToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getTokenEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);

  return [
    encryptedTokenPrefix,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptPricingCalendarToken(value: string) {
  const [version, iv, tag, encrypted] = value.split(":");

  if (version !== encryptedTokenPrefix || !iv || !tag || !encrypted) {
    return null;
  }

  try {
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
  } catch {
    // A tampered or stale cookie is treated as "not connected".
    return null;
  }
}
