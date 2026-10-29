import * as Sentry from "@sentry/node";

import { getSentryInitOptions } from "@/lib/sentry/config";

Sentry.init({
  ...getSentryInitOptions({
    development: process.env.NODE_ENV === "development",
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV,
  }),
  // The worker's existing OpenTelemetry provider owns tracing.
  skipOpenTelemetrySetup: true,
  tracesSampleRate: 0,
});
