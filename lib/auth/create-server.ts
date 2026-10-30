import { betterAuth, type BetterAuthOptions } from "better-auth";
import { legacySessionPlugin } from "@/lib/auth/legacy-session";

export const WEB_SESSION_SECONDS = 180 * 24 * 60 * 60;

export function createWebAuth(options: {
  database: BetterAuthOptions["database"];
  secret: string;
  baseURL: string;
  googleClientId: string;
  googleClientSecret: string;
  legacyBaseURL?: string;
}) {
  return betterAuth({
    appName: "Tape",
    baseURL: options.baseURL,
    secret: options.secret,
    database: options.database,
    advanced: {
      cookiePrefix: "tape-auth",
      database: { generateId: "uuid" },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: options.baseURL.startsWith("https:"),
      },
    },
    session: {
      expiresIn: WEB_SESSION_SECONDS,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    user: {
      additionalFields: { banned: { type: "boolean", defaultValue: false, input: false } },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session, ctx) => {
            const user = await ctx?.context.internalAdapter.findUserById(session.userId);
            if ((user as { banned?: boolean } | null)?.banned) return false;
          },
        },
      },
    },
    account: { accountLinking: { enabled: false } },
    socialProviders: {
      google: { clientId: options.googleClientId, clientSecret: options.googleClientSecret },
    },
    plugins: options.legacyBaseURL ? [legacySessionPlugin(options.legacyBaseURL, options.baseURL)] : [],
  });
}
