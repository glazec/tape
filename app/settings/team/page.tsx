import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck, CalendarX, TriangleAlert } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { requireCurrentUser } from "@/lib/auth-guards";
import { CalendarSyncButton } from "@/components/calendar-sync-button";
import { listConnectedCalendarAccounts } from "@/lib/connected-calendar-accounts";
import { getOrganizationBotSettings, listOrganizationWorkspaces, selectOrganizationWorkspace } from "@/lib/organization-workspaces";
import {
  translationLanguageLabels,
  translationLanguageOptions,
} from "@/lib/meeting-translation-language";
import {
  getDefaultMeetingBotAvatarJpegBase64,
  getMeetingBotProfile,
} from "@/lib/meeting-bot-profile";
import {
  formatUsdMicros,
  getProviderBillingOverview,
} from "@/lib/provider-usage-queries";
import { getTeamConfiguration } from "@/lib/team-configuration";
import { listTeamVocabularyTerms } from "@/lib/team-vocabulary";
import { cn } from "@/lib/utils";
import {
  canManageTeamSettings,
  getOrCreateWorkspaceForSessionUser,
  getWorkspaceAccessSummary,
  listWorkspaceMembers,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage({ searchParams }: {
  searchParams?: Promise<{ teamId?: string; organizationDomain?: string }>;
} = {}) {
  const user = await requireCurrentUser();
  let workspace = await getOrCreateWorkspaceForSessionUser(user);
  const params = await searchParams;
  const requestedTeamId = params?.teamId;
  if (requestedTeamId) {
    const selected = await selectOrganizationWorkspace(workspace, requestedTeamId);
    if (!selected) redirect("/settings/team");
    workspace = selected;
  }
  const accessSummary = await getWorkspaceAccessSummary(workspace);

  if (!accessSummary.canCreateMeetings) {
    redirect("/dashboard");
  }

  const botSettings = await getOrganizationBotSettings(workspace.teamId);
  const botDomain = params?.organizationDomain && botSettings.domains.includes(params.organizationDomain)
    ? params.organizationDomain : botSettings.domains.includes(workspace.domain) ? workspace.domain : undefined;

  const [
    canEditTeamSettings,
    vocabularyTerms,
    botProfile,
    teamConfiguration,
    teamMembers,
    billingOverview,
    organizations,
    calendarAccounts,
  ] = await Promise.all([
    canManageTeamSettings(workspace),
    listTeamVocabularyTerms(workspace.teamId),
    getMeetingBotProfile(workspace.teamId, botDomain),
    getTeamConfiguration(workspace.teamId),
    listWorkspaceMembers(workspace),
    getProviderBillingOverview(workspace),
    listOrganizationWorkspaces(workspace),
    listConnectedCalendarAccounts(workspace),
  ]);
  const botAvatarJpegBase64 =
    botProfile.avatarJpegBase64 ?? getDefaultMeetingBotAvatarJpegBase64();

  return (
    <AppShell
      activeHref="/settings/team"
      amplitudeTeamId={workspace.teamId}
      canCreateMeetings
      oneSignalExternalId={workspace.userId}
    >
      <section className="flex max-w-3xl flex-col gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Team settings
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {teamConfiguration.name}
          </h1>
          {organizations.length > 1 ? (
            <nav aria-label="Organizations" className="mt-4 flex flex-wrap gap-2">
              {organizations.map((organization) => (
                <Link
                  key={organization.teamId}
                  href={`/settings/team?teamId=${organization.teamId}`}
                  aria-current={organization.teamId === workspace.teamId ? "page" : undefined}
                  className={buttonVariants({ variant: organization.teamId === workspace.teamId ? "secondary" : "ghost", size: "sm" })}
                >
                  {organization.teamName}
                </Link>
              ))}
            </nav>
          ) : null}
          {!canEditTeamSettings ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Only team administrators can edit these settings.
            </p>
          ) : null}
        </div>
        <Card id="connected-accounts">
          <CardHeader>
            <CardTitle>Connected accounts</CardTitle>
            <CardDescription>Connect work emails to sync each account’s calendar.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {calendarAccounts.length ? (
              <ul className="divide-y">
                {calendarAccounts.map((account) => (
                  <li key={account.id} className="flex min-w-0 flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-all text-sm font-medium">{account.email ?? "Google account · reconnect to identify"}</p>
                      <p className="text-xs text-muted-foreground">{account.teamName} · {account.connected ? account.status === "disconnected" ? "Needs attention" : "Connected" : "Disconnected"}</p>
                    </div>
                    <CalendarSyncButton connectionId={account.id} teamId={account.teamId} connected={Boolean(account.connected)} />
                  </li>
                ))}
              </ul>
            ) : null}
            <Link href="/api/calendar/oauth/start" className={cn(buttonVariants({ variant: "outline" }), "self-start")}>
              Connect another account
            </Link>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Billing &amp; credits</CardTitle>
            <CardDescription>
              Workspace credit and provider consumption for the current month.
            </CardDescription>
            <CardAction>
              <Link
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "min-h-11 sm:min-h-8",
                )}
                href="/usage"
              >
                View billing details
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            <dl className="grid overflow-hidden rounded-lg border sm:grid-cols-3">
              <BillingSettingMetric
                label="Credit remaining"
                value={
                  billingOverview.creditLimitUsdMicros === null
                    ? "No limit"
                    : formatUsdMicros(
                        billingOverview.creditRemainingUsdMicros ?? 0,
                      )
                }
              />
              <BillingSettingMetric
                className="border-t sm:border-t-0 sm:border-l"
                label="Workspace this month"
                value={formatUsdMicros(
                  billingOverview.organizationMonthUsdMicros,
                )}
              />
              <BillingSettingMetric
                className="border-t sm:border-t-0 sm:border-l"
                label="You this month"
                value={formatUsdMicros(billingOverview.personalMonthUsdMicros)}
              />
            </dl>
            {billingOverview.isCreditExhausted ? (
              <p className="mt-3 text-sm text-destructive">
                New provider work is paused because the workspace has used its
                credit.
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Workspace defaults</CardTitle>
            <CardDescription>
              Set the team name, translation language, and an optional sharing
              group.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {canEditTeamSettings ? (
              <form
                action={`/api/team/configuration?teamId=${workspace.teamId}`}
                className="flex flex-col gap-4"
                method="post"
              >
                <div className="grid gap-2">
                  <label
                    className="text-sm leading-none font-medium"
                    htmlFor="teamName"
                  >
                    Team name
                  </label>
                  <Input
                    defaultValue={teamConfiguration.name}
                    id="teamName"
                    maxLength={100}
                    name="teamName"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <label
                    className="text-sm leading-none font-medium"
                    htmlFor="translationLanguage"
                  >
                    Translate transcripts to
                  </label>
                  <Select
                    defaultValue={teamConfiguration.translationLanguage}
                    items={translationLanguageOptions}
                    name="translationLanguage"
                  >
                    <SelectTrigger
                      className="h-11 w-full bg-background sm:max-w-xs"
                      id="translationLanguage"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {translationLanguageOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-5 text-muted-foreground">
                    New automatic and manual translations use this language.
                  </p>
                </div>
                <div className="grid gap-2">
                  <label
                    className="text-sm leading-none font-medium"
                    htmlFor="shareAudienceName"
                  >
                    Sharing group name
                  </label>
                  <Input
                    defaultValue={teamConfiguration.shareAudience?.name ?? ""}
                    id="shareAudienceName"
                    maxLength={100}
                    name="shareAudienceName"
                    placeholder="Investment committee"
                  />
                </div>
                <div className="grid gap-2">
                  <label
                    className="text-sm leading-none font-medium"
                    htmlFor="shareAudienceEmails"
                  >
                    Sharing group member emails
                  </label>
                  <textarea
                    className="border-input bg-background min-h-28 w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    defaultValue={
                      teamConfiguration.shareAudience?.emails.join("\n") ?? ""
                    }
                    id="shareAudienceEmails"
                    name="shareAudienceEmails"
                    placeholder={"person@example.com\ncolleague@example.com"}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    Add one email per line. Leave both sharing group fields
                    empty to hide the group.
                  </p>
                </div>
                <Button className="self-start" type="submit">
                  Save team settings
                </Button>
              </form>
            ) : (
              <div className="flex flex-col gap-2 text-sm">
                <p className="font-medium">{teamConfiguration.name}</p>
                <p className="text-muted-foreground">
                  Translations ·{" "}
                  {translationLanguageLabels[
                    teamConfiguration.translationLanguage
                  ]}
                </p>
                {teamConfiguration.shareAudience ? (
                  <p className="text-muted-foreground">
                    {teamConfiguration.shareAudience.name} ·{" "}
                    {teamConfiguration.shareAudience.emails.length} members
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    No team sharing group configured.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Meeting capture</CardTitle>
            <CardDescription>
              Set the team bot name and JPG avatar people see when it joins
              calls.
            </CardDescription>
            {botSettings.domains.length > 1 ? (
              <nav aria-label="Organization bot profiles" className="flex flex-wrap gap-2">
                {botSettings.domains.map((domain) => (
                  <Link key={domain}
                    href={`/settings/team?teamId=${workspace.teamId}&organizationDomain=${encodeURIComponent(domain)}`}
                    aria-current={domain === botDomain ? "page" : undefined}
                    className={buttonVariants({ variant: domain === botDomain ? "secondary" : "ghost", size: "sm" })}>
                    {domain}
                  </Link>
                ))}
              </nav>
            ) : null}
          </CardHeader>
          <CardContent>
            {canEditTeamSettings ? (
              <form
                key={`${workspace.teamId}:${botDomain ?? ""}`}
                action={`/api/team/bot-profile?teamId=${workspace.teamId}${botDomain ? `&organizationDomain=${encodeURIComponent(botDomain)}` : ""}`}
                className="flex flex-col gap-4"
                encType="multipart/form-data"
                method="post"
              >
                {botSettings.domains.length > 1 && botDomain ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="preferForSharedMeetings" className="size-4" defaultChecked={botSettings.preferredBotDomain === botDomain} />
                    Use this bot when both organizations are invited
                  </label>
                ) : null}
                <div className="grid gap-2">
                  <label
                    className="text-sm leading-none font-medium"
                    htmlFor="botName"
                  >
                    Team bot name
                  </label>
                  <Input
                    defaultValue={botProfile.botName}
                    id="botName"
                    maxLength={100}
                    name="botName"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <label
                    className="text-sm leading-none font-medium"
                    htmlFor="avatar"
                  >
                    Team meeting bot avatar
                  </label>
                  <Input
                    accept="image/jpeg"
                    id="avatar"
                    name="avatar"
                    type="file"
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    Upload a JPG image under 1 MB.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div
                    aria-label="Current team meeting bot avatar"
                    className="size-16 rounded-lg border bg-muted bg-cover bg-center"
                    role="img"
                    style={
                      botAvatarJpegBase64
                        ? {
                            backgroundImage: `url(data:image/jpeg;base64,${botAvatarJpegBase64})`,
                          }
                        : undefined
                    }
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {botProfile.avatarJpegBase64
                        ? "Custom avatar saved"
                        : "Default avatar"}
                    </p>
                    <label className="mt-2 flex items-center gap-2 text-xs font-normal text-muted-foreground">
                      <input
                        className="size-4"
                        name="resetAvatar"
                        type="checkbox"
                      />
                      Use default avatar
                    </label>
                  </div>
                </div>
                <Button className="self-start" type="submit">
                  Save team bot profile
                </Button>
              </form>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">{botProfile.botName}</p>
                <p className="text-xs text-muted-foreground">
                  Team meeting bot avatar
                </p>
                <div
                  aria-label="Current team meeting bot avatar"
                  className="size-16 rounded-lg border bg-muted bg-cover bg-center"
                  role="img"
                  style={
                    botAvatarJpegBase64
                      ? {
                          backgroundImage: `url(data:image/jpeg;base64,${botAvatarJpegBase64})`,
                        }
                      : undefined
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {botProfile.avatarJpegBase64
                    ? "Custom avatar saved"
                    : "Default avatar"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
        {canEditTeamSettings || vocabularyTerms.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Transcription vocabulary</CardTitle>
            <CardDescription>
              Help Tape recognize team, company, and deal names correctly.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {canEditTeamSettings ? (
              <form
                action={`/api/team/vocabulary?teamId=${workspace.teamId}`}
                className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                method="post"
              >
                <Input
                  aria-label="Vocabulary term"
                  name="term"
                  placeholder="Term"
                />
                <Input
                  aria-label="Vocabulary hint"
                  name="hint"
                  placeholder="Optional hint"
                />
                <Button type="submit">Add</Button>
              </form>
            ) : null}
            {vocabularyTerms.length > 0 ? (
              <ul className="divide-y rounded-lg border">
                {vocabularyTerms.map((term) => (
                  <li className="px-3 py-2" key={term.id}>
                    <p className="text-sm font-medium">{term.term}</p>
                    {term.hint ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {term.hint}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border px-3 py-4 text-sm text-muted-foreground">
                No team vocabulary yet.
              </p>
            )}
          </CardContent>
        </Card>
        ) : null}
        <details className="group rounded-lg border bg-card shadow-sm">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <span>Workspace members</span>
            <span className="text-sm font-normal text-muted-foreground">
              {teamMembers.length.toLocaleString()}
            </span>
          </summary>
          <div className="border-t p-4">
            {teamMembers.length > 0 ? (
              <ul className="divide-y rounded-lg border">
                {teamMembers.map((member) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 px-3 py-3"
                    key={member.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {member.name || member.email}
                      </p>
                      {member.name ? (
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {member.email}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {member.calendarStatus ? (
                        <Badge
                          variant={
                            member.calendarStatus === "connected"
                              ? "secondary"
                              : member.calendarStatus === "needs_attention"
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {member.calendarStatus === "connected" ? (
                            <CalendarCheck data-icon="inline-start" />
                          ) : member.calendarStatus === "needs_attention" ? (
                            <TriangleAlert data-icon="inline-start" />
                          ) : (
                            <CalendarX data-icon="inline-start" />
                          )}
                          {member.calendarStatus === "connected"
                            ? "Calendar connected"
                            : member.calendarStatus === "needs_attention"
                              ? "Calendar needs attention"
                              : "Calendar not connected"}
                        </Badge>
                      ) : null}
                      {member.isCurrentUser ? (
                        <Badge variant="outline">You</Badge>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No workspace members yet.
              </p>
            )}
          </div>
        </details>
      </section>
    </AppShell>
  );
}

function BillingSettingMetric({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div className={cn("p-4", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-2 font-mono text-lg font-semibold tabular-nums">
        {value}
      </dd>
    </div>
  );
}
