import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadDotEnvLocal();

const appId = "meeting-transcript";
const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

if (!appUrl) {
  console.error("NEXT_PUBLIC_APP_URL is required");
  process.exit(1);
}

const endpoint = new URL("/api/inngest", appUrl).toString();
const result = spawnSync(
  "npx",
  ["inngest-cli", "api", "--prod", "sync-app", appId, "--url", endpoint],
  {
    env: process.env,
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);

function loadDotEnvLocal() {
  const envPath = resolve(".env.local");

  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!key || process.env[key]) {
      continue;
    }

    process.env[key] = stripQuotes(value);
  }
}

function stripQuotes(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
