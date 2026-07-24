import { describe, expect, it } from "vitest";

import {
  getDeploymentEnvironmentIssues,
  requiredDeploymentVariables,
} from "@/scripts/check-deployment-env.mjs";

function validEnvironment() {
  return Object.fromEntries(
    requiredDeploymentVariables.map((name) => [name, `${name.toLowerCase()}_value`]),
  ) as Record<string, string>;
}

describe("deployment environment", () => {
  it("reports every missing required value at once", () => {
    expect(getDeploymentEnvironmentIssues({}, { production: true })).toEqual(
      requiredDeploymentVariables.map((name) => `${name} is missing`),
    );
  });

  it("accepts a complete production environment", () => {
    const environment = {
      ...validEnvironment(),
      DATABASE_AUTHENTICATED_URL:
        "postgresql://app:password@db.example.com/tape",
      DATABASE_URL: "postgresql://user:password@db.example.com/tape",
      NEON_AUTH_ISSUER: "https://auth.example.com",
      NEON_AUTH_JWKS_URL: "https://auth.example.com/.well-known/jwks.json",
      NEON_AUTH_COOKIE_SECRET: "a".repeat(32),
      NEXT_PUBLIC_APP_URL: "https://meetings.example.com",
      RECALL_API_BASE_URL: "https://us-east-1.recall.ai",
      RECALL_WEBHOOK_SECRET: "whsec_example",
    };

    expect(
      getDeploymentEnvironmentIssues(environment, { production: true }),
    ).toEqual([]);
  });

  it("rejects insecure production origins and partial OneSignal setup", () => {
    const environment = {
      ...validEnvironment(),
      DATABASE_AUTHENTICATED_URL:
        "postgresql://app:password@db.example.com/tape",
      DATABASE_URL: "postgresql://user:password@db.example.com/tape",
      NEON_AUTH_ISSUER: "https://auth.example.com",
      NEON_AUTH_JWKS_URL: "https://auth.example.com/.well-known/jwks.json",
      NEON_AUTH_COOKIE_SECRET: "a".repeat(32),
      NEXT_PUBLIC_APP_URL: "http://meetings.example.com",
      NEXT_PUBLIC_ONESIGNAL_APP_ID: "app-id",
      RECALL_API_BASE_URL: "https://us-east-1.recall.ai",
      RECALL_WEBHOOK_SECRET: "whsec_example",
    };

    expect(
      getDeploymentEnvironmentIssues(environment, { production: true }),
    ).toEqual([
      "NEXT_PUBLIC_APP_URL must use HTTPS in production",
      "NEXT_PUBLIC_ONESIGNAL_APP_ID and ONESIGNAL_REST_API_KEY must be configured together",
    ]);
  });

  it("rejects an authenticated connection using the owner role", () => {
    const environment = {
      ...validEnvironment(),
      DATABASE_AUTHENTICATED_URL:
        "postgresql://owner:other-password@pooler.example.com/tape",
      DATABASE_URL: "postgresql://owner:password@db.example.com/tape",
      NEON_AUTH_ISSUER: "https://auth.example.com",
      NEON_AUTH_JWKS_URL: "https://auth.example.com/.well-known/jwks.json",
      NEON_AUTH_COOKIE_SECRET: "a".repeat(32),
      NEXT_PUBLIC_APP_URL: "https://meetings.example.com",
      RECALL_API_BASE_URL: "https://us-east-1.recall.ai",
      RECALL_WEBHOOK_SECRET: "whsec_example",
    };

    expect(
      getDeploymentEnvironmentIssues(environment, { production: true }),
    ).toEqual([
      "DATABASE_AUTHENTICATED_URL must use a separate RLS enforced role",
    ]);
  });

  it("rejects malformed database, cookie, app URL, and push origins", () => {
    const environment = {
      ...validEnvironment(),
      DATABASE_AUTHENTICATED_URL: "https://db.example.com/tape",
      DATABASE_URL: "https://db.example.com/tape",
      NEON_AUTH_ISSUER: "https://auth.example.com",
      NEON_AUTH_JWKS_URL: "https://auth.example.com/.well-known/jwks.json",
      NEON_AUTH_COOKIE_SECRET: "short",
      NEXT_PUBLIC_APP_URL: "https://meetings.example.com/app?preview=true",
      NEXT_PUBLIC_ONESIGNAL_ALLOWED_ORIGINS: "not-a-url",
      RECALL_API_BASE_URL: "https://us-east-1.recall.ai",
      RECALL_WEBHOOK_SECRET: "whsec_example",
    };

    expect(
      getDeploymentEnvironmentIssues(environment, { production: true }),
    ).toEqual([
      "NEXT_PUBLIC_APP_URL must be an origin without a path or query",
      "DATABASE_URL must be a PostgreSQL connection URL",
      "DATABASE_AUTHENTICATED_URL must be a PostgreSQL connection URL",
      "NEON_AUTH_COOKIE_SECRET must contain at least 32 characters",
      "NEXT_PUBLIC_ONESIGNAL_ALLOWED_ORIGINS must contain valid HTTP or HTTPS URLs",
    ]);
  });
});
