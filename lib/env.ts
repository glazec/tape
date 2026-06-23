import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  NEON_AUTH_JWKS_URL: z.string().url(),
  NEON_AUTH_ISSUER: z.string().url(),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  RECALL_API_KEY: z.string().min(1),
  RECALL_WEBHOOK_SECRET: z.string().min(1),
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_WEBHOOK_SECRET: z.string().min(1),
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

export const env = schema.parse(process.env);
