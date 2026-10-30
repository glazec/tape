import { auth } from "@/lib/auth/server";
import {
  buildExpiredAdminImpersonationCookie,
} from "@/lib/admin-access";
import {
  buildExpiredNeonAuthCookie,
  getNeonAuthCookieNames,
} from "@/lib/neon-auth-cookies";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return new Response(null, { status: 403 });
  }
  const response = await auth.api.signOut({ headers: request.headers, asResponse: true });
  if (!response.ok) return response;
  const headers = new Headers(response.headers);

  for (const cookieName of getNeonAuthCookieNames(
    request.headers.get("cookie"),
  )) {
    headers.append("set-cookie", buildExpiredNeonAuthCookie(cookieName));
  }
  headers.append("set-cookie", buildExpiredAdminImpersonationCookie());

  return new Response(null, { status: 204, headers });
}
