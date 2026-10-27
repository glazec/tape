import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck, CalendarX, TriangleAlert } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { BotAvatarPicker } from "@/components/bot-avatar-picker";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
}) {
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
      <section className="flex w-full flex-col">
        <div className="pb-8">
          <h1 className="text-2xl font-semibold tracking-[-0.015em]">
            Settings
          </h1>
          {organizations.length > 1 ? (
            <nav
              aria-label="Organizations"
              className="mt-3 inline-flex flex-wrap gap-1 rounded-lg bg-muted/60 p-1"
            >
              {organizations.map((organization) => {
                const isCurrent = organization.teamId === workspace.teamId;

                return (
                  <Link
                    key={organization.teamId}
                    href={`/settings/team?teamId=${organization.teamId}`}
                    aria-current={isCurrent ? "page" : undefined}
                    className={cn(
                      "inline-flex min-h-11 items-center rounded-md px-3 text-sm transition-colors sm:min-h-7",
                      isCurrent
                        ? "bg-background font-medium text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {organization.teamName}
                  </Link>
                );
              })}
            </nav>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              {teamConfiguration.name}
            </p>
          )}
          {!canEditTeamSettings ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Only team administrators can edit these settings.
            </p>
          ) : null}
        </div>
        <SettingsSection id="connected-accounts" title="Connected accounts">
          <div className="flex flex-col gap-3">
            {calendarAccounts.length ? (
              <ul className="divide-y border-b">
                {calendarAccounts.map((account) => (
                  <li
                    key={account.id}
                    className="flex min-w-0 flex-col gap-2 pb-3 not-first:pt-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="break-all text-sm font-medium">
                        {account.email ?? "Google account"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {account.teamName} ·{" "}
                        {account.connected
                          ? account.status === "disconnected"
                            ? "Needs attention"
                            : "Connected"
                          : "Disconnected"}
                      </p>
                    </div>
                    <CalendarSyncButton
                      connected={Boolean(account.connected)}
                      connectionId={account.id}
                      size="sm"
                      teamId={account.teamId}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
            <Link
              href="/api/calendar/oauth/start"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "self-start",
              )}
            >
              Connect another account
            </Link>
          </div>
        </SettingsSection>
        <SettingsSection
          title="Workspace defaults"
        >
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
                    className="sm:max-w-sm"
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
                      className="h-11 w-full bg-background sm:max-w-sm"
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
                </div>
                <div className="grid gap-2">
                  <label
                    className="text-sm leading-none font-medium"
                    htmlFor="shareAudienceName"
                  >
                    Sharing group name
                  </label>
                  <Input
                    className="sm:max-w-sm"
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
                    className="border-input bg-background min-h-28 w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] sm:max-w-lg"
                    defaultValue={
                      teamConfiguration.shareAudience?.emails.join("\n") ?? ""
                    }
                    id="shareAudienceEmails"
                    name="shareAudienceEmails"
                    placeholder={"One email per line\nperson@example.com"}
                  />
                </div>
                <Button className="self-start" type="submit" variant="outline">
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
        </SettingsSection>
        <SettingsSection
          title="Meeting capture"
        >
            {botSettings.domains.length > 1 ? (
              <nav
                aria-label="Organization bot profiles"
                className="mb-5 flex flex-wrap gap-x-5 border-b"
              >
                {botSettings.domains.map((domain) => {
                  const isCurrent = domain === botDomain;

                  return (
                    <Link
                      key={domain}
                      href={`/settings/team?teamId=${workspace.teamId}&organizationDomain=${encodeURIComponent(domain)}`}
                      aria-current={isCurrent ? "page" : undefined}
                      className={cn(
                        "relative -mb-px inline-flex min-h-11 items-center border-b-2 text-sm transition-colors sm:min-h-9",
                        isCurrent
                          ? "border-foreground font-medium text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {domain}
                    </Link>
                  );
                })}
              </nav>
            ) : null}
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
                    className="sm:max-w-sm"
                    defaultValue={botProfile.botName}
                    id="botName"
                    maxLength={100}
                    name="botName"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <p className="text-sm leading-none font-medium">
                    Team meeting bot avatar
                  </p>
                  <BotAvatarPicker
                    currentAvatarJpegBase64={botAvatarJpegBase64}
                    isCustom={Boolean(botProfile.avatarJpegBase64)}
                  />
                </div>
                <Button className="self-start" type="submit" variant="outline">
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
        </SettingsSection>
        {canEditTeamSettings || vocabularyTerms.length > 0 ? (
        <SettingsSection
          title="Transcription vocabulary"
        >
          <div className="flex flex-col gap-4">
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
                <Button type="submit" variant="outline">
                  Add term
                </Button>
              </form>
            ) : null}
            {vocabularyTerms.length > 0 ? (
              <ul className="divide-y border-y">
                {vocabularyTerms.map((term) => (
                  <li
                    className="grid gap-x-6 py-2 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]"
                    key={term.id}
                  >
                    <p className="font-medium">{term.term}</p>
                    <p className="text-muted-foreground">{term.hint ?? ""}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No team vocabulary yet.
              </p>
            )}
          </div>
        </SettingsSection>
        ) : null}
        <SettingsSection
          title="Workspace members"
        >
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8">
            <span className="font-medium">
              {teamMembers.length.toLocaleString()}{" "}
              {teamMembers.length === 1 ? "member" : "members"}
            </span>
            <span className="text-muted-foreground group-open:hidden">
              Show
            </span>
            <span className="hidden text-muted-foreground group-open:inline">
              Hide
            </span>
          </summary>
          <div className="mt-3">
            {teamMembers.length > 0 ? (
              <ul className="divide-y border-y">
                {teamMembers.map((member) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5"
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
        </SettingsSection>
        <SettingsSection
          action={
            <Link
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "-ml-2.5 min-h-11 text-muted-foreground sm:min-h-8",
              )}
              href="/usage"
            >
              View billing details
            </Link>
          }
          title="Billing & credits"
        >
          <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Workspace this month</dt>
            <dd className="text-right tabular-nums">
              {formatUsdMicros(billingOverview.organizationMonthUsdMicros)}
            </dd>
            <dt className="text-muted-foreground">You this month</dt>
            <dd className="text-right tabular-nums">
              {formatUsdMicros(billingOverview.personalMonthUsdMicros)}
            </dd>
            <dt className="text-muted-foreground">Credit remaining</dt>
            <dd className="text-right tabular-nums text-muted-foreground">
              {billingOverview.creditLimitUsdMicros === null
                ? "No limit"
                : formatUsdMicros(billingOverview.creditRemainingUsdMicros ?? 0)}
            </dd>
          </dl>
          {billingOverview.isCreditExhausted ? (
            <p className="mt-3 text-sm text-destructive">
              New provider work is paused because the workspace has used its
              credit.
            </p>
          ) : null}
        </SettingsSection>
      </section>
    </AppShell>
  );
}

/**
 * One settings group: its name on the left, the controls on the right, and
 * a hairline between groups. Whitespace separates them instead of cards.
 */
function SettingsSection({
  action,
  children,
  id,
  title,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  title: string;
}) {
  return (
    <section
      className="scroll-mt-20 grid gap-x-12 gap-y-4 border-t py-8 md:grid-cols-[12rem_minmax(0,1fr)]"
      id={id}
    >
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="min-w-0">
        {children}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </section>
  );
}
