import { Pool } from "pg";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import {
  test as setup,
  type BrowserContext,
  type TestInfo,
} from "@playwright/test";

import {
  authenticatedAdminStorageStatePath,
  authenticatedDashboardFixture,
  authenticatedStorageStatePath,
  isolatedWorkspaceFixture,
} from "./authenticated-dashboard-fixture";

const sessionTokenCookieName = "__Secure-tape-auth.session_token";

setup("create authenticated dashboard state", async ({ context }, testInfo) => {
  await createAuthenticatedState({
    context,
    fixture: authenticatedDashboardFixture,
    storageStatePath: authenticatedStorageStatePath,
    testInfo,
  });
});

setup("create authenticated admin state", async ({ context }, testInfo) => {
  await createAuthenticatedState({
    context,
    fixture: isolatedWorkspaceFixture,
    storageStatePath: authenticatedAdminStorageStatePath,
    testInfo,
  });
});

async function createAuthenticatedState({
  context,
  fixture,
  storageStatePath,
  testInfo,
}: {
  context: BrowserContext;
  fixture: {
    authUserId: string;
    email: string;
    name: string;
    teamId: string;
    userId: string;
  };
  storageStatePath: string;
  testInfo: TestInfo;
}) {
  const baseURL = requireString(
    testInfo.project.use.baseURL,
    "Playwright baseURL",
  );
  const cookieSecret = requireString(
    process.env.NEON_AUTH_COOKIE_SECRET,
    "NEON_AUTH_COOKIE_SECRET",
  );
  const databaseUrl = requireString(process.env.DATABASE_URL, "DATABASE_URL");
  if (new URL(databaseUrl).pathname !== "/tape_ci") throw new Error("Auth fixtures require tape_ci");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const token = randomUUID();
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`INSERT INTO web_auth_users (id, name, email, email_verified)
      VALUES ($1, $2, $3, true) ON CONFLICT (id) DO NOTHING`, [fixture.authUserId, fixture.name, fixture.email]);
    await pool.query("DELETE FROM web_auth_sessions WHERE user_id = $1", [fixture.authUserId]);
    await pool.query("INSERT INTO web_auth_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [token, fixture.authUserId, expiresAt]);
  } finally {
    await pool.end();
  }
  const sessionToken = encodeURIComponent(`${token}.${createHmac("sha256", cookieSecret).update(token).digest("base64")}`);
  const baseUrlObject = new URL(baseURL);

  if (baseUrlObject.protocol !== "https:") {
    throw new Error(
      "Authenticated Playwright tests require an HTTPS base URL for secure session cookies",
    );
  }

  const domain = baseUrlObject.hostname;
  const expires = Math.floor(expiresAt.getTime() / 1000);

  await context.addCookies([
    {
      domain,
      expires,
      httpOnly: true,
      name: sessionTokenCookieName,
      path: "/",
      sameSite: "Lax",
      secure: true,
      value: sessionToken,
    },
    {
      domain,
      expires,
      httpOnly: true,
      name: `tape_onboarding_hidden_${fixture.userId}_${fixture.teamId}`,
      path: "/",
      sameSite: "Lax",
      secure: true,
      value: "1",
    },
  ]);

  await mkdir(dirname(storageStatePath), { recursive: true });
  await context.storageState({ path: storageStatePath });
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }

  return value;
}
