import { notFound } from "next/navigation";

import { MobileMeetingRecorder } from "@/components/mobile-meeting-recorder";
import { requireCurrentUser } from "@/lib/auth-guards";
import { getMeetingTranscriptForWorkspace } from "@/lib/meeting-queries";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function MobileMeetingRecorderPage({
  params,
}: {
  params: Promise<{ meetingId: string }>;
}) {
  const [user, { meetingId }] = await Promise.all([
    requireCurrentUser(),
    params,
  ]);
  const workspace = await getOrCreateWorkspaceForSessionUser(user, { meetingId });
  const meeting = await getMeetingTranscriptForWorkspace(workspace, meetingId);

  if (!meeting?.canManage) {
    notFound();
  }

  return (
    <MobileMeetingRecorder
      meetingId={meeting.id}
      meetingTitle={meeting.title}
    />
  );
}
