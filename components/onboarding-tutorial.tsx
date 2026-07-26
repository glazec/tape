import { ChevronDown, CheckCircle2, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

import { CalendarSyncButton } from "@/components/calendar-sync-button";
import { CopyMcpAddressButton } from "@/components/copy-mcp-address-button";
import { OnboardingDismissButton } from "@/components/onboarding-dismiss-button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import type { CalendarConnectionSummary } from "@/lib/calendar-connection-queries";
import { cn } from "@/lib/utils";

const MCP_GUIDE_URL =
  "https://github.com/glazec/tape/blob/main/docs/meeting-note-mcp-api.md";
const MCP_SERVER_URL =
  "https://meeting-note-mcp-production.up.railway.app/mcp";
const MAC_APP_DOWNLOAD_URL =
  "https://github.com/glazec/tape/releases/download/mac-v0.2.0/MeetingNoteLocalRecorder-0.2.0.zip";

export function OnboardingTutorial({
  autoSyncCalendar,
  calendarStatus,
  dismissalCookieName,
  forceCalendarSync,
}: {
  autoSyncCalendar: boolean;
  calendarStatus: CalendarConnectionSummary;
  dismissalCookieName: string;
  forceCalendarSync: boolean;
}) {
  const calendarReady =
    !forceCalendarSync &&
    calendarStatus.connected &&
    calendarStatus.autoJoinEnabled &&
    calendarStatus.recallCalendarStatus === "connected";

  return (
    <Card className="gap-0 py-0 shadow-sm" aria-labelledby="onboarding-title">
      <CardHeader className="border-b bg-muted/25 px-5 py-5 sm:px-6 sm:py-6">
        <CardTitle>
          <h1
            className="text-2xl font-semibold tracking-tight"
            id="onboarding-title"
          >
            Set up Tape
          </h1>
        </CardTitle>
        <CardDescription>
          Start with automatic capture, then add the tools you need.
        </CardDescription>
        <CardAction>
          <OnboardingDismissButton cookieName={dismissalCookieName} />
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        <ol className="divide-y">
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
            action={<CopyMcpAddressButton address={MCP_SERVER_URL} />}
            description="Let Claude, Cursor, and other assistants search meetings you can access."
            details={<McpSetupSteps />}
            number={3}
            supporting={<McpServerAddress />}
            title="Connect the MCP server"
          />
        </ol>
      </CardContent>
    </Card>
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
    <li className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-4 gap-y-3 px-5 py-5 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto] sm:items-start sm:px-6">
      <div
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-full bg-muted text-base font-semibold text-foreground"
      >
        {number}
      </div>
      <div className="min-w-0">
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 max-w-2xl leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action ? (
        <div className="col-start-2 w-full sm:col-start-3 sm:row-start-1 sm:w-auto sm:justify-self-end">
          {action}
        </div>
      ) : null}
      {supporting ? (
        <div className="col-start-2 min-w-0 sm:col-span-2">{supporting}</div>
      ) : null}
      {details ? (
        <div className="col-start-2 min-w-0 sm:col-span-2">{details}</div>
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
      href={MAC_APP_DOWNLOAD_URL}
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
          "min-h-11 w-fit cursor-pointer list-none text-muted-foreground sm:min-h-8 [&::-webkit-details-marker]:hidden",
        )}
      >
        macOS setup instructions
        <ChevronDown className="transition-transform group-open:rotate-180" />
      </summary>
      <ol className="mt-2 max-w-xl space-y-2 text-sm leading-6 text-muted-foreground">
        <li>1. Download and unzip the app.</li>
        <li>
          2. Move <code>MeetingNoteLocalRecorder.app</code> to Applications.
        </li>
        <li>
          3. Because the app is not notarized, remove quarantine from this app
          in Terminal:
          <code className="mt-1 block overflow-x-auto rounded-md bg-muted px-2 py-1 text-xs text-foreground">
            xattr -dr com.apple.quarantine
            /Applications/MeetingNoteLocalRecorder.app
          </code>
        </li>
        <li>
          4. Open the app and grant Microphone, Screen Recording,
          Accessibility, and Notifications access.
        </li>
      </ol>
    </details>
  );
}

function McpServerAddress() {
  return (
    <>
      <p className="text-sm font-medium text-foreground">MCP server link</p>
      <code className="mt-1 block max-w-xl select-all overflow-x-auto rounded-md bg-muted px-2 py-2 text-xs text-foreground">
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
          "min-h-11 w-fit cursor-pointer list-none text-muted-foreground sm:min-h-8 [&::-webkit-details-marker]:hidden",
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
        className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
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
