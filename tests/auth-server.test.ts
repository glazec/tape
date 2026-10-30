import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createWebAuth, WEB_SESSION_SECONDS } from "@/lib/auth/create-server";
import { webAuthUsers, webAuthAccounts, webAuthSessions, webAuthVerifications } from "@/db/schema";

// Run only against a disposable database. CI supplies PostgreSQL for this suite.
describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("persistent Web authentication", () => {
  const pool = new Pool({ connectionString: process.env.AUTH_TEST_DATABASE_URL });
  const userId = randomUUID();
  const origin = "https://app.example.com";
  let legacyServer: Server;
  let legacyBaseURL: string;
  let revoked = false;
  let legacyExpires = new Date(Date.now() + 86_400_000).toISOString();
  let auth: ReturnType<typeof createWebAuth>;
  const makeAuth = () => createWebAuth({
    database: drizzleAdapter(drizzle(pool), { provider: "pg", schema: {
      user: webAuthUsers, account: webAuthAccounts, session: webAuthSessions, verification: webAuthVerifications,
    } }),
    secret: "test-only-stable-secret-more-than-32-characters",
    baseURL: origin, googleClientId: "test-client", googleClientSecret: "test-secret", legacyBaseURL,
  });
  const request = (path: string, cookie = "", method = "GET", body?: unknown) => auth.handler(new Request(`${origin}/api/auth/${path}`, {
    method, headers: { cookie, origin, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  async function migrate(callback = "/dashboard") {
    revoked = false;
    const response = await request(`migrate-session?callbackUrl=${encodeURIComponent(callback)}`, "__Secure-neon-auth.session_token=legacy");
    const setCookie = response.headers.getSetCookie().find((cookie) => cookie.startsWith("__Secure-tape-auth.session_token="));
    return { response, setCookie, cookie: setCookie?.split(";")[0] ?? "" };
  }
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA neon_auth;
      CREATE TABLE neon_auth."user" (id uuid, name text, email text, "emailVerified" boolean, image text,
        "createdAt" timestamptz, "updatedAt" timestamptz, banned boolean, "banExpires" timestamptz);
      CREATE TABLE neon_auth.account (id uuid, "accountId" text, "providerId" text, "userId" uuid,
        "createdAt" timestamptz, "updatedAt" timestamptz);
    `);
    await pool.query(`INSERT INTO neon_auth."user" VALUES ($1,'Test','auth-test@example.com',true,null,now(),now(),false,null)`, [userId]);
    await pool.query(`INSERT INTO neon_auth.account VALUES ($1,'google-original','google',$2,now(),now())`, [randomUUID(),userId]);
    await pool.query(readFileSync("db/migrations/0063_web_auth_sessions.sql", "utf8"));

    legacyServer = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/sign-out" && req.method === "POST") {
        revoked = true; res.end('{"success":true}'); return;
      }
      res.end(JSON.stringify(revoked || req.headers.cookie !== "__Secure-neon-auth.session_token=legacy" ? null : {
        session: { userId, expiresAt: legacyExpires }, user: { id: userId, email: "auth-test@example.com" },
      }));
    });
    await new Promise<void>((resolve) => legacyServer.listen(0, "127.0.0.1", resolve));
    const address = legacyServer.address();
    if (!address || typeof address === "string") throw new Error("Missing test server port");
    legacyBaseURL = `http://127.0.0.1:${address.port}`;
    auth = makeAuth();
  });
  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    await pool.query("DROP TABLE web_auth_sessions, web_auth_accounts, web_auth_users, web_auth_verifications");
    await pool.query('DROP TABLE neon_auth.account, neon_auth."user"; DROP SCHEMA neon_auth');
    await pool.end();
    await new Promise<void>((resolve) => legacyServer.close(() => resolve()));
  });
  it("imports the original Google association without tokens and keeps auth tables private", async () => {
    const account = (await pool.query("SELECT * FROM web_auth_accounts WHERE account_id = 'google-original'")).rows[0];
    expect(account.user_id).toBe(userId);
    expect(account.access_token).toBeNull();
    const tables = await pool.query("SELECT relrowsecurity FROM pg_class WHERE relname = ANY($1)", [["web_auth_users", "web_auth_accounts", "web_auth_sessions", "web_auth_verifications"]]);
    expect(tables.rows).toHaveLength(4);
    expect(tables.rows.every((row) => row.relrowsecurity)).toBe(true);
  });
  it("migrates the same identity, persists for 180 days across server recreation, and expires", async () => {
    const { response, setCookie, cookie } = await migrate();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/dashboard");
    expect(setCookie).toContain(`Max-Age=${WEB_SESSION_SECONDS}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(response.headers.get("set-cookie")).toContain("__Secure-neon-auth.session_token=; Max-Age=0");
    expect(revoked).toBe(true);
    const before = await (await request("get-session", cookie)).json();
    expect(before.user.id).toBe(userId);
    expect(Math.abs(new Date(before.session.expiresAt).getTime() - new Date(before.session.createdAt).getTime() - WEB_SESSION_SECONDS * 1000)).toBeLessThan(1000);
    auth = makeAuth();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(before.session.createdAt).getTime() + 179 * 86400_000);
    const after = await (await request("get-session", cookie)).json();
    expect(after.session.id).toBe(before.session.id);
    expect(after.session.expiresAt).toBe(before.session.expiresAt);
    vi.setSystemTime(new Date(before.session.createdAt).getTime() + 181 * 86400_000);
    expect(await (await request("get-session", cookie)).json()).toBeNull();
  });
  it("rejects tampering, revokes on sign out, and prevents old credential reuse", async () => {
    const { cookie } = await migrate();
    expect(await (await request("get-session", `${cookie}x`)).json()).toBeNull();
    expect((await request("sign-out", cookie, "POST", {})).status).toBe(200);
    expect(await (await request("get-session", cookie)).json()).toBeNull();
    const replay = await request("migrate-session", "__Secure-neon-auth.session_token=legacy");
    expect(replay.headers.get("location")).toContain("/auth/sign-in");
    expect(replay.headers.get("set-cookie")).toBeNull();
  });
  it("does not migrate expired, malformed, or banned identities", async () => {
    for (const expiry of ["not-a-date", new Date(0).toISOString()]) {
      legacyExpires = expiry;
      expect((await migrate()).cookie).toBe("");
    }
    legacyExpires = new Date(Date.now() + 86400_000).toISOString();
    await pool.query("UPDATE web_auth_users SET banned = true WHERE id = $1", [userId]);
    expect((await migrate()).cookie).toBe("");
    await pool.query("UPDATE web_auth_users SET banned = false WHERE id = $1", [userId]);
  });
  it("keeps redirects local and directs Google back to the app", async () => {
    expect((await migrate("//evil.example")).response.headers.get("location")).toBe("/dashboard");
    const response = await request("sign-in/social", "", "POST", { provider: "google", callbackURL: "/dashboard" });
    const url = new URL((await response.json()).url);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/callback/google`);
    expect(url.searchParams.get("state")).toBeTruthy();
  });
});
