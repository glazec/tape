import { stageAudioBatchFormData } from "@/lib/audio-batch-staging";
import { audioBatchRouteErrorResponse } from "@/lib/audio-batch-route";
import { getCurrentUser } from "@/lib/auth";
import { assertCanManageMeeting } from "@/lib/meeting-recovery-uploads";
import { assertWorkspaceHasProviderCredit } from "@/lib/provider-credit";
import {
  assertRequestRateLimit,
  requestRateLimitPolicies,
} from "@/lib/request-rate-limit";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";
import { MAX_UPLOAD_MEDIA_BYTES } from "@/lib/upload-media";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { meetingId } = await context.params;
    const workspace = await getOrCreateWorkspaceForSessionUser(user);
    await assertCanManageMeeting(workspace, meetingId);
    await assertWorkspaceHasProviderCredit(workspace);
    await assertRequestRateLimit({
      ...requestRateLimitPolicies.serverMediaBatchStage,
      subject: `${workspace.teamId}:${workspace.userId}`,
    });
    const contentLength = Number(request.headers.get("content-length"));

    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_UPLOAD_MEDIA_BYTES + 1_000_000
    ) {
      return Response.json(
        { error: "Recording file must be 1 GB or smaller" },
        { status: 413 },
      );
    }

    return Response.json({
      uploads: await stageAudioBatchFormData({
        formData: await request.formData(),
        userId: user.id,
      }),
    });
  } catch (error) {
    return audioBatchRouteErrorResponse(error);
  }
}
