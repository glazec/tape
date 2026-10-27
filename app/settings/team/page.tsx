import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck, CalendarX, TriangleAlert } from "lucide-react";

import { AppShell } from "@/components/app-shell";
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

export default async function TeamSettingsPage() {
  const user = await requireCurrentUser();
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const accessSummary = await getWorkspaceAccessSummary(workspace);

  if (!accessSummary.canCreateMeetings) {
    redirect("/dashboard");
  }

  const [
    canEditTeamSettings,
    vocabularyTerms,
    botProfile,
    teamConfiguration,
    teamMembers,
    billingOverview,
  ] = await Promise.all([
    canManageTeamSettings(workspace),
    listTeamVocabularyTerms(workspace.teamId),
    getMeetingBotProfile(workspace.teamId),
    getTeamConfiguration(workspace.teamId),
    listWorkspaceMembers(workspace),
    getProviderBillingOverview(workspace),
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
      <section className="flex max-w-4xl flex-col">
        <div className="pb-8">
          <h1 className="text-2xl font-semibold tracking-[-0.015em]">
            Settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {teamConfiguration.name}
          </p>
          {!canEditTeamSettings ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Only team administrators can edit these settings.
            </p>
          ) : null}
        </div>
        <SettingsSection
          title="Workspace defaults"
          description="Set the team name, translation language, and an optional sharing group."
        >
            {canEditTeamSettings ? (
              <form
                action="/api/team/configuration"
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
          description="Set the team bot name and JPG avatar people see when it joins calls."
        >
            {canEditTeamSettings ? (
              <form
                action="/api/team/bot-profile"
                className="flex flex-col gap-4"
                encType="multipart/form-data"
                method="post"
              >
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
                    className="h-auto cursor-pointer border-dashed py-2 text-muted-foreground file:mr-3 file:h-7 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-background file:px-2.5 file:text-foreground"
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
          description="Help Tape recognize team, company, and deal names correctly."
        >
          <div className="flex flex-col gap-4">
            {canEditTeamSettings ? (
              <form
                action="/api/team/vocabulary"
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
                  <li className="py-2" key={term.id}>
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
              <p className="text-sm text-muted-foreground">
                No team vocabulary yet.
              </p>
            )}
          </div>
        </SettingsSection>
        ) : null}
        <SettingsSection
          title="Workspace members"
          description="People in this workspace and their calendar status."
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
                "-mr-2 min-h-11 text-muted-foreground sm:min-h-8",
              )}
              href="/usage"
            >
              View billing details
            </Link>
          }
          title="Billing & credits"
          description="This month's provider consumption."
        >
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
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
              label="Workspace this month"
              value={formatUsdMicros(
                billingOverview.organizationMonthUsdMicros,
              )}
            />
            <BillingSettingMetric
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
        </SettingsSection>
      </section>
    </AppShell>
  );
}

function BillingSettingMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * One settings group: what it is on the left, the controls on the right, and
 * a hairline between groups. Whitespace separates them instead of cards.
 */
function SettingsSection({
  action,
  children,
  description,
  title,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="grid gap-x-12 gap-y-4 border-t py-8 md:grid-cols-[14rem_minmax(0,1fr)]">
      <div>
        <div className="flex items-start justify-between gap-3 md:block">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action ? <div className="md:mt-2">{action}</div> : null}
        </div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
