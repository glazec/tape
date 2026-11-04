"use client";

import { ChevronDown, CheckCircle2, ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";

import { CalendarSyncButton } from "@/components/calendar-sync-button";
import { CopyMcpAddressButton } from "@/components/copy-mcp-address-button";
import { OnboardingDismissButton } from "@/components/onboarding-dismiss-button";
import { Button, buttonVariants } from "@/components/ui/button";
import type { CalendarConnectionSummary } from "@/lib/calendar-connection-queries";
import { DESKTOP_APP_DOWNLOAD_URL } from "@/lib/desktop-app";
import { isCalendarReady } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

const MCP_GUIDE_URL =
  "https://github.com/glazec/tape/blob/main/docs/meeting-note-mcp-api.md";
const MCP_SERVER_URL =
  "https://meeting-note-mcp-production.up.railway.app/mcp";

export function OnboardingTutorial({
  autoSyncCalendar,
  calendarStatus,
  dismissedFallback,
  dismissalCookieName,
  forceCalendarSync,
}: {
  autoSyncCalendar: boolean;
  calendarStatus: CalendarConnectionSummary;
  dismissedFallback?: ReactNode;
  dismissalCookieName: string;
  forceCalendarSync: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const calendarReady = !forceCalendarSync && isCalendarReady(calendarStatus);

  if (dismissed) {
    return dismissedFallback;
  }

  const dismissButton = (
    <OnboardingDismissButton
      cookieName={dismissalCookieName}
      onDismiss={() => setDismissed(true)}
    />
  );

  // Once the calendar is connected, automatic capture works and the rest of
  // the setup is optional, so the card steps aside to a single line.
  if (calendarReady && !expanded) {
    return (
      <section
        aria-labelledby="onboarding-title"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-muted px-5 py-3 sm:px-6"
      >
        <h1
          className="flex min-w-0 basis-full items-start gap-2 text-sm font-medium sm:basis-0 sm:flex-1 sm:items-center"
          id="onboarding-title"
        >
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 sm:mt-0" />
          <span className="min-w-0">
            Calendar connected.{" "}
            <span className="font-normal text-muted-foreground">
              Add the desktop app or MCP server when you need them.
            </span>
          </span>
        </h1>
        <div className="-ml-2.5 flex items-center gap-1 sm:ml-0">
          <Button
            aria-expanded={false}
            className="min-h-11 sm:min-h-8"
            onClick={() => setExpanded(true)}
            type="button"
            variant="ghost"
          >
            Show setup
          </Button>
          {dismissButton}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="onboarding-title"
      className="rounded-2xl bg-muted px-5 py-6 sm:px-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1
            className="text-2xl font-semibold tracking-tight"
            id="onboarding-title"
          >
            Set up Tape
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Start with automatic capture, then add the tools you need.
          </p>
        </div>
        <div className="-ml-2.5 flex items-center gap-1 sm:ml-0">
          {calendarReady ? (
            <Button
              aria-expanded
              className="min-h-11 sm:min-h-8"
              onClick={() => setExpanded(false)}
              type="button"
              variant="ghost"
            >
              Collapse
            </Button>
          ) : null}
          {dismissButton}
        </div>
      </div>
      <ol className="mt-6 space-y-6">
        <OnboardingStep
          action={
            calendarReady ? (
              <p className="flex min-h-8 items-center gap-1.5 text-sm font-medium text-foreground">
                <CheckCircle2 className="size-4" />
                Calendar connected
              </p>
            ) : (
              <div className="[&_button]:min-h-11 [&_button]:w-full sm:[&_button]:min-h-8 sm:[&_button]:w-auto">
                <CalendarSyncButton
                  autoSync={autoSyncCalendar}
                  connected={calendarStatus.connected}
                  connectVariant="outline"
                  setupMode
                />
              </div>
            )
          }
          description={
            calendarStatus.connected && !calendarReady
              ? "Finish calendar sync to turn on automatic capture."
              : "Tape can capture supported Google Meet and Zoom calls from your schedule."
          }
          number={1}
          title="Connect your calendar"
        />
        <OnboardingStep
          action={<DesktopDownloadLink />}
          description="Record your microphone and system audio when a meeting bot is not the right fit."
          details={<DesktopSetupSteps />}
          number={2}
          title="Get the desktop app"
        />
        <OnboardingStep
          action={
            <CopyMcpAddressButton address={MCP_SERVER_URL} variant="outline" />
          }
          description="Let Claude, Cursor, and other assistants search meetings you can access."
          details={<McpSetupSteps />}
          number={3}
          supporting={<McpServerAddress />}
          title="Connect the MCP server"
        />
      </ol>
    </section>
  );
}

function OnboardingStep({
  action,
  description,
  details,
  number,
  supporting,
  title,
}: {
  action?: ReactNode;
  description: string;
  details?: ReactNode;
  number: number;
  supporting?: ReactNode;
  title: string;
}) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:items-start">
      <span
        aria-hidden="true"
        className="pt-0.5 font-mono text-xs tabular-nums tracking-[0.08em] text-muted-foreground"
      >
        {String(number).padStart(2, "0")}
      </span>
      <div className="min-w-0">
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 max-w-2xl leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action ? (
        <div className="col-start-2 w-full min-w-0 sm:col-start-3 sm:row-start-1 sm:w-auto sm:max-w-72 sm:justify-self-end">
          {action}
        </div>
      ) : null}
      {supporting ? (
        <div className="col-start-2 col-end-3 min-w-0 sm:col-end-4">{supporting}</div>
      ) : null}
      {details ? (
        <div className="col-start-2 col-end-3 min-w-0 sm:col-end-4">{details}</div>
      ) : null}
    </li>
  );
}

