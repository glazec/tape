import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { MeetingAutoRefresh } from "@/components/meeting-auto-refresh";
import { MeetingActions } from "@/components/meeting-actions";
import { MeetingTitleEditor } from "@/components/meeting-title-editor";
import { ShareDialog } from "@/components/share-dialog";
import { TranscriptViewer } from "@/components/transcript-viewer";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { requireCurrentUser } from "@/lib/auth-guards";
import { getMeetingDisplayStatus } from "@/lib/meeting-display-status";
import {
  getMeetingTranscriptForWorkspace,
  listWorkspaceShareRecipients,
} from "@/lib/meeting-queries";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ meetingId: string }>;
}) {
  const user = await requireCurrentUser();
  const { meetingId } = await params;
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const [meeting, shareRecipients] = await Promise.all([
    getMeetingTranscriptForWorkspace(workspace, meetingId),
    listWorkspaceShareRecipients(workspace),
  ]);

  if (!meeting) {
    notFound();
  }

  const displayStatus = getMeetingDisplayStatus({
    meetingStatus: meeting.status,
    transcriptJobStatus: meeting.transcriptJobStatus,
  });

  return (
    <AppShell
      activeHref="/dashboard"
      canCreateMeetings={meeting.accessScope === "workspace"}
    >
      <div className="grid min-w-0 gap-8 lg:grid-cols-[1fr_20rem]">
        <section className="min-w-0">
          <MeetingAutoRefresh
            meetingStatus={meeting.status}
            segmentCount={meeting.segments.length}
            transcriptJobStatus={meeting.transcriptJobStatus}
          />
          <p className="text-sm font-medium uppercase tracking-normal text-primary">
            Meeting
          </p>
          <div className="mt-3 flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            {meeting.accessScope === "workspace" ? (
              <MeetingTitleEditor
                meetingId={meetingId}
                meetingTitle={meeting.title}
              />
            ) : (
              <h1 className="break-words text-3xl font-semibold">
                {meeting.title}
              </h1>
            )}
            {meeting.accessScope === "workspace" ? (
              <MeetingActions meetingId={meetingId} />
            ) : null}
          </div>
          <dl className="mt-5 grid gap-4 py-4 sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
                Platform
              </dt>
              <dd className="mt-1 text-sm font-semibold">
                {formatPlatform(meeting.platform)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
                Status
              </dt>
              <dd className="mt-1">
                <Badge>{formatStatus(displayStatus)}</Badge>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
                Access
              </dt>
              <dd className="mt-1 text-sm font-semibold">
                {meeting.accessScope === "workspace"
                  ? "Organization"
                  : "Shared with you"}
              </dd>
            </div>
          </dl>
          <Separator />
          <div className="mt-8">
            <TranscriptViewer
              audioUrl={meeting.audioUrl}
              key={`${meetingId}:${displayStatus}:${meeting.segments.length}`}
              meetingId={
                meeting.accessScope === "workspace" ? meetingId : null
              }
              segments={meeting.segments}
              speakerSuggestions={meeting.speakerSuggestions}
            />
          </div>
        </section>

        <aside className="min-w-0 lg:pt-24">
          {meeting.accessScope === "workspace" ? (
            <ShareDialog
              meetingId={meetingId}
              organizationDomain={workspace.domain}
              teamMembers={shareRecipients}
            />
          ) : (
            <div className="rounded-lg border bg-card p-5">
              <p className="text-sm font-semibold">Shared transcript</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                You can read this transcript. Adding meetings and sharing stay
                with the workspace owner.
              </p>
            </div>
          )}
        </aside>
      </div>
    </AppShell>
  );
}

function formatPlatform(platform: string) {
  if (platform === "google_meet") {
    return "Google Meet";
  }

  if (platform === "zoom") {
    return "Zoom";
  }

  return "Upload";
}

function formatStatus(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
