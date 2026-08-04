import { createHash } from "node:crypto";
import { z } from "zod";

import { getAuthenticatedUser } from "@/lib/auth";
import {
  emitTelemetryLog,
  flushTelemetry,
  isServerTelemetryEnabled,
} from "@/lib/telemetry/server";
import {
  createTelemetryErrorContext,
  getTelemetryErrorAttributes,
} from "@/lib/telemetry/error-context";
import {
  sanitizeTelemetryRoute,
  sanitizeTelemetryText,
} from "@/lib/telemetry/sanitize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const clientTelemetryEventSchema = z.object({
  action: z.string().trim().min(1).max(64).optional(),
  destinationRoute: z.string().max(240).optional(),
  durationMs: z.number().finite().nonnegative().max(3_600_000).optional(),
  errorMessage: z.string().max(2_000).optional(),
  errorName: z.string().max(120).optional(),
  errorStack: z.string().max(4_000).optional(),
  navigationType: z.enum(["push", "replace", "traverse"]).optional(),
  occurredAt: z.iso.datetime(),
  route: z.string().max(240),
  sessionId: z.uuid(),
  targetType: z.string().max(64).optional(),
  testSessionId: z.uuid().optional(),
  type: z.enum([
    "client_error",
    "navigation_start",
    "page_load",
    "page_view",
    "unhandled_rejection",
    "user_action",
  ]),
});

const clientTelemetryBatchSchema = z.object({
  events: z.array(clientTelemetryEventSchema).min(1).max(10),
});

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Invalid telemetry origin" }, { status: 403 });
  }

  if (!isServerTelemetryEnabled()) {
    return new Response(null, { status: 204 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");

  if (contentLength > 50_000) {
    return Response.json(
      { error: "Telemetry payload is too large" },
      { status: 413 },
    );
  }

  const parsed = clientTelemetryBatchSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid telemetry payload" },
      { status: 400 },
    );
  }

  const user = await getAuthenticatedUser();
  const anonymousUserId = user
    ? createHash("sha256").update(user.id).digest("hex")
    : undefined;

  for (const event of parsed.data.events) {
    const isError =
      event.type === "client_error" ||
      event.type === "unhandled_rejection";
    const eventName = `frontend.${event.type}`;
    const route = sanitizeTelemetryRoute(event.route);

    emitTelemetryLog({
      attributes: {
        ...(isError
          ? getTelemetryErrorAttributes(
              createTelemetryErrorContext({
                error: event.errorName ?? event.errorMessage,
                errorType: event.errorName,
                eventName,
                handled: false,
                operation: "browser.runtime",
                scope: route,
                source: "browser",
              }),
            )
          : {}),
        "action.name": event.action,
        "action.target_type": event.targetType,
        "enduser.id": anonymousUserId,
        "error.message": event.errorMessage
          ? sanitizeTelemetryText(event.errorMessage)
          : undefined,
        "error.stack": event.errorStack
          ? sanitizeTelemetryText(event.errorStack, 4_000)
          : undefined,
        "error.type": event.errorName,
        "event.name": eventName,
        "navigation.type": event.navigationType,
        "page.destination_route": event.destinationRoute
          ? sanitizeTelemetryRoute(event.destinationRoute)
          : undefined,
        "page.load.duration_ms": event.durationMs,
        "page.route": route,
        "session.id": event.sessionId,
        "telemetry.source": "browser",
        "telemetry.synthetic": event.testSessionId
          ? true
          : undefined,
        "test.session.id": event.testSessionId,
      },
      eventName,
      severity: isError ? "ERROR" : "INFO",
      timestamp: new Date(event.occurredAt),
    });
  }

  await flushTelemetry();
  return new Response(null, { status: 204 });
}

function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");

  if (!origin) {
    return true;
  }

  try {
    const forwardedHost = firstForwardedValue(
      request.headers.get("x-forwarded-host"),
    );
    const forwardedProtocol = firstForwardedValue(
      request.headers.get("x-forwarded-proto"),
    );

    if (
      forwardedHost &&
      (forwardedProtocol === "http" || forwardedProtocol === "https")
    ) {
      return new URL(origin).origin === `${forwardedProtocol}://${forwardedHost}`;
    }

    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function firstForwardedValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim();
}
