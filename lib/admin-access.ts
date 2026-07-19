import { cookies } from "next/headers";

import type { SessionUser } from "@/lib/auth";

export const ADMIN_IMPERSONATION_COOKIE = "meeting_note_impersonated_user_id";

const ADMIN_IMPERSONATION_MAX_AGE_SECONDS = 60 * 60 * 8;

function getConfiguredAdminEmails(
  source: Record<string, string | undefined> = process.env,
) {
  return (source.APP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminSessionUser(
  user: SessionUser,
  source: Record<string, string | undefined> = process.env,
) {
  const adminEmails = new Set(getConfiguredAdminEmails(source));

  return adminEmails.has(user.email.trim().toLowerCase());
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
