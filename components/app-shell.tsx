import Link from "next/link";
import type { ReactNode } from "react";

import { OneSignalLogin } from "@/components/onesignal-login";
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
  { href: "/dashboard", label: "Dashboard" },
  { href: "/meetings/new", label: "New meeting" },
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
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Link href="/dashboard" className="text-base font-semibold">
            Meeting Transcript
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <nav
              aria-label="Primary navigation"
              className="flex flex-wrap gap-2"
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
