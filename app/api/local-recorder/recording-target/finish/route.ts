import { z } from "zod";
import { getLocalRecorderDeviceRequestContext } from "@/lib/local-recorder-auth";
import { finishLocalRecorderRecordingTarget, LocalRecorderTargetError } from "@/lib/local-recorder-targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await getLocalRecorderDeviceRequestContext(request);
  if (!context.ok) return Response.json({ error: context.error }, { status: context.status });
  const parsed = z.object({ fallbackIntentId: z.string().trim().min(1).max(200) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid recording target" }, { status: 400 });
  try {
    return Response.json(await finishLocalRecorderRecordingTarget({ ...parsed.data, deviceId: context.deviceId, workspace: context.workspace }));
  } catch (error) {
    if (error instanceof LocalRecorderTargetError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Recording finish failed", error);
    return Response.json({ error: "Recording finish unavailable" }, { status: 500 });
  }
}
