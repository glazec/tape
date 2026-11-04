import { getLocalRecorderDeviceRequestContext } from "@/lib/local-recorder-auth";
import { authorizeLocalRecorderMultipartUpload, LocalRecorderUploadError } from "@/lib/local-recorder-records";
import { recorderMultipartSchema, recorderMultipartUpload, RecorderMultipartConflict } from "@/lib/local-recorder-multipart";
import { assertWorkspaceHasProviderCredit, providerCreditErrorResponse } from "@/lib/provider-credit";
import { assertRequestRateLimit, requestRateLimitErrorResponse, requestRateLimitPolicies } from "@/lib/request-rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = await getLocalRecorderDeviceRequestContext(request);
  if (!context.ok) return Response.json({ error: context.error }, { status: context.status });
  const parsed = recorderMultipartSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid recording upload request" }, { status: 400 });
  try {
    await assertWorkspaceHasProviderCredit(context.workspace);
    if (parsed.data.action === "start") {
      await assertRequestRateLimit({
        ...(parsed.data.role.startsWith("screenshot:")
          ? { limit: 120, scope: "local_recorder_screenshots", windowMs: 60_000 }
          : requestRateLimitPolicies.localRecorderProviderUpload),
        subject: `${context.workspace.teamId}:${context.workspace.userId}` });
    }
    const attempt = await authorizeLocalRecorderMultipartUpload({
      ...parsed.data, recordingStartedAt: new Date(parsed.data.recordingStartedAt),
      deviceId: context.deviceId, workspace: context.workspace,
    });
    return Response.json(await recorderMultipartUpload(parsed.data, {
      attemptId: attempt.id, meetingId: attempt.meetingId, teamId: context.workspace.teamId,
    }));
  } catch (error) {
    const response = requestRateLimitErrorResponse(error) ?? providerCreditErrorResponse(error);
    if (response) return response;
    if (error instanceof LocalRecorderUploadError || error instanceof RecorderMultipartConflict)
      return Response.json({ error: error.message }, { status: 409 });
    return Response.json({ error: "Recording upload temporarily unavailable" }, { status: 503 });
  }
}
