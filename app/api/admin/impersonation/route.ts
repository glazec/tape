import { cookies } from "next/headers";

import {
  ADMIN_IMPERSONATION_COOKIE,
  getAdminImpersonationCookieOptions,
  isAdminSessionUser,
} from "@/lib/admin-access";
import {
  getAdminImpersonationTarget,
  recordAdminImpersonationAudit,
} from "@/lib/admin-impersonation";
import { getAuthenticatedUser } from "@/lib/auth";
import { redirectSeeOther } from "@/lib/http-responses";
import {
  assertRequestRateLimit,
  requestRateLimitErrorResponse,
  requestRateLimitPolicies,
} from "@/lib/request-rate-limit";

export const runtime = "nodejs";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const admin = await getAuthenticatedUser();

  if (!admin || !(await isAdminSessionUser(admin))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await assertRequestRateLimit({
      ...requestRateLimitPolicies.adminImpersonation,
      subject: admin.id,
    });

    const formData = await request.formData();
    const redirectTo = getSafeRedirectPath(formData.get("redirectTo"));
    const cookieStore = await cookies();

    if (formData.get("action") === "clear") {
      const targetUserId = cookieStore
        .get(ADMIN_IMPERSONATION_COOKIE)
        ?.value?.trim();
      cookieStore.delete(ADMIN_IMPERSONATION_COOKIE);

      if (targetUserId && UUID_PATTERN.test(targetUserId)) {
        await recordAdminImpersonationAudit({
          action: "admin_impersonation_cleared",
          actorAuthUserId: admin.id,
          targetUserId,
        });
      }

      return redirectSeeOther(redirectTo);
    }

    const userId = getFormString(formData.get("userId"));

    if (!userId) {
      return Response.json({ error: "User is required" }, { status: 400 });
    }

    const target = await getAdminImpersonationTarget(userId);

    if (!target) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    await recordAdminImpersonationAudit({
      action: "admin_impersonation_started",
      actorAuthUserId: admin.id,
      targetUserId: target.id,
    });
    cookieStore.set({
      ...getAdminImpersonationCookieOptions(),
      name: ADMIN_IMPERSONATION_COOKIE,
      value: target.id,
    });

    return redirectSeeOther(redirectTo);
  } catch (error) {
    const rateLimitResponse = requestRateLimitErrorResponse(error);

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    throw error;
  }
}

function getFormString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function getSafeRedirectPath(value: FormDataEntryValue | null) {
  const path = getFormString(value);

  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return "/admin";
  }

  return path;
}
