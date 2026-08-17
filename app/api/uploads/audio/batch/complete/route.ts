import { revalidatePath } from "next/cache";

import { SharedOnlyAccessError } from "@/lib/access-errors";
import { dispatchAudioBatchTranscriptions } from "@/lib/audio-batch-dispatch";
import { getCurrentUser } from "@/lib/auth";
import { createUploadedAudioBatch } from "@/lib/meeting-audio-batches";
import {
  pendingAudioBatchSchema,
  PendingAudioBatchError,
  resolvePendingAudioBatch,
} from "@/lib/pending-audio-batch";
import {
  assertWorkspaceHasProviderCredit,
  providerCreditErrorResponse,
} from "@/lib/provider-credit";
import {
  ObjectNotFoundError,
  UnsafeObjectKeySegmentError,
} from "@/lib/r2";
import { titleFromUploadFileName } from "@/lib/upload-titles";
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
    const parsed = pendingAudioBatchSchema.safeParse(
      await request.json().catch(() => null),
    );

    if (!parsed.success) {
      return Response.json({ error: "Invalid audio batch" }, { status: 400 });
    }

    const files = await resolvePendingAudioBatch({
      files: parsed.data.files,
      userId: user.id,
    });
    const result = await createUploadedAudioBatch({
      files,
      startedAt: parsed.data.startedAt
        ? new Date(parsed.data.startedAt)
        : new Date(),
      title: titleFromUploadFileName(files[0]?.fileName ?? "Uploaded audio"),
      workspace,
    });
    const dispatch = await dispatchAudioBatchTranscriptions(
      result.transcriptions,
    );

    revalidatePath("/dashboard");
    revalidatePath(`/meetings/${result.meetingId}`);

    return Response.json(
      {
        delayedCount: dispatch.delayedCount,
        meetingId: result.meetingId,
        queued: true,
        redirectTo: `/meetings/${result.meetingId}`,
      },
      { status: 202 },
    );
  } catch (error) {
    const creditResponse = providerCreditErrorResponse(error);

    if (creditResponse) {
      return creditResponse;
    }

    if (error instanceof PendingAudioBatchError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof ObjectNotFoundError) {
      return Response.json({ error: "Uploaded file not found" }, { status: 404 });
    }

    if (error instanceof UnsafeObjectKeySegmentError) {
      return Response.json({ error: "Invalid audio batch" }, { status: 400 });
    }

    if (error instanceof SharedOnlyAccessError) {
      return Response.json({ error: error.message }, { status: 403 });
    }

    return Response.json(
      { error: "Audio batch completion unavailable" },
      { status: 500 },
    );
  }
}
