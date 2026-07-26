import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const requiredDeploymentVariables = [
  "DATABASE_URL",
  "DATABASE_AUTHENTICATED_URL",
  "NEON_AUTH_JWKS_URL",
  "NEON_AUTH_ISSUER",
  "NEON_AUTH_COOKIE_SECRET",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "RECALL_API_KEY",
  "RECALL_API_BASE_URL",
  "RECALL_WEBHOOK_SECRET",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_WEBHOOK_SECRET",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "NEXT_PUBLIC_APP_URL",
];

export function getDeploymentEnvironmentIssues(
  source,
  { production = source.VERCEL_ENV === "production" } = {},
) {
  const issues = requiredDeploymentVariables
    .filter((name) => !source[name]?.trim())
    .map((name) => `${name} is missing`);

  for (const name of [
    "NEON_AUTH_JWKS_URL",
    "NEON_AUTH_ISSUER",
    "RECALL_API_BASE_URL",
    "NEXT_PUBLIC_APP_URL",
  ]) {
    const value = source[name]?.trim();

    if (value && !parseHttpUrl(value)) {
      issues.push(`${name} must be an absolute HTTP or HTTPS URL`);
    }
  }

  const appUrl = source.NEXT_PUBLIC_APP_URL?.trim();
  const parsedAppUrl = appUrl ? parseHttpUrl(appUrl) : null;

  if (
    production &&
    parsedAppUrl &&
    parsedAppUrl.protocol !== "https:"
  ) {
    issues.push("NEXT_PUBLIC_APP_URL must use HTTPS in production");
  }

  if (
    parsedAppUrl &&
    (parsedAppUrl.pathname !== "/" || parsedAppUrl.search || parsedAppUrl.hash)
  ) {
    issues.push("NEXT_PUBLIC_APP_URL must be an origin without a path or query");
  }

  const databaseUrl = source.DATABASE_URL?.trim();
  const authenticatedDatabaseUrl =
    source.DATABASE_AUTHENTICATED_URL?.trim();

  if (databaseUrl && !isPostgresUrl(databaseUrl)) {
    issues.push("DATABASE_URL must be a PostgreSQL connection URL");
  }

  if (authenticatedDatabaseUrl && !isPostgresUrl(authenticatedDatabaseUrl)) {
    issues.push(
      "DATABASE_AUTHENTICATED_URL must be a PostgreSQL connection URL",
    );
  }

  if (
    databaseUrl &&
    authenticatedDatabaseUrl &&
    isPostgresUrl(databaseUrl) &&
    isPostgresUrl(authenticatedDatabaseUrl) &&
    getDatabaseRole(databaseUrl) === getDatabaseRole(authenticatedDatabaseUrl)
  ) {
    issues.push(
      "DATABASE_AUTHENTICATED_URL must use a separate RLS enforced role",
    );
  }

  const cookieSecret = source.NEON_AUTH_COOKIE_SECRET?.trim();

  if (cookieSecret && cookieSecret.length < 32) {
    issues.push("NEON_AUTH_COOKIE_SECRET must contain at least 32 characters");
  }

  if (
    source.RECALL_WEBHOOK_SECRET?.trim() &&
    !source.RECALL_WEBHOOK_SECRET.trim().startsWith("whsec_")
  ) {
    issues.push("RECALL_WEBHOOK_SECRET must start with whsec_");
  }

  const oneSignalValues = [
    "NEXT_PUBLIC_ONESIGNAL_APP_ID",
    "ONESIGNAL_REST_API_KEY",
  ].filter((name) => source[name]?.trim());

  if (oneSignalValues.length === 1) {
    issues.push(
      "NEXT_PUBLIC_ONESIGNAL_APP_ID and ONESIGNAL_REST_API_KEY must be configured together",
    );
  }

  const allowedOrigins = source.NEXT_PUBLIC_ONESIGNAL_ALLOWED_ORIGINS?.trim();

  if (
    allowedOrigins &&
    allowedOrigins
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .some((origin) => !parseHttpUrl(origin))
  ) {
    issues.push(
      "NEXT_PUBLIC_ONESIGNAL_ALLOWED_ORIGINS must contain valid HTTP or HTTPS URLs",
    );
  }

  for (const name of [
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
  ]) {
    const value = source[name]?.trim();
    const parsedValue = value ? parseHttpUrl(value) : null;

    if (value && !parsedValue) {
      issues.push(`${name} must be an absolute HTTP or HTTPS URL`);
    } else if (
      production &&
      parsedValue &&
      parsedValue.protocol !== "https:"
    ) {
      issues.push(`${name} must use HTTPS in production`);
    }
  }

  return issues;
}

function parseHttpUrl(value) {
  try {
    const url = new URL(value);

    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function isPostgresUrl(value) {
  try {
    return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function getDatabaseRole(value) {
  try {
    return decodeURIComponent(new URL(value).username);
  } catch {
    return "";
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const issues = getDeploymentEnvironmentIssues(process.env);

  if (issues.length > 0) {
    console.error("Deployment configuration is incomplete:\n");
    console.error(issues.map((issue) => `  • ${issue}`).join("\n"));
    console.error(
      "\nCopy .env.example to .env.local and follow docs/setup.md before deploying.",
    );
    process.exit(1);
  }

  console.log("Deployment configuration is ready.");
}
