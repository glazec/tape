import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  getSentryInitOptions,
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryLog,
  sanitizeSentryUrl,
  sentryDataCollection,
} from "@/lib/sentry/config";

describe("Sentry configuration", () => {
  it("enables logs and samples production traces", () => {
    expect(
      getSentryInitOptions({
        development: false,
        dsn: "https://public@example.ingest.sentry.io/1",
        environment: "production",
      }),
    ).toMatchObject({
      enabled: true,
      enableLogs: true,
      environment: "production",
      sampleRate: 1,
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
    });
  });

  it("stays disabled without a DSN", () => {
    expect(
      getSentryInitOptions({ development: false, environment: "production" }),
    ).toMatchObject({ enabled: false });
  });

  it("disables collection of meeting content and personal data", () => {
    expect(sentryDataCollection).toEqual({
      cookies: false,
      databaseQueryData: false,
      frameContextLines: 0,
      genAI: { inputs: false, outputs: false },
      graphQL: { document: false, variables: false },
      httpBodies: [],
      httpHeaders: { request: false, response: false },
      stackFrameVariables: false,
      urlQueryParams: false,
      userInfo: false,
    });
  });

  it("drops console and interaction breadcrumbs", () => {
    expect(
      sanitizeSentryBreadcrumb({
        category: "console",
        message: "private meeting words",
      }),
    ).toBeNull();
    expect(
      sanitizeSentryBreadcrumb({
        category: "ui.click",
        message: "Private meeting title",
      }),
    ).toBeNull();
  });

  it("sanitizes request metadata and removes user supplied context", () => {
    const event = sanitizeSentryEvent({
      exception: { values: [{ value: "failed for alice@example.com" }] },
      extra: { transcript: "private meeting words" },
      request: {
        cookies: { session: "secret" },
        data: "private request body",
        headers: { authorization: "Bearer secret" },
        method: "POST",
        query_string: "token=secret",
        url: "https://tape.example.com/meetings/11111111-1111-4111-8111-111111111111?token=secret",
      },
      type: undefined,
      user: { email: "alice@example.com" },
    } satisfies ErrorEvent);

    expect(event).toMatchObject({
      exception: { values: [{ value: "failed for [redacted-email]" }] },
      request: {
        method: "POST",
        url: "https://tape.example.com/meetings/:id",
      },
    });
    expect(event.extra).toBeUndefined();
    expect(event.user).toBeUndefined();
    expect(event.request).not.toHaveProperty("headers");
    expect(event.request).not.toHaveProperty("data");
    expect(event.request).not.toHaveProperty("query_string");
  });

  it("sanitizes log messages and attributes", () => {
    expect(
      sanitizeSentryLog({
        attributes: {
          authorization: "Bearer secret",
          route: "/meetings/11111111-1111-4111-8111-111111111111",
        },
        level: "info",
        message: "request failed for alice@example.com",
      }),
    ).toMatchObject({
      attributes: {
        authorization: "[redacted]",
        route: "/meetings/11111111-1111-4111-8111-111111111111",
      },
      message: "request failed for [redacted-email]",
    });
  });

  it("removes identifiers, query strings, and fragments from URLs", () => {
    expect(
      sanitizeSentryUrl(
        "https://tape.example.com/meetings/11111111-1111-4111-8111-111111111111?signature=secret#notes",
      ),
    ).toBe("https://tape.example.com/meetings/:id");
  });
});
