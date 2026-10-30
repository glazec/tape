import { z } from "zod";
import { getLocalRecorderDeviceRequestContext } from "@/lib/local-recorder-auth";
import { LocalRecorderTargetError, setLocalRecorderRecordingTarget } from "@/lib/local-recorder-targets";
import { assertWorkspaceHasProviderCredit, providerCreditErrorResponse } from "@/lib/provider-credit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({
  fallbackIntentId: z.string().trim().min(1).max(200).optional(),
  meetingId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(500).optional(),
}).refine((value) => !(value.meetingId && value.title));

export async function POST(request: Request) {
  const context = await getLocalRecorderDeviceRequestContext(request);
  if (!context.ok) return Response.json({ error: context.error }, { status: context.status });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid recording target" }, { status: 400 });
  try {
    await assertWorkspaceHasProviderCredit(context.workspace);
    return Response.json(await setLocalRecorderRecordingTarget({
      ...parsed.data, deviceId: context.deviceId, workspace: context.workspace, now: new Date(),
    }));
  } catch (error) {
    const creditResponse = providerCreditErrorResponse(error);
    if (creditResponse) return creditResponse;
    if (error instanceof LocalRecorderTargetError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Recording target failed", error);
    return Response.json({ error: "Recording target unavailable" }, { status: 500 });
  }
}
