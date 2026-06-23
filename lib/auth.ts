import { auth } from "@/lib/auth/server";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
};

export function sessionUserFromAuthUser(user: unknown): SessionUser | null {
  if (!user || typeof user !== "object") {
    return null;
  }

  const candidate = user as Record<string, unknown>;

  if (typeof candidate.id !== "string" || typeof candidate.email !== "string") {
    return null;
  }

  return {
    id: candidate.id,
    email: candidate.email,
    name: typeof candidate.name === "string" ? candidate.name : null,
  };
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  try {
    const { data } = await auth.getSession();

    return sessionUserFromAuthUser(data?.user);
  } catch {
    return null;
  }
}
