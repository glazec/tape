import { getLocalRecorderDeviceRequestContext } from "@/lib/local-recorder-auth";
import {
  authorizeLocalRecorderNotification,
  markLocalRecorderNotificationDelivered,
} from "@/lib/local-recorder-records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ fallbackIntentId: string }> },
) {
  const deviceContext = await getLocalRecorderDeviceRequestContext(request);

  if (!deviceContext.ok) {
    return Response.json(
      { error: deviceContext.error },
      { status: deviceContext.status },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const state =
    body && typeof body === "object" && "state" in body
      ? (body as { state?: unknown }).state
      : null;
  const { fallbackIntentId } = await context.params;
  const input = {
    deviceId: deviceContext.deviceId,
    fallbackIntentId,
    now: new Date(),
    workspace: deviceContext.workspace,
  };

  if (state === "ready") {
    return Response.json(await authorizeLocalRecorderNotification(input));
  }

  if (state === "shown") {
    const result = await markLocalRecorderNotificationDelivered(input);

    return Response.json(result, { status: result.marked ? 200 : 409 });
  }

  return Response.json({ error: "Invalid notification state" }, { status: 400 });
}
