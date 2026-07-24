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

  const body = await request.json().catch(() => null);
  const parsed = parseLocalRecorderUploadPrepareRequest(body);

  if (!parsed.ok) {
    return Response.json(
      { error: "Invalid local recording preparation" },
      { status: 400 },
    );
  }

  try {
    await assertWorkspaceHasProviderCredit(deviceContext.workspace);
    const result = await prepareLocalRecorderRecordingUpload({
      ...parsed.value,
      deviceId: deviceContext.deviceId,
      workspace: deviceContext.workspace,
    });

    return Response.json(result);
  } catch (error) {
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
