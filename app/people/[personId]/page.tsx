import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PersonPageView } from "@/components/person-page-view";
import { requireCurrentUser } from "@/lib/auth-guards";
import { getPersonWorkspace, getPersonPage } from "@/lib/people";
import { getStoredPersonProfile } from "@/lib/person-profile";
import { getUserLanguage } from "@/lib/user-language";

export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ personId: string }> }) {
  const [user, { personId }] = await Promise.all([requireCurrentUser(), params]);
  const workspace = await getPersonWorkspace(user, personId);
  const language = await getUserLanguage(workspace.userId);
  const lookup = await getPersonPage(workspace, personId, language);
  if (lookup.kind === "merged") redirect(`/people/${lookup.personId}`);
  if (lookup.kind === "missing") notFound();
  const profile = await getStoredPersonProfile(workspace, lookup.data.person.id);

  return (
    <AppShell
      activeHref="/dashboard"
      amplitudeTeamId={workspace.teamId}
      canCreateMeetings={workspace.canCreateMeetings !== false}
      oneSignalExternalId={workspace.userId}
    >
      <PersonPageView data={lookup.data} profile={profile} />
    </AppShell>
  );
}
