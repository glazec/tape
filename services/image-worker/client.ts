import { Inngest, type ClientOptions } from "inngest";
import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

const environmentSchema = z.object({
  INNGEST_BASE_URL: optionalSecret,
  INNGEST_EVENT_KEY: optionalSecret,
  INNGEST_SIGNING_KEY: optionalSecret,
  NODE_ENV: z.string().optional(),
});

export function buildImageWorkerClientOptions(
  source: Record<string, string | undefined>,
): ClientOptions {
  const environment = environmentSchema.parse(source);

  if (
    environment.NODE_ENV === "production" &&
    !environment.INNGEST_SIGNING_KEY
  ) {
    throw new Error("INNGEST_SIGNING_KEY is required in production");
  }

  const options: ClientOptions = { id: "meeting-image-worker" };

  if (environment.INNGEST_BASE_URL) {
    options.baseUrl = environment.INNGEST_BASE_URL;
  }

  if (environment.INNGEST_EVENT_KEY) {
    options.eventKey = environment.INNGEST_EVENT_KEY;
  }

  if (environment.INNGEST_SIGNING_KEY) {
    options.signingKey = environment.INNGEST_SIGNING_KEY;
  }

  return options;
}

export const imageWorkerInngest = new Inngest(
  buildImageWorkerClientOptions(process.env),
);
