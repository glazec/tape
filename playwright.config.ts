import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

import {
  authenticatedAdminStorageStatePath,
  authenticatedStorageStatePath,
  isolatedWorkspaceFixture,
} from "./tests/e2e/authenticated-dashboard-fixture";

const port = process.env.PLAYWRIGHT_PORT ?? "3100";
const playwrightServerDirectory =
  process.env.PLAYWRIGHT_SERVER_DIRECTORY ??
  join(tmpdir(), `tape-playwright-server-${process.pid}`);

process.env.PLAYWRIGHT_SERVER_DIRECTORY = playwrightServerDirectory;

const authenticatedE2EEnabled = process.env.PLAYWRIGHT_AUTHENTICATED === "true";
const authenticatedTestTimeout = 60_000;
const defaultProtocol = authenticatedE2EEnabled ? "https" : "http";
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `${defaultProtocol}://127.0.0.1:${port}`;

export default defineConfig({
  globalTeardown: "./tests/e2e/global-teardown.ts",
  testDir: "./tests/e2e",
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command:
          "node --env-file-if-exists=.env.local scripts/start-playwright-server.mjs",
        env: {
          PLAYWRIGHT_SERVER_DIRECTORY: playwrightServerDirectory,
          ...(authenticatedE2EEnabled
            ? { APP_ADMIN_EMAILS: isolatedWorkspaceFixture.email }
            : {}),
        },
        ignoreHTTPSErrors: authenticatedE2EEnabled,
        url: `${baseURL}/privacy`,
        reuseExistingServer: false,
      },
  use: {
    baseURL,
    ignoreHTTPSErrors: authenticatedE2EEnabled,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: [/auth\.setup\.ts/, /authenticated-.*\.spec\.ts/],
      use: { ...devices["Desktop Chrome"] },
    },
    ...(authenticatedE2EEnabled
      ? [
          {
            name: "authenticated-setup",
            testMatch: /auth\.setup\.ts/,
          },
          {
            dependencies: ["authenticated-setup"],
            name: "authenticated-chromium",
            testIgnore: /authenticated-admin\.spec\.ts/,
            testMatch: /authenticated-.*\.spec\.ts/,
            timeout: authenticatedTestTimeout,
            use: {
              ...devices["Desktop Chrome"],
              storageState: authenticatedStorageStatePath,
            },
          },
          {
            dependencies: ["authenticated-setup"],
            name: "authenticated-admin-chromium",
            testMatch: /authenticated-admin\.spec\.ts/,
            timeout: authenticatedTestTimeout,
            use: {
              ...devices["Desktop Chrome"],
              storageState: authenticatedAdminStorageStatePath,
            },
          },
        ]
      : []),
  ],
});
