import Link from "next/link";
import type { ReactNode } from "react";
import { UserRound } from "lucide-react";

import { AmplitudeIdentity } from "@/components/amplitude-identity";
import { DetailsDismiss } from "@/components/details-dismiss";
import { NewMeetingMenu } from "@/components/new-meeting-menu";
import { OneSignalLogin } from "@/components/onesignal-login";
import { ProductLogo } from "@/components/product-logo";
import { ConnectionStatus } from "@/components/pwa/connection-status";
import { InstallAppMenuItem } from "@/components/pwa/install-app-menu-item";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { getOneSignalAllowedOrigins } from "@/lib/onesignal-web-sdk";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: ReactNode;
  activeHref?: string;
  wide?: boolean;
  amplitudeTeamId?: string;
  canCreateMeetings?: boolean;
  oneSignalExternalId?: string;
};

const navItems = [
  { href: "/dashboard", label: "Meetings" },
  { href: "/intel", label: "Intel" },
  { href: "/settings/team", label: "Settings" },
];

export function AppShell({
  children,
  activeHref,
  wide = false,
  amplitudeTeamId,
  canCreateMeetings = true,
  oneSignalExternalId,
}: AppShellProps) {
  const visibleNavItems = canCreateMeetings
    ? navItems
    : navItems.filter((item) => item.href === "/dashboard" || item.href === "/intel" || item.href === "/settings/team");
  const newMeetingActive = activeHref === "/meetings/new";
  const oneSignalAllowedOrigins = getOneSignalAllowedOrigins();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className={cn("mx-auto flex h-14 w-full items-center gap-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:gap-8 sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]", wide ? "max-w-6xl" : "max-w-4xl")}>
          <Link
            href="/dashboard"
            prefetch={activeHref !== "/dashboard" ? true : null}
            aria-label="Tape home"
            className="inline-flex w-fit shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
            data-telemetry-action="nav_home"
          >
            {/* Narrow phones keep just the mark so the account menu stays on screen. */}
            <ProductLogo className="max-[440px]:w-[30px] max-[440px]:object-cover max-[440px]:object-left" />
          </Link>
          <nav
            aria-label="Primary navigation"
            className="flex h-full items-stretch gap-4 sm:gap-6"
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
            {oneSignalExternalId ? <OrganizationSwitcher /> : null}
            {canCreateMeetings ? (
              <div className={cn(wide && "max-sm:hidden")}><NewMeetingMenu active={newMeetingActive} /></div>
            ) : null}
            <details className="group relative sm:ml-1">
              <DetailsDismiss />
              <summary
                aria-label="Account"
                className="flex size-11 cursor-pointer list-none items-center justify-center rounded-full text-muted-foreground outline-none transition-[color,background-color,transform] duration-150 ease-out hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.94] group-open:bg-muted group-open:text-foreground sm:size-8 [&::-webkit-details-marker]:hidden"
              >
                <UserRound aria-hidden="true" className="size-4" />
              </summary>
              <div className="tape-popover absolute right-0 z-40 mt-2 flex w-48 origin-top-right flex-col rounded-lg border bg-popover p-1 text-sm shadow-lg [&_button]:w-full [&_button]:justify-start">
                {canCreateMeetings ? (
                  <Link
                    className="rounded-md px-2.5 py-2 text-foreground hover:bg-muted"
                    href="/dashboard?setup=1"
                    data-telemetry-action="setup_guide_opened"
                  >
                    Setup guide
                  </Link>
                ) : null}
                <InstallAppMenuItem />
                <SignOutButton />
              </div>
            </details>
          </div>
        </div>
      </header>
      <main className={cn("tape-page-enter mx-auto w-full pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] sm:py-10 sm:pb-[max(2.5rem,env(safe-area-inset-bottom))]", wide ? "max-w-6xl" : "max-w-4xl")}>
        {children}
      </main>
      <ConnectionStatus />
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
