import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadDotEnvLocal();

const appId = "meeting-image-worker";
const workerUrl = process.env.IMAGE_WORKER_URL?.trim();
const apiHost = process.env.INNGEST_BASE_URL?.trim();

if (!workerUrl) {
  console.error("IMAGE_WORKER_URL is required");
  process.exit(1);
}

const endpoint = new URL("/api/inngest", workerUrl).toString();

if (apiHost) {
  await syncSelfHostedEndpoint(endpoint);
  process.exit(0);
}

const result = spawnSync(
  "npx",
  ["inngest-cli", "api", "--prod", "sync-app", appId, "--url", endpoint],
  {
    env: normalizedInngestEnv(),
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

function normalizedInngestEnv() {
  return {
    ...process.env,
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY?.trim(),
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY?.trim(),
  };
}

async function syncSelfHostedEndpoint(url) {
  const response = await fetch(url, { method: "PUT" });
  const body = await response.text();

  if (!response.ok) {
    console.error(`Inngest sync failed with ${response.status}: ${body}`);
    process.exit(1);
  }

  console.log(body);
}
