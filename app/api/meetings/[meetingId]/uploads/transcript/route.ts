import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth";
import {
  assertCanManageMeeting,
  completeManualTranscriptUpload,
  MeetingRecoveryUploadError,
} from "@/lib/meeting-recovery-uploads";
import {
  assertRequestRateLimit,
  requestRateLimitErrorResponse,
  requestRateLimitPolicies,
} from "@/lib/request-rate-limit";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";
const MAX_MANUAL_TRANSCRIPT_BYTES = 10_000_000;

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
    await assertRequestRateLimit({
      ...requestRateLimitPolicies.recoveryTranscriptUpload,
      subject: `${workspace.teamId}:${workspace.userId}`,
    });
    const contentLength = Number(request.headers.get("content-length"));

    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_MANUAL_TRANSCRIPT_BYTES + 100_000
    ) {
      return Response.json(
        { error: "Transcript file must be 10 MB or smaller" },
        { status: 413 },
      );
    }

    const formData = await request.formData().catch(() => null);
    const transcriptText = await getTranscriptText(formData);

    if (!transcriptText) {
      return Response.json(
        { error: "Transcript text is required" },
        { status: 400 },
      );
    }

    const result = await completeManualTranscriptUpload({
      meetingId,
      transcriptText,
      workspace,
    });

    revalidatePath("/dashboard");
    revalidatePath(`/meetings/${meetingId}`);

    return Response.json(
      {
        meetingId,
        ready: true,
        segmentCount: result.segmentCount,
      },
      { status: 202 },
    );
  } catch (error) {
    const rateLimitResponse = requestRateLimitErrorResponse(error);

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    if (error instanceof MeetingRecoveryUploadError) {
      return Response.json({ error: error.message }, { status: 403 });
    }

    return Response.json(
      { error: "Transcript upload unavailable" },
      { status: 500 },
    );
  }
}

async function getTranscriptText(formData: FormData | null) {
  const transcriptText = formData?.get("transcriptText");

  if (typeof transcriptText === "string" && transcriptText.trim()) {
    const normalized = transcriptText.trim();

    return Buffer.byteLength(normalized) <= MAX_MANUAL_TRANSCRIPT_BYTES
      ? normalized
      : null;
  }

  const transcriptFile = formData?.get("transcript-file");

  if (
    !(transcriptFile instanceof File) ||
    transcriptFile.size === 0 ||
    transcriptFile.size > MAX_MANUAL_TRANSCRIPT_BYTES
  ) {
    return null;
  }

  return (await transcriptFile.text()).trim() || null;
}
