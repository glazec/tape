import { getLocalRecorderDeviceRequestContext } from "@/lib/local-recorder-auth";
import {
  LocalRecorderUploadError,
  prepareLocalRecorderRecordingUpload,
} from "@/lib/local-recorder-records";
import { parseLocalRecorderUploadPrepareRequest } from "@/lib/local-recorder-upload-request";
import {
  assertWorkspaceHasProviderCredit,
  providerCreditErrorResponse,
} from "@/lib/provider-credit";
import {
  assertRequestRateLimit,
  requestRateLimitErrorResponse,
  requestRateLimitPolicies,
} from "@/lib/request-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const deviceContext = await getLocalRecorderDeviceRequestContext(request);

  if (!deviceContext.ok) {
    return Response.json(
      { error: deviceContext.error },
      { status: deviceContext.status },
    );
  }

  try {
    await assertWorkspaceHasProviderCredit(deviceContext.workspace);
    await assertRequestRateLimit({
      ...requestRateLimitPolicies.localRecorderProviderUpload,
      subject: `${deviceContext.workspace.teamId}:${deviceContext.workspace.userId}`,
    });
    const body = await request.json().catch(() => null);
    const parsed = parseLocalRecorderUploadPrepareRequest(body);

    if (!parsed.ok) {
      return Response.json(
        { error: "Invalid local recording preparation" },
        { status: 400 },
      );
    }

    const result = await prepareLocalRecorderRecordingUpload({
      ...parsed.value,
      deviceId: deviceContext.deviceId,
      workspace: deviceContext.workspace,
    });

    return Response.json(result);
  } catch (error) {
    const rateLimitResponse = requestRateLimitErrorResponse(error);

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const creditResponse = providerCreditErrorResponse(error);

    if (creditResponse) {
      return creditResponse;
    }

    if (error instanceof LocalRecorderUploadError) {
      return Response.json({ error: error.message }, { status: 409 });
    }

    return Response.json(
      { error: "Local recording preparation unavailable" },
      { status: 500 },
    );
  }
}
