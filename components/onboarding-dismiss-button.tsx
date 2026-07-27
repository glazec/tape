"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60;

export function OnboardingDismissButton({
  cookieName,
  onDismiss,
}: {
  cookieName: string;
  onDismiss?: () => void;
}) {
  const router = useRouter();

  function dismissOnboarding() {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${cookieName}=1; Path=/; Max-Age=${ONE_YEAR_IN_SECONDS}; SameSite=Lax${secure}`;
    onDismiss?.();
    router.replace("/dashboard", { scroll: false });
  }

  return (
    <Button
      className="min-h-11 sm:min-h-8"
      onClick={dismissOnboarding}
      type="button"
      variant="ghost"
    >
      Hide tutorial
    </Button>
  );
}
