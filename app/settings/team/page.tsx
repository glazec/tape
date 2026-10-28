import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarCheck,
  CalendarX,
  ChevronDown,
  TriangleAlert,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { BotAvatarPicker } from "@/components/bot-avatar-picker";
import { EmailChipsInput } from "@/components/email-chips-input";
import {
  AutosaveForm,
  AutosaveSelect,
  SettingsSaveStatus,
  SettingsSaveStatusProvider,
} from "@/components/settings-autosave";
import { VocabularyEditor } from "@/components/vocabulary-editor";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  // Name the workspace only when accounts feed different ones.
  const calendarAccountsSpanWorkspaces =
    new Set(calendarAccounts.map((account) => account.teamId)).size > 1;

  return (
    <AppShell
      activeHref="/settings/team"
      amplitudeTeamId={workspace.teamId}
      canCreateMeetings
      oneSignalExternalId={workspace.userId}
    >
      <SettingsSaveStatusProvider>
      <div className="flex w-full flex-col gap-8 md:flex-row md:gap-14">
        <aside className="shrink-0 md:w-44">
          <div className="flex flex-col gap-5 md:sticky md:top-24">
            {organizations.length > 1 ? (
              <details className="group relative">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 [&::-webkit-details-marker]:hidden">
                  <span className="truncate">{workspace.teamName ?? teamConfiguration.name}</span>
                  <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                </summary>
                <nav
                  aria-label="Organizations"
                  className="absolute inset-x-0 z-20 mt-1 flex flex-col rounded-lg border bg-popover p-1 shadow-lg"
                >
                  {organizations.map((organization) => {
                    const isCurrent = organization.teamId === workspace.teamId;

                    return (
                      <Link
                        key={organization.teamId}
                        href={`/settings/team?teamId=${organization.teamId}`}
                        scroll={false}
                        aria-current={isCurrent ? "page" : undefined}
                        className={cn(
                          "rounded-md px-2.5 py-2 text-sm",
                          isCurrent
                            ? "bg-muted font-medium text-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {organization.teamName}
                      </Link>
                    );
                  })}
                </nav>
              </details>
            ) : null}
            <nav aria-label="Settings sections" className="flex flex-row flex-wrap gap-1 md:flex-col">
              {settingsSections
                .filter((section) => section.id !== "vocabulary" || canEditTeamSettings || vocabularyTerms.length > 0)
                .map((section) => (
                  <a
                    className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    href={`#${section.id}`}
                    key={section.id}
                  >
                    {section.label}
                  </a>
                ))}
            </nav>
          </div>
        </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 pb-2">
          <h1 className="text-2xl font-semibold tracking-[-0.015em]">
            Settings
          </h1>
          {canEditTeamSettings ? (
            <SettingsSaveStatus />
          ) : (
            <p className="text-sm text-muted-foreground">
              Only team administrators can edit these settings.
            </p>
          )}
        </div>
        <SettingsSection id="connected-accounts" title="Connected accounts">
          <div className="flex flex-col gap-3">
            {calendarAccounts.length ? (
              <ul>
                {calendarAccounts.map((account) => (
                  <li
                    key={account.id}
                    className="flex min-w-0 flex-col gap-2 pb-3 not-first:pt-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="break-all text-sm font-medium">
                        {/* Accounts linked at sign-in predate stored emails; they are the sign-in account. */}
                        {account.email ?? user.email}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {calendarAccountsSpanWorkspaces
                          ? `Meetings go to ${account.teamName} · `
                          : null}
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
        <SettingsSection id="workspace" title="Workspace">
            {canEditTeamSettings ? (
              <AutosaveForm
                action={`/api/team/configuration?teamId=${workspace.teamId}`}
                className="flex flex-col"
              >
                <FieldRow htmlFor="teamName" label="Team name">
                  <Input
                    className="h-9"
                    defaultValue={teamConfiguration.name}
                    id="teamName"
                    maxLength={100}
                    name="teamName"
                    required
                  />
                </FieldRow>
                <FieldRow htmlFor="translationLanguage" label="Translate transcripts to">
                  <AutosaveSelect
                    defaultValue={teamConfiguration.translationLanguage}
                    id="translationLanguage"
                    name="translationLanguage"
                    options={translationLanguageOptions}
                  />
                </FieldRow>
                <FieldRow
                  description="Appears as one option in Share."
                  htmlFor="shareAudienceName"
                  label="Sharing group"
                >
                  <div className="flex flex-col gap-2">
                    <Input
                      aria-label="Sharing group name"
                      className="h-9"
                      defaultValue={teamConfiguration.shareAudience?.name ?? ""}
                      id="shareAudienceName"
                      maxLength={100}
                      name="shareAudienceName"
                      placeholder="Investment committee"
                    />
                    <EmailChipsInput
                      ariaLabel="Add a sharing group member"
                      defaultEmails={teamConfiguration.shareAudience?.emails ?? []}
                      name="shareAudienceEmails"
                      suggestions={teamMembers.map((member) => ({
                        email: member.email,
                        label: member.name || member.email,
                      }))}
                    />
                  </div>
                </FieldRow>
              </AutosaveForm>
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
        <SettingsSection id="meeting-bot" title="Meeting bot">
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
                      scroll={false}
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
              <AutosaveForm
                action={`/api/team/bot-profile?teamId=${workspace.teamId}${botDomain ? `&organizationDomain=${encodeURIComponent(botDomain)}` : ""}`}
                className="flex flex-col"
                key={`${workspace.teamId}:${botDomain ?? ""}`}
                multipart
                refreshAfterSave
              >
                <FieldRow htmlFor="botName" label="Team bot name">
                  <Input
                    className="h-9"
                    defaultValue={botProfile.botName}
                    id="botName"
                    maxLength={100}
                    name="botName"
                    required
                  />
                </FieldRow>
                <FieldRow label="Team meeting bot avatar">
                  <BotAvatarPicker
                    currentAvatarJpegBase64={botAvatarJpegBase64}
                    isCustom={Boolean(botProfile.avatarJpegBase64)}
                    logoEndpoint={`/api/team/bot-profile/logo?teamId=${workspace.teamId}`}
                  />
                </FieldRow>
                {botSettings.domains.length > 1 && botDomain ? (
                  <FieldRow label="Shared meetings">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="preferForSharedMeetings" className="size-4" defaultChecked={botSettings.preferredBotDomain === botDomain} />
                      Use this bot when both organizations are invited
                    </label>
                  </FieldRow>
                ) : null}
              </AutosaveForm>
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
        <SettingsSection id="vocabulary" title="Vocabulary">
          {canEditTeamSettings ? (
            <VocabularyEditor
              endpoint={`/api/team/vocabulary?teamId=${workspace.teamId}`}
              terms={vocabularyTerms}
            />
          ) : (
            <table className="w-full border-collapse text-sm">
              <tbody>
                {vocabularyTerms.map((term) => (
                  <tr key={term.id}>
                    <td className="w-48 py-2 pr-4 font-medium">{term.term}</td>
                    <td className="py-2 text-muted-foreground">{term.hint ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SettingsSection>
        ) : null}
        <SettingsSection id="members" title="Members">
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
              <ul className="divide-y">
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
          id="billing"
          title="Billing"
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
      </div>
      </SettingsSaveStatusProvider>
    </AppShell>
  );
}

const settingsSections = [
  { id: "connected-accounts", label: "Connected accounts" },
  { id: "workspace", label: "Workspace" },
  { id: "meeting-bot", label: "Meeting bot" },
  { id: "vocabulary", label: "Vocabulary" },
  { id: "members", label: "Members" },
  { id: "billing", label: "Billing" },
] as const;

/**
 * One settings group, reachable from the side rail. Groups are separated
 * by space and a hairline rather than cards.
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
      aria-labelledby={id ? `${id}-title` : undefined}
      className="scroll-mt-24 pt-8 pb-10 first-of-type:pt-4"
      id={id}
    >
      <h2 className="text-base font-semibold" id={id ? `${id}-title` : undefined}>
        {title}
      </h2>
      <div className="mt-4 min-w-0">
        {children}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </section>
  );
}

/** A label column and one control column, the same widths in every group. */
function FieldRow({
  children,
  description,
  htmlFor,
  label,
}: {
  children: React.ReactNode;
  description?: string;
  htmlFor?: string;
  label: string;
}) {
  return (
    <div className="grid gap-x-8 gap-y-2 py-3.5 first:pt-0 last:pb-0 md:grid-cols-[11rem_minmax(0,24rem)]">
      <div>
        {htmlFor ? (
          <label className="text-sm" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <p className="text-sm">{label}</p>
        )}
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
