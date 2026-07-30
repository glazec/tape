"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";

const signInRecoveryPath =
  "/auth/sign-in?reason=dashboard_load_failed";

type DashboardSessionRecoveryInput = {
  clearSession?: () => Promise<unknown>;
  returnToSignIn: () => void;
};

export async function recoverDashboardSession({
  clearSession = clearLocalSession,
  returnToSignIn,
}: DashboardSessionRecoveryInput) {
  try {
    await clearSession();
  } catch {
    // Recovery must still reach sign in when session cleanup is unavailable.
  }

  returnToSignIn();
}

function clearLocalSession() {
  return fetch("/api/sign-out", { method: "POST" });
}

export default function DashboardError() {
  const router = useRouter();

  useEffect(() => {
    void recoverDashboardSession({
      returnToSignIn: () => router.replace(signInRecoveryPath),
    });
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6 text-ink">
      <div className="w-full max-w-md text-center">
        <AlertTriangle
          aria-hidden
          className="mx-auto size-8 text-destructive"
        />
        <h1 className="font-display mt-5 text-display-3">
          Returning you to sign in
        </h1>
        <p className="mt-3 leading-7 text-graphite">
          Tape could not open your dashboard. Sign in again to retry.
        </p>
        <Link
          className="mt-7 inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-6 font-medium text-paper"
          href={signInRecoveryPath}
        >
          Continue to sign in
        </Link>
      </div>
    </main>
  );
}
