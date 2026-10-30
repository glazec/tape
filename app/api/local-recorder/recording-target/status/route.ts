import { z } from "zod";
import { getLocalRecorderDeviceRequestContext } from "@/lib/local-recorder-auth";
import { getLocalRecorderRecordingTargetStatus, LocalRecorderTargetError } from "@/lib/local-recorder-targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await getLocalRecorderDeviceRequestContext(request);
  if (!context.ok) return Response.json({ error: context.error }, { status: context.status });
  const parsed = z.object({ fallbackIntentId: z.string().trim().min(1).max(200) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid recording target" }, { status: 400 });
  try {
    const result = await getLocalRecorderRecordingTargetStatus({ ...parsed.data, deviceId: context.deviceId, workspace: context.workspace });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof LocalRecorderTargetError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Recording status failed", error);
    return Response.json({ error: "Recording status unavailable" }, { status: 500 });
  }
}
