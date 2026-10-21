import { db } from "@/db/client";
import { meetings } from "@/db/schema";
import { getManageableMeetingCondition } from "@/lib/meeting-write-policy";
import type { WorkspaceContext } from "@/lib/workspace";

export class MeetingRecoveryUploadError extends Error {}

export async function assertCanManageMeeting(
  workspace: WorkspaceContext,
  meetingId: string,
) {
  const [meeting] = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(getManageableMeetingCondition(workspace, meetingId))
    .limit(1);

  if (!meeting) throw new MeetingRecoveryUploadError("Meeting not found");
}
