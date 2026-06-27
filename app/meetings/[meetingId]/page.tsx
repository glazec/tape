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
import { getWorkspaceMeetingTranscript } from "@/lib/meeting-queries";

export const dynamic = "force-dynamic";

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ meetingId: string }>;
}) {
  const user = await requireCurrentUser();
  const { meetingId } = await params;
  const meeting = await getWorkspaceMeetingTranscript(user, meetingId);

  if (!meeting) {
    notFound();
  }

  const displayStatus = getMeetingDisplayStatus({
    meetingStatus: meeting.status,
    transcriptJobStatus: meeting.transcriptJobStatus,
  });

  return (
    <AppShell activeHref="/dashboard">
      <div className="grid min-w-0 gap-8 lg:grid-cols-[1fr_18rem]">
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
            <MeetingTitleEditor
              meetingId={meetingId}
              meetingTitle={meeting.title}
            />
            <MeetingActions meetingId={meetingId} />
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
                Meeting ID
              </dt>
              <dd className="mt-1 min-w-0 break-all text-sm font-semibold">
                {meetingId}
              </dd>
            </div>
          </dl>
          <Separator />
          <div className="mt-8">
            <TranscriptViewer
              audioUrl={meeting.audioUrl}
              key={`${meetingId}:${displayStatus}:${meeting.segments.length}`}
              meetingId={meetingId}
              segments={meeting.segments}
            />
          </div>
        </section>

        <aside className="min-w-0 lg:pt-24">
          <ShareDialog meetingId={meetingId} />
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
