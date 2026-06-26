"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { buildGoogleSignInOptions } from "@/lib/google-calendar-auth";

export function SignInForm() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function signInWithGoogle() {
    setIsPending(true);
    setError(null);

    try {
      const result = await authClient.signIn.social(buildGoogleSignInOptions());

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
    <div className="mt-8 flex flex-col items-start gap-3">
      <Button type="button" onClick={signInWithGoogle} disabled={isPending}>
        {isPending ? "Opening Google..." : "Continue with Google"}
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Google sign in failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
