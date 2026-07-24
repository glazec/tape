import { cookies } from "next/headers";

import { markDatabaseSessionAdmin } from "@/db/rls-context";
import type { SessionUser } from "@/lib/auth";

export const ADMIN_IMPERSONATION_COOKIE = "meeting_note_impersonated_user_id";
export const DEFAULT_HOSTED_ADMIN_EMAIL = "yiping@iosg.vc";

const ADMIN_IMPERSONATION_MAX_AGE_SECONDS = 60 * 60 * 8;

function getConfiguredAdminEmails(
  source: Record<string, string | undefined> = process.env,
) {
  return (source.APP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function isAdminSessionUser(
  user: SessionUser,
  source: Record<string, string | undefined> = process.env,
) {
  const adminEmails = new Set(getConfiguredAdminEmails(source));
  const normalizedEmail = user.email.trim().toLowerCase();

  if (adminEmails.size > 0) {
    const isAdmin = adminEmails.has(normalizedEmail);

    if (isAdmin) {
      markDatabaseSessionAdmin();
    }

    return isAdmin;
  }

  if (!isSelfHosted(source)) {
    const isAdmin = normalizedEmail === DEFAULT_HOSTED_ADMIN_EMAIL;

    if (isAdmin) {
      markDatabaseSessionAdmin();
    }

    return isAdmin;
  }

  const [{ asc }, { privilegedDb }, { users }] = await Promise.all([
    import("drizzle-orm"),
    import("@/db/client"),
    import("@/db/schema"),
  ]);
  const [firstUser] = await privilegedDb
    .select({ authUserId: users.authUserId })
    .from(users)
    .orderBy(asc(users.createdAt), asc(users.id))
    .limit(1);

  const isAdmin = firstUser?.authUserId === user.id;

  if (isAdmin) {
    markDatabaseSessionAdmin();
  }

  return isAdmin;
}

export async function getAdminImpersonatedUserId() {
  try {
    const cookieStore = await cookies();
    const value = cookieStore.get(ADMIN_IMPERSONATION_COOKIE)?.value?.trim();

    if (!value || !/^[a-zA-Z0-9_-]+$/.test(value)) {
      return null;
    }

    return value;
  } catch {
    return null;
  }
}

export function getAdminImpersonationCookieOptions() {
  return {
    httpOnly: true,
    maxAge: ADMIN_IMPERSONATION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export function buildExpiredAdminImpersonationCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  return `${ADMIN_IMPERSONATION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}; HttpOnly`;
}

function isSelfHosted(source: Record<string, string | undefined>) {
  return ["1", "true", "yes"].includes(
    source.APP_SELF_HOSTED?.trim().toLowerCase() ?? "",
  );
}
