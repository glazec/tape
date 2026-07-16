const GOOGLE_CALENDAR_EVENT_READ_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.readonly";
const GOOGLE_USERINFO_EMAIL_SCOPE =
  "https://www.googleapis.com/auth/userinfo.email";
const DEFAULT_MAX_SYNC_AGE_MS = 24 * 60 * 60 * 1000;

const allowedGoogleScopes = new Set([
  "openid",
  "email",
  GOOGLE_USERINFO_EMAIL_SCOPE,
  GOOGLE_CALENDAR_EVENT_READ_SCOPE,
]);

export type CalendarConnectionEvidence = {
  targetEmail: string;
  connectionEmail: string;
  autoJoinEnabled: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  hasRecallCalendar: boolean;
  localRecallStatus: string | null;
  lastSyncedAt: string | null;
  storedEventCount: number;
  linkedMeetingCount: number;
  shareRulesMigrationPresent: boolean;
  googleRefreshStatus: number;
  googleTokenInfoStatus: number;
  googleTokenEmail: string | null;
  googleTokenScopes: string[];
  googleCalendarStatus: number;
  googleCalendarResponseValid: boolean;
  recallCalendarStatus: number;
  recallRemoteStatus: string | null;
  recallPlatform: string | null;
  recallEventsStatus: number;
  recallEventCount: number;
};

type CalendarConnectionCheckOptions = {
  now?: Date;
  maxSyncAgeMs?: number;
  minimumEventCount?: number;
};

export function evaluateCalendarConnectionEvidence(
  evidence: CalendarConnectionEvidence,
  options: CalendarConnectionCheckOptions = {},
) {
  const issues: string[] = [];
  const now = options.now ?? new Date();
  const maxSyncAgeMs = options.maxSyncAgeMs ?? DEFAULT_MAX_SYNC_AGE_MS;
  const minimumEventCount = options.minimumEventCount ?? 1;

  if (normalizeEmail(evidence.connectionEmail) !== normalizeEmail(evidence.targetEmail)) {
    issues.push(
      `Connected Google account is ${evidence.connectionEmail}, expected ${evidence.targetEmail}`,
    );
  }

  if (!evidence.autoJoinEnabled) {
    issues.push("Calendar auto join is disabled");
  }
  if (!evidence.hasAccessToken) {
    issues.push("Google access token is missing");
  }
  if (!evidence.hasRefreshToken) {
    issues.push("Google refresh token is missing");
  }
  if (!evidence.hasRecallCalendar) {
    issues.push("Recall calendar id is missing");
  }
  if (evidence.localRecallStatus !== "connected") {
    issues.push(
      `Stored Recall calendar status is ${evidence.localRecallStatus ?? "missing"}`,
    );
  }

  validateSyncRecency(evidence.lastSyncedAt, now, maxSyncAgeMs, issues);

  if (evidence.storedEventCount < minimumEventCount) {
    issues.push("No synced calendar events exist in the database");
  }
  if (evidence.linkedMeetingCount < 0) {
    issues.push("Linked meeting count is invalid");
  }
  if (!evidence.shareRulesMigrationPresent) {
    issues.push("Production meeting share migration is missing");
  }

  if (evidence.googleRefreshStatus !== 200) {
    issues.push(`Google refresh failed with HTTP ${evidence.googleRefreshStatus}`);
  }
  if (evidence.googleTokenInfoStatus !== 200) {
    issues.push(
      `Google token inspection failed with HTTP ${evidence.googleTokenInfoStatus}`,
    );
  }
  if (
    evidence.googleTokenEmail &&
    normalizeEmail(evidence.googleTokenEmail) !== normalizeEmail(evidence.targetEmail)
  ) {
    issues.push(
      `Google token belongs to ${evidence.googleTokenEmail}, expected ${evidence.targetEmail}`,
    );
  }

  validateGoogleScopes(evidence.googleTokenScopes, issues);

  if (evidence.googleCalendarStatus !== 200) {
    issues.push(
      `Google Calendar read failed with HTTP ${evidence.googleCalendarStatus}`,
    );
  }
  if (!evidence.googleCalendarResponseValid) {
    issues.push("Google Calendar returned an invalid events response");
  }

  if (evidence.recallCalendarStatus !== 200) {
    issues.push(
      `Recall calendar lookup failed with HTTP ${evidence.recallCalendarStatus}`,
    );
  }
  if (evidence.recallRemoteStatus !== "connected") {
    issues.push(
      `Recall calendar status is ${evidence.recallRemoteStatus ?? "missing"}`,
    );
  }
  if (evidence.recallPlatform !== "google_calendar") {
    issues.push(
      `Recall calendar platform is ${evidence.recallPlatform ?? "missing"}`,
    );
  }
  if (evidence.recallEventsStatus !== 200) {
    issues.push(
      `Recall event listing failed with HTTP ${evidence.recallEventsStatus}`,
    );
  }
  if (evidence.recallEventCount < minimumEventCount) {
    issues.push("Recall returned no calendar events");
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

function validateSyncRecency(
  lastSyncedAt: string | null,
  now: Date,
  maxSyncAgeMs: number,
  issues: string[],
) {
  if (!lastSyncedAt) {
    issues.push("Calendar has never completed a sync");
    return;
  }

  const lastSyncedTime = new Date(lastSyncedAt).getTime();

  if (!Number.isFinite(lastSyncedTime)) {
    issues.push("Calendar sync timestamp is invalid");
    return;
  }

  if (now.getTime() - lastSyncedTime > maxSyncAgeMs) {
    const maxAgeHours = Math.round(maxSyncAgeMs / (60 * 60 * 1000));
    issues.push(`Calendar sync is older than ${maxAgeHours} hours`);
  }
}

function validateGoogleScopes(scopes: string[], issues: string[]) {
  const scopeSet = new Set(scopes);

  if (!scopeSet.has("openid")) {
    issues.push("Google token is missing the openid scope");
  }
  if (!scopeSet.has("email") && !scopeSet.has(GOOGLE_USERINFO_EMAIL_SCOPE)) {
    issues.push("Google token is missing an email identity scope");
  }
  if (!scopeSet.has(GOOGLE_CALENDAR_EVENT_READ_SCOPE)) {
    issues.push("Google token is missing calendar event read access");
  }

  const unexpectedScopes = [...scopeSet]
    .filter((scope) => !allowedGoogleScopes.has(scope))
    .sort();

  if (unexpectedScopes.length > 0) {
    issues.push(
      `Google token has unexpected scopes: ${unexpectedScopes.join(", ")}`,
    );
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
