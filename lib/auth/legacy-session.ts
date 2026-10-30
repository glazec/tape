import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

import { getNeonAuthCookieNames } from "@/lib/neon-auth-cookies";

export function legacySessionPlugin(baseUrl: string, appUrl: string) {
  return {
    id: "legacy-neon-session",
    endpoints: {
      migrateLegacySession: createAuthEndpoint("/migrate-session", {
        method: "GET",
        query: z.object({ callbackUrl: z.string().optional() }),
      }, async (ctx) => {
        const callback = ctx.query.callbackUrl;
        const destination = callback?.startsWith("/") && !callback.startsWith("//") && !callback.includes("\\")
          ? callback : "/dashboard";
        const login = `/auth/sign-in?callbackUrl=${encodeURIComponent(destination)}`;
        const cookies = ctx.headers?.get("cookie") ?? "";
        const token = cookies.split(";").map((part) => part.trim())
          .find((part) => part.startsWith("__Secure-neon-auth.session_token="));
        if (!token) throw ctx.redirect(login);

        // Never trust the old browser cache or an email supplied by the client.
        const response = await fetch(`${baseUrl}/get-session?disableCookieCache=true`, {
          headers: { cookie: token }, cache: "no-store", signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw ctx.redirect(login);
        const parsed = z.object({
          session: z.object({ userId: z.string().uuid(), expiresAt: z.iso.datetime({ offset: true }) }),
          user: z.object({ id: z.string().uuid(), email: z.string().email() }),
        }).safeParse(await response.json());
        if (!parsed.success) throw ctx.redirect(login);
        const legacy = parsed.data;
        if (legacy.session.userId !== legacy.user.id ||
            new Date(legacy.session.expiresAt).getTime() <= Date.now()) throw ctx.redirect(login);
        const user = await ctx.context.internalAdapter.findUserById(legacy.user.id);
        if (!user || (user as { banned?: boolean }).banned || user.email !== legacy.user.email) throw ctx.redirect(login);

        // Consume the old credential so signing out of Tape cannot resurrect it.
        const revoked = await fetch(`${baseUrl}/sign-out`, {
          method: "POST", headers: { cookie: token, origin: appUrl, "content-type": "application/json" },
          body: "{}", signal: AbortSignal.timeout(8000),
        });
        if (!revoked.ok) throw ctx.redirect(login);
        const session = await ctx.context.internalAdapter.createSession(user.id);
        if (!session) throw ctx.error("INTERNAL_SERVER_ERROR", { message: "Could not migrate session" });
        await setSessionCookie(ctx, { session, user });
        for (const name of getNeonAuthCookieNames(cookies)) {
          ctx.setCookie(name, "", { path: "/", maxAge: 0, httpOnly: true, secure: true, sameSite: "lax" });
        }
        throw ctx.redirect(destination);
      }),
    },
  };
}
