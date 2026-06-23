import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
};

export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;

  if (!token) {
    return null;
  }

  const { parseEnv } = await import("@/lib/env");
  const appEnv = parseEnv(process.env);
  const jwks = createRemoteJWKSet(new URL(appEnv.NEON_AUTH_JWKS_URL));
  const { payload } = await jwtVerify(token, jwks, {
    issuer: appEnv.NEON_AUTH_ISSUER,
  });

  if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
    return null;
  }

  return {
    id: payload.sub,
    email: payload.email,
    name: typeof payload.name === "string" ? payload.name : null,
  };
}
