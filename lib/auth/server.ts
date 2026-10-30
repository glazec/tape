import { headers } from "next/headers";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getNeonAuthBaseUrl, getNeonAuthCookieSecret } from "@/lib/auth-config";
import { createWebAuth } from "@/lib/auth/create-server";
import { webAuthUsers, webAuthAccounts, webAuthSessions, webAuthVerifications } from "@/db/schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const database = drizzleAdapter(drizzle(pool), { provider: "pg", schema: {
  user: webAuthUsers, account: webAuthAccounts, session: webAuthSessions, verification: webAuthVerifications,
} });
const server = createWebAuth({
  database,
  // Reuse the existing durable deployment secret; never generate one at startup.
  secret: getNeonAuthCookieSecret(),
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  googleClientId: process.env.WEB_AUTH_GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.WEB_AUTH_GOOGLE_CLIENT_SECRET || "",
  legacyBaseURL: process.env.NEON_AUTH_BASE_URL || process.env.NEON_AUTH_JWKS_URL ? getNeonAuthBaseUrl() : undefined,
});

export const auth = Object.assign(server, {
  getSession: async () => ({ data: await server.api.getSession({ headers: await headers() }) }),
});
