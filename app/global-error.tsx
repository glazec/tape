"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

import { sanitizeTelemetryText } from "@/lib/telemetry/sanitize";

type GlobalErrorValue = Error & { digest?: string };

export function captureGlobalError(error: GlobalErrorValue) {
  const digest = error.digest
    ? sanitizeTelemetryText(error.digest, 128)
    : undefined;

  Sentry.captureException(error, {
    tags: {
      "error.boundary": "global",
      "error.source": "nextjs.global-error",
      ...(digest ? { "nextjs.error_digest": digest } : {}),
    },
  });
}

export default function GlobalError({
  error,
}: {
  error: GlobalErrorValue;
}) {
  useEffect(() => {
    captureGlobalError(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
