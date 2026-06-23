import { afterEach, describe, expect, it, vi } from "vitest";

const baseEnv = {
  DATABASE_URL: "https://db.example.com",
  NEON_AUTH_JWKS_URL: "https://auth.example.com/.well-known/jwks.json",
  NEON_AUTH_ISSUER: "https://auth.example.com",
  R2_ACCOUNT_ID: "account-id",
  R2_ACCESS_KEY_ID: "access-key-id",
  R2_SECRET_ACCESS_KEY: "secret-access-key",
  R2_BUCKET: "recordings",
  RECALL_API_KEY: "recall-key",
  RECALL_WEBHOOK_SECRET: "recall-secret",
  ELEVENLABS_API_KEY: "elevenlabs-key",
  ELEVENLABS_WEBHOOK_SECRET: "elevenlabs-secret",
  INNGEST_EVENT_KEY: "inngest-event-key",
  INNGEST_SIGNING_KEY: "inngest-signing-key",
  NEXT_PUBLIC_APP_URL: "https://app.example.com",
};

describe("parseEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("normalizes an empty R2 public base URL to undefined", async () => {
    for (const [key, value] of Object.entries(baseEnv)) {
      vi.stubEnv(key, value);
    }

    const { parseEnv } = await import("@/lib/env");

    expect(
      parseEnv({ ...baseEnv, R2_PUBLIC_BASE_URL: "" }).R2_PUBLIC_BASE_URL,
    ).toBeUndefined();
  });
});
