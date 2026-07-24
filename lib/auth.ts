import { auth } from "@/lib/auth/server";
import {
  getAdminImpersonatedUserId,
  isAdminSessionUser,
} from "@/lib/admin-access";
import {
  clearDatabaseClaims,
  initializeDatabaseClaimsContext,
  setDatabaseSessionUser,
} from "@/db/rls-context";

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

export async function getAuthenticatedUser(): Promise<SessionUser | null> {
  initializeDatabaseClaimsContext();
  return getAuthenticatedUserInCurrentContext();
}

async function getAuthenticatedUserInCurrentContext(): Promise<SessionUser | null> {
  try {
    const { data } = await auth.getSession();
    const user = sessionUserFromAuthUser(data?.user);

    if (user) {
      setDatabaseSessionUser(user);
    } else {
      clearDatabaseClaims();
    }

    return user;
  } catch {
    clearDatabaseClaims();
    return null;
  }
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  initializeDatabaseClaimsContext();
  const user = await getAuthenticatedUserInCurrentContext();

  if (!user || !(await isAdminSessionUser(user))) {
    return user;
  }

  const impersonatedUserId = await getAdminImpersonatedUserId();

  if (!impersonatedUserId) {
    return user;
  }

  try {
    const { getImpersonatedSessionUser } = await import(
      "@/lib/admin-impersonation"
    );
    const impersonatedUser =
      await getImpersonatedSessionUser(impersonatedUserId);

    if (!impersonatedUser) {
      return user;
    }

    setDatabaseSessionUser(impersonatedUser);
    return impersonatedUser;
  } catch {
    return user;
  }
}
