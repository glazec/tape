import { Inngest, type ClientOptions } from "inngest";
import { z } from "zod";

import { TapeTelemetryMiddleware } from "@/lib/telemetry/inngest-middleware";

const optionalSecret = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

const inngestEnvSchema = z.object({
  INNGEST_BASE_URL: optionalSecret,
  INNGEST_EVENT_KEY: optionalSecret,
  INNGEST_SIGNING_KEY: optionalSecret,
});

export function buildInngestClientOptions(
  source: Record<string, string | undefined>,
): ClientOptions {
  const env = inngestEnvSchema.parse(source);
  const options: ClientOptions = {
    id: "meeting-transcript",
    middleware: [TapeTelemetryMiddleware],
  };

  if (env.INNGEST_BASE_URL) {
    options.baseUrl = env.INNGEST_BASE_URL;
  }

  if (env.INNGEST_EVENT_KEY) {
    options.eventKey = env.INNGEST_EVENT_KEY;
  }

  if (env.INNGEST_SIGNING_KEY) {
    options.signingKey = env.INNGEST_SIGNING_KEY;
  }

  return options;
}

export const inngest = new Inngest(buildInngestClientOptions(process.env));
