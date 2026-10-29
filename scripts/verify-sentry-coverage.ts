// Sends synthetic failures through the real reporting paths. No database calls.
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Sentry } from "@/lib/sentry/server-sdk";
import { emitTelemetryLog, flushTelemetry, registerServerTelemetry } from "@/lib/telemetry/server";

async function main() {
  const runtime = process.argv[2];
  if (runtime !== "server" && runtime !== "worker") {
    throw new Error("Usage: verify-sentry-coverage.ts server|worker");
  }
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    throw new Error("NEXT_PUBLIC_SENTRY_DSN is required");
  }
  process.env.RAILWAY_ENVIRONMENT_NAME = "coverage-verification";
  process.env.SENTRY_ENVIRONMENT = "coverage-verification";
  delete process.env.VERCEL_ENV;
  // Do not send verification traffic to the separate telemetry collector.
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
  if (runtime === "worker") {
    // Worker imports validate this setting, but verification never queries it.
    process.env.DATABASE_URL = "postgresql://verification:verification@127.0.0.1:1/verification";
    await import("@/services/image-worker/server");
  } else {
    await import("../sentry.server.config");
    registerServerTelemetry();
  }
  const run = randomUUID();
  Sentry.setTags({ "verification.id": run, "telemetry.synthetic": true, "verification.runtime": runtime });
  const events: { path: string; eventId: string | undefined }[] = [];
  try {
    throw new Error(`Synthetic ${runtime} handled error`);
  } catch (error) {
    emitTelemetryLog({ eventName: "coverage_verification.handled", severity: "ERROR", error });
    events.push({ path: "handled", eventId: Sentry.lastEventId() });
  }
  console.error("coverage_verification.console", new Error(`Synthetic ${runtime} console error`));
  events.push({ path: "console", eventId: Sentry.lastEventId() });
  emitTelemetryLog({
    eventName: "inngest.function.failure", severity: "ERROR", error: new Error(`Synthetic ${runtime} final job failure`),
    attributes: { "error.handled": false, "telemetry.source": "inngest", "operation.name": "inngest.function.run" },
  });
  events.push({ path: "final_job", eventId: Sentry.lastEventId() });
  await flushTelemetry();
  if (!await Sentry.flush(10_000)) throw new Error("Sentry flush timed out");
  if (events.some(({ eventId }) => !eventId)) throw new Error("Missing event ID");
  const result = { runtime, run, events };
  await writeFile(`/tmp/tape-sentry-${runtime}-verification.json`, JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result) + "\n");
  await Sentry.close(2_000);
  // Imported worker clients can keep timers alive after all events are flushed.
  process.exit(0);
}

main().catch((error: unknown) => {
  process.stderr.write(String(error) + "\n");
  process.exitCode = 1;
});
