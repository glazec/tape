import * as Sentry from "@sentry/nextjs";

import { getSentryInitOptions } from "@/lib/sentry/config";

Sentry.init(
  getSentryInitOptions({
    development: process.env.NODE_ENV === "development",
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  }),
);
