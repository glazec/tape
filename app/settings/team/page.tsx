import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { requireCurrentUser } from "@/lib/auth-guards";
import { getMeetingBotProfile } from "@/lib/meeting-bot-profile";
import { listTeamVocabularyTerms } from "@/lib/team-vocabulary";
import {
  getOrCreateWorkspaceForSessionUser,
  getWorkspaceAccessSummary,
  listWorkspaceMembers,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  const user = await requireCurrentUser();
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const accessSummary = await getWorkspaceAccessSummary(workspace);
  const vocabularyTerms = accessSummary.canCreateMeetings
    ? await listTeamVocabularyTerms(workspace.teamId)
    : [];
  const botProfile = accessSummary.canCreateMeetings
    ? await getMeetingBotProfile(workspace.teamId)
    : null;
  const teamMembers = accessSummary.canCreateMeetings
    ? await listWorkspaceMembers(workspace)
    : [];

  if (!accessSummary.canCreateMeetings) {
    redirect("/dashboard");
  }

  return (
    <AppShell
      activeHref="/settings/team"
      canCreateMeetings
      oneSignalExternalId={workspace.userId}
    >
      <section className="flex max-w-3xl flex-col gap-6">
        <div>
          <p className="text-sm font-medium uppercase tracking-normal text-primary">
            Team settings
          </p>
          <h1 className="mt-3 text-3xl font-semibold">Access rules</h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Signed in as {user?.email ?? "unknown user"}.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Internal domains</CardTitle>
            <CardDescription>
              Control automatic access for internal meeting attendees.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="leading-7 text-muted-foreground">
              Allowed internal domains define which meeting attendees can
              receive automatic transcript access. When a meeting is processed,
              attendees with an allowed domain and matching workspace membership
              can be granted access without a manual share step.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Onboarded colleagues</CardTitle>
            <CardDescription>
              People who have signed in and joined this workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {member.email}
                      </p>
                    </div>
                    {member.isCurrentUser ? (
                      <span className="rounded-md border px-2 py-1 text-xs font-medium">
                        You
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border px-3 py-4 text-sm text-muted-foreground">
                No onboarded colleagues yet.
              </p>
            )}
          </CardContent>
        </Card>
        {botProfile ? (
          <Card>
            <CardHeader>
              <CardTitle>Team meeting bot</CardTitle>
              <CardDescription>
                Set the team bot name and JPG avatar people see when it joins
                calls.
              </CardDescription>
            </CardHeader>
            <CardContent>
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
                      botProfile.avatarJpegBase64
                        ? {
                            backgroundImage: `url(data:image/jpeg;base64,${botProfile.avatarJpegBase64})`,
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
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Team vocabulary</CardTitle>
            <CardDescription>
              Before transcription, these terms are sent to ElevenLabs so team
              and deal names are easier to recognize.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form
              action="/api/team/vocabulary"
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
              method="post"
            >
              <Input aria-label="Vocabulary term" name="term" placeholder="Term" />
              <Input
                aria-label="Vocabulary hint"
                name="hint"
                placeholder="Optional hint"
              />
              <Button type="submit">Add</Button>
            </form>
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
      </section>
    </AppShell>
  );
}
