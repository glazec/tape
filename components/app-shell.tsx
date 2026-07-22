import Link from "next/link";
import type { ReactNode } from "react";

import { OneSignalLogin } from "@/components/onesignal-login";
import { ProductLogo } from "@/components/product-logo";
import { SignOutButton } from "@/components/sign-out-button";
import { buttonVariants } from "@/components/ui/button";
import { getOneSignalAllowedOrigins } from "@/lib/onesignal-web-sdk";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: ReactNode;
  activeHref?: string;
  canCreateMeetings?: boolean;
  oneSignalExternalId?: string;
};

const navItems = [
  { href: "/meetings/new", label: "New meeting" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/settings/team", label: "Team settings" },
];

export function AppShell({
  children,
  activeHref,
  canCreateMeetings = true,
  oneSignalExternalId,
}: AppShellProps) {
  const visibleNavItems = canCreateMeetings
    ? navItems
    : navItems.filter((item) => item.href === "/dashboard");
  const oneSignalAllowedOrigins = getOneSignalAllowedOrigins();

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,var(--background)_0%,var(--surface)_100%)] text-foreground">
      <header className="sticky top-0 z-30 bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Link
            href="/dashboard"
            aria-label="Tape home"
            className="inline-flex w-fit rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
          >
            <ProductLogo />
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <nav
              aria-label="Primary navigation"
              className="flex flex-wrap gap-1 rounded-lg border bg-card p-1 shadow-sm"
            >
              {visibleNavItems.map((item) => {
                const isPrimaryAction = item.href === "/meetings/new";
                const isActive = activeHref === item.href;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      buttonVariants({
                        variant: isPrimaryAction
                          ? "default"
                          : isActive
                            ? "secondary"
                            : "ghost",
                        size: "sm",
                      }),
                      !isPrimaryAction &&
                        (isActive ? "text-foreground" : "text-muted-foreground"),
                      "min-h-11 shadow-none sm:min-h-8",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
      {oneSignalExternalId ? (
        <OneSignalLogin
          allowedOrigins={oneSignalAllowedOrigins}
          externalId={oneSignalExternalId}
        />
      ) : null}
    </div>
  );
}
