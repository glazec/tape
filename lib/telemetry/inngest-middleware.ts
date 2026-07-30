import { Middleware } from "inngest";

import {
  createTelemetryErrorContext,
  getTelemetryErrorAttributes,
} from "@/lib/telemetry/error-context";
import {
  emitTelemetryLog,
  flushTelemetry,
} from "@/lib/telemetry/server";

export class TapeTelemetryMiddleware extends Middleware.BaseMiddleware {
  readonly id = "tape-telemetry";

  async onRunError({
    ctx,
    error,
    fn,
    isFinalAttempt,
  }: Middleware.OnRunErrorArgs) {
    if (!isFinalAttempt) {
      return;
    }

    const functionId = fn.id();

    emitTelemetryLog({
      attributes: {
        ...getTelemetryErrorAttributes(
          createTelemetryErrorContext({
            error,
            eventName: "inngest.function.failure",
            handled: false,
            operation: "inngest.function.run",
            scope: functionId,
            source: "inngest",
          }),
        ),
        "inngest.attempt": ctx.attempt,
        "inngest.function.id": functionId,
        "inngest.function.name": fn.name,
        "inngest.run.id": ctx.runId,
      },
      error,
      eventName: "inngest.function.failure",
      severity: "ERROR",
    });
    await flushTelemetry();
  }
}
