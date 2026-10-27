import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { NewMeetingSources } from "@/components/new-meeting-sources";
import { requireCurrentUser } from "@/lib/auth-guards";
import {
  getOrCreateWorkspaceForSessionUser,
  getWorkspaceAccessSummary,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function NewMeetingPage() {
  const user = await requireCurrentUser();
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const accessSummary = await getWorkspaceAccessSummary(workspace);

  if (!accessSummary.canCreateMeetings) {
    redirect("/dashboard");
  }

  return (
    <AppShell
      activeHref="/meetings/new"
      amplitudeTeamId={workspace.teamId}
      oneSignalExternalId={workspace.userId}
    >
      <section className="mx-auto flex w-full max-w-xl flex-col gap-6 sm:pt-6">
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">
          Add a meeting
        </h1>

        <NewMeetingSources />
      </section>
    </AppShell>
  );
}
