import { z } from "zod";

import { getLocalRecorderDeviceRequestContext } from "@/lib/local-recorder-auth";
import {
  createRecallDesktopSdkUploadForLocalRecorder,
  LocalRecorderUploadError,
} from "@/lib/local-recorder-records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sdkUploadRequestSchema = z.strictObject({
  clientRecordingId: z.string().trim().min(1),
  fallbackIntentId: z.string().trim().min(1),
});

export async function POST(request: Request) {
  const deviceContext = await getLocalRecorderDeviceRequestContext(request);

  if (!deviceContext.ok) {
    return Response.json(
      { error: deviceContext.error },
      { status: deviceContext.status },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = sdkUploadRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid Recall Desktop SDK upload request" },
      { status: 400 },
    );
  }

  try {
    const result = await createRecallDesktopSdkUploadForLocalRecorder({
      ...parsed.data,
      deviceId: deviceContext.deviceId,
      requestUrl: request.url,
      workspace: deviceContext.workspace,
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof LocalRecorderUploadError) {
      return Response.json({ error: error.message }, { status: 409 });
    }

    return Response.json(
      { error: "Recall Desktop SDK upload unavailable" },
      { status: 500 },
    );
  }
}
