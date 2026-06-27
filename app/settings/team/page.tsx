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
import { listTeamVocabularyTerms } from "@/lib/team-vocabulary";
import {
  getOrCreateWorkspaceForSessionUser,
  getWorkspaceAccessSummary,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  const user = await requireCurrentUser();
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const accessSummary = await getWorkspaceAccessSummary(workspace);
  const vocabularyTerms = accessSummary.canCreateMeetings
    ? await listTeamVocabularyTerms(workspace.teamId)
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
