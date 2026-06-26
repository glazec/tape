import { z } from "zod";

const requiredString = z.string().trim().min(1);
const requiredUrl = z.string().trim().url();

const optionalUrl = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().url().optional(),
);

const schema = z.object({
  DATABASE_URL: requiredUrl,
  NEON_AUTH_JWKS_URL: requiredUrl,
  NEON_AUTH_ISSUER: requiredUrl,
  R2_ACCOUNT_ID: requiredString,
  R2_ACCESS_KEY_ID: requiredString,
  R2_SECRET_ACCESS_KEY: requiredString,
  R2_BUCKET: requiredString,
  R2_PUBLIC_BASE_URL: optionalUrl,
  RECALL_API_KEY: requiredString,
  RECALL_API_BASE_URL: optionalUrl,
  RECALL_WEBHOOK_SECRET: z.string().trim().regex(/^whsec_/, {
    message: "Recall webhook secret must start with whsec_",
  }),
  ELEVENLABS_API_KEY: requiredString,
  ELEVENLABS_WEBHOOK_SECRET: requiredString,
  GOOGLE_CALENDAR_CLIENT_ID: requiredString,
  GOOGLE_CALENDAR_CLIENT_SECRET: requiredString,
  INNGEST_EVENT_KEY: requiredString,
  INNGEST_SIGNING_KEY: requiredString,
  NEXT_PUBLIC_APP_URL: requiredUrl,
});

export function parseEnv(source: Record<string, string | undefined>) {
  return schema.parse(source);
}

export const env = parseEnv(process.env);
