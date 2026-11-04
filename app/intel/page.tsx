import { AppShell } from "@/components/app-shell";
import { IntelSearch } from "@/components/intel-search";
import { requireCurrentUser } from "@/lib/auth-guards";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";
export const dynamic = "force-dynamic";
export default async function IntelPage() {
  const user = await requireCurrentUser();
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  return <AppShell activeHref="/intel" wide amplitudeTeamId={workspace.teamId} oneSignalExternalId={workspace.userId} canCreateMeetings={workspace.canCreateMeetings !== false}>
    <IntelSearch key={workspace.teamId + workspace.userId} />
  </AppShell>;
}
