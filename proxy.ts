import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/local-recorder/device-login" &&
      !request.cookies.has("__Secure-neon-auth.session_token")) return NextResponse.next();
  // Optimistic routing only. Every page/API still validates the database session.
  if (request.cookies.has("__Secure-tape-auth.session_token") ||
      request.cookies.has("tape-auth.session_token")) return NextResponse.next();

  const callbackUrl = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const destination = new URL(request.cookies.has("__Secure-neon-auth.session_token")
    ? "/api/auth/migrate-session" : "/auth/sign-in", request.url);
  destination.searchParams.set("callbackUrl", callbackUrl);
  return NextResponse.redirect(destination);
}

export const config = {
  matcher: ["/dashboard/:path*", "/settings/:path*", "/meetings/:path*", "/api/local-recorder/device-login"],
};
