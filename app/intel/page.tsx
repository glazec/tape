import { AppShell } from "@/components/app-shell";
import { IntelSearch } from "@/components/intel-search";
import { requireCurrentUser } from "@/lib/auth-guards";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";
import { IntelCapacityError } from "@/lib/intel/content";
import { buildCatalog } from "@/lib/intel/provenance";
import { loadIntelMeetings, loadIntelHistory } from "@/lib/intel/store";
export const dynamic = "force-dynamic";
export default async function IntelPage() {
  const user = await requireCurrentUser();
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  let corpus;
  try { corpus = await loadIntelMeetings(workspace); }
  catch (error) {
    if (!(error instanceof IntelCapacityError)) throw error;
    return <AppShell activeHref="/intel" wide amplitudeTeamId={workspace.teamId} oneSignalExternalId={workspace.userId} canCreateMeetings={workspace.canCreateMeetings !== false}>
      <section className="mx-auto max-w-xl py-16">
        <h1 className="text-2xl font-semibold">Intel is unavailable for this collection</h1>
        <p className="mt-4 text-muted-foreground">{error.message}</p>
        <p className="mt-3 text-muted-foreground">Your meetings remain available. Search has not run, and no partial results are shown.</p>
      </section>
    </AppShell>;
  }
  const catalog = buildCatalog(corpus);
  const history = await loadIntelHistory(workspace, corpus);
  return <AppShell activeHref="/intel" wide amplitudeTeamId={workspace.teamId} oneSignalExternalId={workspace.userId} canCreateMeetings={workspace.canCreateMeetings !== false}>
    <IntelSearch catalog={catalog} initialHistory={history} />
  </AppShell>;
}
