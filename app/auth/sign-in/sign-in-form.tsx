"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";

import { authClient } from "@/lib/auth/client";
import { buildGoogleSignInOptions } from "@/lib/google-auth";

function GoogleMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="currentColor"
    >
      <path d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z" />
    </svg>
  );
}

export function SignInForm({ callbackUrl }: { callbackUrl?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function signInWithGoogle() {
    setIsPending(true);
    setError(null);

    try {
      const result = await authClient.signIn.social(
        buildGoogleSignInOptions(callbackUrl),
      );

      if (result.error) {
        setError(result.error.message || "Google sign in failed");
        setIsPending(false);
      }
    } catch {
      setError("Google sign in failed");
      setIsPending(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={isPending}
        className="inline-flex h-12 w-full items-center justify-center gap-3 rounded-full bg-ink font-mono text-xs font-medium uppercase tracking-[0.2em] text-paper transition-colors duration-150 hover:bg-graphite disabled:pointer-events-none disabled:opacity-60"
      >
        <GoogleMark />
        {isPending ? "Opening Google…" : "Continue with Google"}
      </button>
      <p className="text-center font-mono text-[10px] uppercase tracking-[0.2em] text-ink/45">
        Company accounts only · SSO via Google
      </p>
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-3 border-2 border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">Google sign in failed</p>
            <p className="mt-1 leading-6">{error}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
