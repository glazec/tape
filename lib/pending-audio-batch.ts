import { z } from "zod";

import { MAX_RECORDING_DURATION_MS } from "@/lib/recording-duration";
import {
  buildPendingUploadObjectKey,
  deleteObject,
  getObjectMetadata,
} from "@/lib/r2";
import {
  getSupportedUploadMedia,
  isUploadMediaSizeAllowed,
  MAX_AUDIO_BATCH_FILES,
} from "@/lib/upload-media";

export const pendingAudioBatchSchema = z.strictObject({
  files: z
    .array(
      z.strictObject({
        contentType: z.string().trim().toLowerCase().min(1),
        durationMs: z.number().int().positive().max(MAX_RECORDING_DURATION_MS),
        extension: z.string().trim().toLowerCase().min(1),
        fileName: z.string().trim().min(1).max(512),
        uploadId: z.string().min(1),
      }),
    )
    .min(2)
    .max(MAX_AUDIO_BATCH_FILES)
    .superRefine((files, context) => {
      const uploadIds = new Set<string>();
      const totalDurationMs = files.reduce(
        (total, file) => total + file.durationMs,
        0,
      );

      if (totalDurationMs > MAX_RECORDING_DURATION_MS) {
        context.addIssue({
          code: "custom",
          message: "Combined recording duration exceeds the meeting limit",
        });
      }

      files.forEach((file, index) => {
        if (uploadIds.has(file.uploadId)) {
          context.addIssue({
            code: "custom",
            message: "Each staged upload can only appear once",
            path: [index, "uploadId"],
          });
        }

        uploadIds.add(file.uploadId);
      });
    }),
  startedAt: z.iso.datetime().optional(),
});

export class PendingAudioBatchError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PendingAudioBatchError";
    this.status = status;
  }
}

export async function resolvePendingAudioBatch(input: {
  files: z.infer<typeof pendingAudioBatchSchema>["files"];
  userId: string;
}) {
  return Promise.all(
    input.files.map(async (file) => {
      const uploadMedia = getSupportedUploadMedia({
        contentType: file.contentType,
        extension: file.extension,
      });

      if (!uploadMedia || uploadMedia.kind !== "audio") {
        throw new PendingAudioBatchError("Invalid audio batch", 400);
      }

      const objectKey = buildPendingUploadObjectKey({
        extension: uploadMedia.extension,
        uploadId: file.uploadId,
        userId: input.userId,
      });
      const metadata = await getObjectMetadata({ key: objectKey });
      const fileSizeBytes = metadata.contentLength;

      if (!isUploadMediaSizeAllowed(fileSizeBytes)) {
        try {
          await deleteObject({ key: objectKey });
        } catch {
          // Reject the batch even when best-effort object cleanup is unavailable.
        }

        throw new PendingAudioBatchError(
          "Each recording file must be 1 GB or smaller",
          413,
        );
      }

      if (
        metadata.contentType &&
        metadata.contentType.toLowerCase() !== uploadMedia.contentType
      ) {
        throw new PendingAudioBatchError("Invalid audio batch", 400);
      }

      return {
        durationMs: file.durationMs,
        fileName: file.fileName,
        fileSizeBytes: fileSizeBytes as number,
        mimeType: metadata.contentType ?? uploadMedia.contentType,
        objectKey,
      };
    }),
  );
}
