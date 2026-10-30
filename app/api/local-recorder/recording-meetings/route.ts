import { z } from "zod";
import { getLocalRecorderDeviceRequestContext } from "@/lib/local-recorder-auth";
import { listLocalRecorderRecordingMeetings } from "@/lib/local-recorder-targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getLocalRecorderDeviceRequestContext(request);
  if (!context.ok) return Response.json({ error: context.error }, { status: context.status });
  const params = new URL(request.url).searchParams;
  const parsed = z.object({ q: z.string().max(500), offset: z.coerce.number().int().min(0).max(1_000_000) })
    .safeParse({ q: params.get("q") ?? "", offset: params.get("offset") ?? 0 });
  if (!parsed.success) return Response.json({ error: "Invalid meeting search" }, { status: 400 });
  const result = await listLocalRecorderRecordingMeetings({ workspace: context.workspace, query: parsed.data.q, offset: parsed.data.offset });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
