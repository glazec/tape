import {
  audioBatchSignSchema,
  createAudioBatchUploadUrls,
} from "@/lib/audio-batch-staging";
import { audioBatchRouteErrorResponse } from "@/lib/audio-batch-route";
import { getCurrentUser } from "@/lib/auth";
import { assertWorkspaceHasProviderCredit } from "@/lib/provider-credit";
import {
  assertRequestRateLimit,
  requestRateLimitPolicies,
} from "@/lib/request-rate-limit";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
} from "@/lib/workspace";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workspace = await getOrCreateWorkspaceForSessionUser(user);
    await assertCanCreateMeetings(workspace);
    await assertWorkspaceHasProviderCredit(workspace);
    const parsed = audioBatchSignSchema.safeParse(
      await request.json().catch(() => null),
    );

    if (!parsed.success) {
      return Response.json({ error: "Invalid audio batch" }, { status: 400 });
    }

    await assertRequestRateLimit({
      ...requestRateLimitPolicies.serverMediaUpload,
      cost: parsed.data.files.length,
      subject: `${workspace.teamId}:${workspace.userId}`,
    });

    return Response.json({
      uploads: await createAudioBatchUploadUrls({
        files: parsed.data.files,
        userId: user.id,
      }),
    });
  } catch (error) {
    return audioBatchRouteErrorResponse(error);
  }
}
