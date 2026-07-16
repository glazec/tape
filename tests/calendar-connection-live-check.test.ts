import { describe, expect, it } from "vitest";

import {
  evaluateCalendarConnectionEvidence,
  type CalendarConnectionEvidence,
} from "@/lib/calendar-connection-live-check";

const now = new Date("2026-07-16T04:00:00.000Z");

function healthyEvidence(): CalendarConnectionEvidence {
  return {
    targetEmail: "calendar-test@example.com",
    connectionEmail: "calendar-test@example.com",
    autoJoinEnabled: true,
    hasAccessToken: true,
    hasRefreshToken: true,
    hasRecallCalendar: true,
    localRecallStatus: "connected",
    lastSyncedAt: "2026-07-16T03:55:00.000Z",
    storedEventCount: 10,
    linkedMeetingCount: 4,
    shareRulesMigrationPresent: true,
    googleRefreshStatus: 200,
    googleTokenInfoStatus: 200,
    googleTokenEmail: "calendar-test@example.com",
    googleTokenScopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/calendar.events.readonly",
    ],
    googleCalendarStatus: 200,
    googleCalendarResponseValid: true,
    recallCalendarStatus: 200,
    recallRemoteStatus: "connected",
    recallPlatform: "google_calendar",
    recallEventsStatus: 200,
    recallEventCount: 10,
  };
}

describe("live calendar connection evidence", () => {
  it("passes only when Google, Recall, the database, and sync state agree", () => {
    expect(
      evaluateCalendarConnectionEvidence(healthyEvidence(), { now }),
    ).toEqual({ ok: true, issues: [] });
  });

  it("fails when the stored connection is incomplete", () => {
    const evidence = healthyEvidence();
    evidence.autoJoinEnabled = false;
    evidence.hasAccessToken = false;
    evidence.hasRefreshToken = false;
    evidence.hasRecallCalendar = false;

    const result = evaluateCalendarConnectionEvidence(evidence, { now });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "Calendar auto join is disabled",
        "Google access token is missing",
        "Google refresh token is missing",
        "Recall calendar id is missing",
      ]),
    );
  });

  it("rejects inherited Google scopes outside the calendar read contract", () => {
    const evidence = healthyEvidence();
    evidence.googleTokenScopes.push(
      "https://www.googleapis.com/auth/gmail.modify",
    );

    const result = evaluateCalendarConnectionEvidence(evidence, { now });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain(
      "Google token has unexpected scopes: https://www.googleapis.com/auth/gmail.modify",
    );
  });

  it("fails when calendar sync evidence is stale or empty", () => {
    const evidence = healthyEvidence();
    evidence.lastSyncedAt = "2026-07-14T03:55:00.000Z";
    evidence.storedEventCount = 0;
    evidence.recallEventCount = 0;

    const result = evaluateCalendarConnectionEvidence(evidence, { now });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "Calendar sync is older than 24 hours",
        "No synced calendar events exist in the database",
        "Recall returned no calendar events",
      ]),
    );
  });

  it("fails when either provider or the production schema is unhealthy", () => {
    const evidence = healthyEvidence();
    evidence.shareRulesMigrationPresent = false;
    evidence.googleRefreshStatus = 401;
    evidence.googleTokenInfoStatus = 400;
    evidence.googleCalendarStatus = 403;
    evidence.recallCalendarStatus = 404;
    evidence.localRecallStatus = "connecting";
    evidence.recallRemoteStatus = "disconnected";
    evidence.recallPlatform = "microsoft_outlook";
    evidence.recallEventsStatus = 500;

    const result = evaluateCalendarConnectionEvidence(evidence, { now });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "Production meeting share migration is missing",
        "Google refresh failed with HTTP 401",
        "Google token inspection failed with HTTP 400",
        "Google Calendar read failed with HTTP 403",
        "Recall calendar lookup failed with HTTP 404",
        "Stored Recall calendar status is connecting",
        "Recall calendar status is disconnected",
        "Recall calendar platform is microsoft_outlook",
        "Recall event listing failed with HTTP 500",
      ]),
    );
  });
});
