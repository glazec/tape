import { getLocalRecorderDeviceRequestContext } from "@/lib/local-recorder-auth";
import { markRecallDesktopSdkFallback } from "@/lib/local-recorder-records";

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
  const fallbackIntentId = getRequiredString(body, "fallbackIntentId");

  if (!fallbackIntentId) {
    return Response.json(
      { error: "Invalid Recall Desktop SDK fallback request" },
      { status: 400 },
    );
  }

  const result = await markRecallDesktopSdkFallback({
    deviceId: deviceContext.deviceId,
    fallbackIntentId,
    workspace: deviceContext.workspace,
  });

  return Response.json(result, { status: result.marked ? 200 : 409 });
}

function getRequiredString(value: unknown, key: string) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];

  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}
