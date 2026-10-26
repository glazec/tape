import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/lib/auth/server";

const neonAuthProxy = auth.middleware({ loginUrl: "/auth/sign-in" });
const localRecorderDeviceLoginPath = "/api/local-recorder/device-login";
const neonAuthSessionVerifierParam = "neon_auth_session_verifier";

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname === localRecorderDeviceLoginPath &&
    !request.nextUrl.searchParams.has(neonAuthSessionVerifierParam)
  ) {
    return NextResponse.next();
  }

  const response = await neonAuthProxy(request);
  const location = response.headers.get("location");
  if (location) {
    const destination = new URL(location, request.url);
    if (destination.origin === request.nextUrl.origin && destination.pathname === "/auth/sign-in") {
      const callback = request.nextUrl.clone();
      callback.searchParams.delete(neonAuthSessionVerifierParam);
      destination.searchParams.set("callbackUrl", `${callback.pathname}${callback.search}`);
      response.headers.set("location", `${destination.pathname}${destination.search}`);
    }
  }
  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/settings/:path*",
    "/meetings/:path*",
    "/api/local-recorder/device-login",
  ],
};
