import { getLocalRecorderDeviceRequestContext } from "@/lib/local-recorder-auth";
import { createManualLocalRecorderIntent } from "@/lib/local-recorder-records";
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

  try {
    await assertWorkspaceHasProviderCredit(deviceContext.workspace);
    const result = await createManualLocalRecorderIntent({
      deviceId: deviceContext.deviceId,
      now: new Date(),
      workspace: deviceContext.workspace,
    });

    return Response.json(result);
  } catch (error) {
    const creditResponse = providerCreditErrorResponse(error);

    if (creditResponse) {
      return creditResponse;
    }

    throw error;
  }
}
