import { SharedOnlyAccessError } from "@/lib/access-errors";
import { AudioBatchStagingError } from "@/lib/audio-batch-staging";
import { MeetingRecoveryUploadError } from "@/lib/meeting-recovery-uploads";
import { providerCreditErrorResponse } from "@/lib/provider-credit";
import {
  requestRateLimitErrorResponse,
} from "@/lib/request-rate-limit";
import { UnsafeObjectKeySegmentError } from "@/lib/r2";

export function audioBatchRouteErrorResponse(error: unknown) {
  const rateLimitResponse = requestRateLimitErrorResponse(error);

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const creditResponse = providerCreditErrorResponse(error);

  if (creditResponse) {
    return creditResponse;
  }

  if (error instanceof AudioBatchStagingError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof UnsafeObjectKeySegmentError) {
    return Response.json({ error: "Invalid audio batch" }, { status: 400 });
  }

  if (error instanceof SharedOnlyAccessError) {
    return Response.json({ error: error.message }, { status: 403 });
  }

  if (error instanceof MeetingRecoveryUploadError) {
    return Response.json({ error: error.message }, { status: 403 });
  }

  return Response.json(
    { error: "Audio batch upload unavailable" },
    { status: 500 },
  );
}
