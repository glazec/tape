import type { Instrumentation } from "next";

import { sanitizeTelemetryRoute } from "@/lib/telemetry/sanitize";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { registerServerTelemetry } = await import(
    "@/lib/telemetry/server"
  );
  registerServerTelemetry({ defaultServiceName: "tape-web" });
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { emitTelemetryLog, flushTelemetry } = await import(
    "@/lib/telemetry/server"
  );
  emitTelemetryLog({
    attributes: {
      "http.request.method": request.method,
      "http.route": context.routePath,
      "next.route_type": context.routeType,
      "next.router_kind": context.routerKind,
      "url.path": sanitizeTelemetryRoute(request.path),
    },
    error,
    eventName: "nextjs.request.error",
    severity: "ERROR",
  });
  await flushTelemetry();
};
