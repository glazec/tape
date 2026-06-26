"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { authClient as defaultAuthClient } from "@/lib/auth/client";

type SignOutAuthClient = {
  signOut: () => Promise<{
    error?: { message?: string } | null;
  }>;
};

type SignOutSessionInput = {
  authClient?: SignOutAuthClient;
  clearLocalCookies?: () => Promise<Response>;
};

export async function signOutSession({
  authClient = defaultAuthClient,
  clearLocalCookies = clearNeonAuthCookies,
}: SignOutSessionInput = {}) {
  let authErrorMessage: string | null = null;

  try {
    const result = await authClient.signOut();
    authErrorMessage = result.error?.message ?? null;
  } catch (error) {
    authErrorMessage = error instanceof Error ? error.message : "Sign out failed";
  }

  try {
    const response = await clearLocalCookies();

    if (response.ok) {
      return { ok: true as const };
    }
  } catch {
    if (!authErrorMessage) {
      return { ok: true as const };
    }
  }

  if (!authErrorMessage) {
    return { ok: true as const };
  }

  return {
    ok: false as const,
    message: "Sign out failed",
  };
}

function clearNeonAuthCookies() {
  return fetch("/api/sign-out", {
    method: "POST",
  });
}

export function SignOutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setIsPending(true);
    setError(null);

    try {
      const result = await signOutSession();

      if (!result.ok) {
        setError(result.message);
        setIsPending(false);
        return;
      }

      router.replace("/auth/sign-in");
      router.refresh();
    } catch {
      setError("Sign out failed");
      setIsPending(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Button
        className="text-muted-foreground"
        disabled={isPending}
        onClick={signOut}
        type="button"
        variant="ghost"
        size="sm"
      >
        <LogOut data-icon="inline-start" />
        {isPending ? "Signing out" : "Sign out"}
      </Button>
      {error ? (
        <p role="status" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
