import { createHmac } from "node:crypto";
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

const sessionTokenCookieName = "__Secure-neon-auth.session_token";
const sessionDataCookieName = "__Secure-neon-auth.local.session_data";

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
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  const sessionToken = "tape-e2e-session-token";
  const sessionData = signSessionData(
    {
      session: {
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        id: "tape-e2e-session",
        ipAddress: "127.0.0.1",
        token: sessionToken,
        updatedAt: now.toISOString(),
        userAgent: "Playwright",
        userId: fixture.authUserId,
      },
      user: {
        createdAt: now.toISOString(),
        email: fixture.email,
        emailVerified: true,
        id: fixture.authUserId,
        image: null,
        name: fixture.name,
        updatedAt: now.toISOString(),
      },
    },
    cookieSecret,
    expiresAt,
    fixture.authUserId,
  );
  const baseUrlObject = new URL(baseURL);

  if (baseUrlObject.protocol !== "https:") {
    throw new Error(
      "Authenticated Playwright tests require an HTTPS base URL for Neon Auth cookies",
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
      name: sessionDataCookieName,
      path: "/",
      sameSite: "Lax",
      secure: true,
      value: sessionData,
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

function signSessionData(
  sessionData: Record<string, unknown>,
  secret: string,
  expiresAt: Date,
  authUserId: string,
) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson({
    ...sessionData,
    exp: Math.floor(expiresAt.getTime() / 1000),
    iat: issuedAt,
    sub: authUserId,
  });
  const unsignedToken = `${header}.${payload}`;
  const signature = createHmac("sha256", secret)
    .update(unsignedToken)
    .digest("base64url");

  return `${unsignedToken}.${signature}`;
}

function encodeJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }

  return value;
}
