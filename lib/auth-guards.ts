import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";

export async function requireCurrentUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  return user;
}
