import { AppShell } from "@/components/app-shell";
import { IntelSearch } from "@/components/intel-search";
import { requireCurrentUser } from "@/lib/auth-guards";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";
import { buildCatalog } from "@/lib/intel/provenance";
import { loadIntelMeetings, loadIntelHistory } from "@/lib/intel/store";
export const dynamic = "force-dynamic";
export default async function IntelPage() {
  const user = await requireCurrentUser();
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const corpus = await loadIntelMeetings(workspace);
  const catalog = buildCatalog(corpus);
  const history = await loadIntelHistory(workspace, corpus);
  return <AppShell activeHref="/intel" wide amplitudeTeamId={workspace.teamId} oneSignalExternalId={workspace.userId} canCreateMeetings={workspace.canCreateMeetings !== false}>
    <IntelSearch catalog={catalog} initialHistory={history} />
  </AppShell>;
}