function DesktopDownloadLink() {
  return (
    <a
      className={cn(
        buttonVariants({ variant: "outline" }),
        "min-h-11 w-full sm:min-h-8 sm:w-auto",
      )}
      href={DESKTOP_APP_DOWNLOAD_URL}
    >
      Download app
    </a>
  );
}

function DesktopSetupSteps() {
  return (
    <details className="group">
      <summary
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "-ml-2.5 min-h-11 w-fit cursor-pointer list-none text-muted-foreground sm:min-h-8 [&::-webkit-details-marker]:hidden",
        )}
      >
        macOS setup instructions
        <ChevronDown className="transition-transform group-open:rotate-180" />
      </summary>
      <ol className="mt-2 max-w-xl space-y-2 text-sm leading-6 text-muted-foreground">
        <li>1. Download and unzip the app. It needs macOS 15 or newer.</li>
        <li>
          2. Move <code>Tape Desktop.app</code> to Applications.
        </li>
        <li>
          3. Because the app is not notarized by Apple, remove quarantine from
          it in Terminal. If that reports a permission error, run it again
          with <code>sudo</code>.
          <code className="mt-1 block overflow-x-auto rounded-md bg-background px-2 py-1 text-xs text-foreground">
            {`xattr -dr com.apple.quarantine "/Applications/Tape Desktop.app"`}
          </code>
        </li>
        <li>
          4. Open the app, select Sign in, and finish signing in with the same
          Google account you use for Tape.
        </li>
        <li>
          5. Select Enable for Microphone, Screen and system audio,
          Accessibility, and Alerts. Recording starts once all four are on.
        </li>
        <li>
          6. Turn on Open at login if you like. The app updates itself, so you
          only install it once.
        </li>
      </ol>
    </details>
  );
}

function McpServerAddress() {
  return (
    <>
      <p className="text-sm font-medium text-foreground">MCP server link</p>
      <code className="mt-1 block max-w-xl select-all overflow-x-auto rounded-md bg-background px-2 py-2 text-xs text-foreground">
        {MCP_SERVER_URL}
      </code>
    </>
  );
}

function McpSetupSteps() {
  return (
    <details className="group">
      <summary
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "-ml-2.5 min-h-11 w-fit cursor-pointer list-none text-muted-foreground sm:min-h-8 [&::-webkit-details-marker]:hidden",
        )}
      >
        MCP setup instructions
        <ChevronDown className="transition-transform group-open:rotate-180" />
      </summary>
      <ol className="mt-2 max-w-xl space-y-2 text-sm leading-6 text-muted-foreground">
        <li>
          1. Add a custom Streamable HTTP server named Tape in your AI
          client&apos;s MCP or connector settings.
        </li>
        <li>
          2. Use the address above, open the connection, and sign in with the
          same Google account you use for Tape.
        </li>
      </ol>
      <a
        className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
        href={MCP_GUIDE_URL}
        rel="noreferrer"
        target="_blank"
      >
        Technical reference
        <ExternalLink className="size-3.5" />
      </a>
    </details>
  );
}
