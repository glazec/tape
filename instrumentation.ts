import type { Instrumentation } from "next";
import * as Sentry from "@sentry/nextjs";

import {
  createTelemetryErrorContext,
  getTelemetryErrorAttributes,
} from "@/lib/telemetry/error-context";
import { sanitizeTelemetryRoute } from "@/lib/telemetry/sanitize";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    const { registerServerTelemetry } = await import(
      "@/lib/telemetry/server"
    );
    registerServerTelemetry({ defaultServiceName: "tape-web" });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  Sentry.captureRequestError(error, request, context);

  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { emitTelemetryLog, flushTelemetry } = await import(
    "@/lib/telemetry/server"
  );
  const route = sanitizeTelemetryRoute(request.path);
  emitTelemetryLog({
    attributes: {
      ...getTelemetryErrorAttributes(
        createTelemetryErrorContext({
          error,
          eventName: "nextjs.request.error",
          handled: false,
          operation: "nextjs.request",
          scope: route,
          source: "nextjs",
        }),
      ),
      "http.request.method": request.method,
      "http.route": context.routePath,
      "next.route_type": context.routeType,
      "next.router_kind": context.routerKind,
      "url.path": route,
    },
    error,
    eventName: "nextjs.request.error",
    severity: "ERROR",
  });
  await flushTelemetry();
};
