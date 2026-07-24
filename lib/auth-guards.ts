import { redirect } from "next/navigation";

import { isAdminSessionUser } from "@/lib/admin-access";
import { getAuthenticatedUser, getCurrentUser } from "@/lib/auth";

export async function requireCurrentUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  return user;
}

export async function requireAdminUser() {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  if (!(await isAdminSessionUser(user))) {
    redirect("/dashboard");
  }

  return user;
}
