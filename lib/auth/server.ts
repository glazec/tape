import { createNeonAuth } from "@neondatabase/auth/next/server";

import { getNeonAuthBaseUrl, getNeonAuthCookieSecret } from "@/lib/auth-config";

export const auth = createNeonAuth({
  baseUrl: getNeonAuthBaseUrl(),
  cookies: {
    secret: getNeonAuthCookieSecret(),
    sameSite: "lax",
  },
  logLevel: "warn",
});
