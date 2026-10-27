import Link from "next/link";
import type { ReactNode } from "react";

import { AmplitudeIdentity } from "@/components/amplitude-identity";
import { NewMeetingMenu } from "@/components/new-meeting-menu";
import { OneSignalLogin } from "@/components/onesignal-login";
import { ProductLogo } from "@/components/product-logo";
import { SignOutButton } from "@/components/sign-out-button";
import { buttonVariants } from "@/components/ui/button";
import { getOneSignalAllowedOrigins } from "@/lib/onesignal-web-sdk";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: ReactNode;
  activeHref?: string;
  amplitudeTeamId?: string;
  canCreateMeetings?: boolean;
  oneSignalExternalId?: string;
};

const navItems = [
  { href: "/dashboard", label: "Meetings" },
  { href: "/settings/team", label: "Settings" },
];

export function AppShell({
  children,
  activeHref,
  amplitudeTeamId,
  canCreateMeetings = true,
  oneSignalExternalId,
}: AppShellProps) {
  const visibleNavItems = canCreateMeetings
    ? navItems
    : navItems.filter((item) => item.href === "/dashboard");
  const newMeetingActive = activeHref === "/meetings/new";
  const oneSignalAllowedOrigins = getOneSignalAllowedOrigins();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-8 px-4 sm:px-6">
          <Link
            href="/dashboard"
            aria-label="Tape home"
            className="inline-flex w-fit shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
            data-telemetry-action="nav_home"
          >
            <ProductLogo />
          </Link>
          <nav
            aria-label="Primary navigation"
            className="flex h-full items-stretch gap-6"
          >
            {visibleNavItems.map((item) => {
              const isActive = activeHref === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-telemetry-action={`nav_${item.href.slice(1).replaceAll("/", "_")}`}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "relative inline-flex min-h-11 items-center text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "font-medium text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            {canCreateMeetings ? (
              <Link
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "hidden min-h-11 text-muted-foreground sm:inline-flex sm:min-h-8",
                )}
                href="/dashboard?setup=1"
                data-telemetry-action="setup_guide_opened"
              >
                Setup guide
              </Link>
            ) : null}
            <SignOutButton />
            {canCreateMeetings ? (
              <NewMeetingMenu active={newMeetingActive} />
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
      {oneSignalExternalId ? (
        <>
          <AmplitudeIdentity
            teamId={amplitudeTeamId}
            userId={oneSignalExternalId}
          />
          <OneSignalLogin
            allowedOrigins={oneSignalAllowedOrigins}
            externalId={oneSignalExternalId}
          />
        </>
      ) : null}
    </div>
  );
}
