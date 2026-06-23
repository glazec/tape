import { AppShell } from "@/components/app-shell";
import { ShareDialog } from "@/components/share-dialog";
import {
  TranscriptViewer,
  type TranscriptSegment,
} from "@/components/transcript-viewer";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { requireCurrentUser } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

const transcript: TranscriptSegment[] = [
  {
    id: "s1",
    speaker: "Maya",
    startMs: 0,
    text: "The main decision is to keep transcript access tied to workspace membership before we open external sharing.",
  },
  {
    id: "s2",
    speaker: "Jon",
    startMs: 18400,
    text: "Search should stay lightweight for now. Tokenizing the query is enough until we have the storage layer in place.",
  },
  {
    id: "s3",
    speaker: "Priya",
    startMs: 42600,
    text: "For uploads, the visible flow can collect the file and meeting link, but there should be no vendor call from this screen yet.",
  },
  {
    id: "s4",
    speaker: null,
    startMs: 67300,
    text: "Follow up on share link revocation copy before the next access review.",
  },
];

const meeting = {
  title: "Weekly product review",
  platform: "Google Meet",
  status: "Ready",
};

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ meetingId: string }>;
}) {
  await requireCurrentUser();

  const { meetingId } = await params;

  return (
    <AppShell>
      <div className="grid min-w-0 gap-8 lg:grid-cols-[1fr_18rem]">
        <section className="min-w-0">
          <p className="text-sm font-medium uppercase tracking-normal text-primary">
            Meeting
          </p>
          <h1 className="mt-3 text-3xl font-semibold">{meeting.title}</h1>
          <dl className="mt-5 grid gap-4 py-4 sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
                Platform
              </dt>
              <dd className="mt-1 text-sm font-semibold">{meeting.platform}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
                Status
              </dt>
              <dd className="mt-1">
                <Badge>{meeting.status}</Badge>
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
            <TranscriptViewer segments={transcript} />
          </div>
        </section>

        <aside className="min-w-0 lg:pt-24">
          <ShareDialog meetingId={meetingId} />
        </aside>
      </div>
    </AppShell>
  );
}
