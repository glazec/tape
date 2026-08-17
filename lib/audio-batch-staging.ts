import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  buildPendingUploadObjectKey,
  createUploadUrl,
  putObject,
} from "@/lib/r2";
import {
  getSupportedUploadMedia,
  getUploadMediaFromFile,
  isUploadMediaSizeAllowed,
  MAX_AUDIO_BATCH_FILES,
} from "@/lib/upload-media";

export const audioBatchSignSchema = z.strictObject({
  files: z
    .array(
      z.strictObject({
        contentType: z.string().trim().toLowerCase().min(1),
        extension: z.string().trim().toLowerCase().min(1),
        fileSize: z.number().int().positive(),
      }),
    )
    .min(2)
    .max(MAX_AUDIO_BATCH_FILES),
});

export class AudioBatchStagingError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AudioBatchStagingError";
    this.status = status;
  }
}

export async function createAudioBatchUploadUrls(input: {
  files: z.infer<typeof audioBatchSignSchema>["files"];
  userId: string;
}) {
  return Promise.all(
    input.files.map(async (file) => {
      const media = getSupportedUploadMedia(file);

      if (!media || media.kind !== "audio") {
        throw new AudioBatchStagingError("Invalid audio batch", 400);
      }

      if (!isUploadMediaSizeAllowed(file.fileSize)) {
        throw new AudioBatchStagingError(
          "Each recording file must be 1 GB or smaller",
          413,
        );
      }

      const uploadId = randomUUID();
      const objectKey = buildPendingUploadObjectKey({
        extension: media.extension,
        uploadId,
        userId: input.userId,
      });
      const uploadUrl = await createUploadUrl({
        contentType: media.contentType,
        key: objectKey,
      });

      return { uploadId, uploadUrl };
    }),
  );
}

export async function stageAudioBatchFormData(input: {
  formData: FormData;
  userId: string;
}) {
  const files = input.formData
    .getAll("meeting-audio")
    .filter((value): value is File => value instanceof File);

  if (files.length !== 1) {
    throw new AudioBatchStagingError("Invalid audio batch", 400);
  }

  return Promise.all(
    files.map(async (file) => {
      const media = getUploadMediaFromFile(file);

      if (!media || media.kind !== "audio" || file.size === 0) {
        throw new AudioBatchStagingError("Invalid audio batch", 400);
      }

      if (!isUploadMediaSizeAllowed(file.size)) {
        throw new AudioBatchStagingError(
          "Each recording file must be 1 GB or smaller",
          413,
        );
      }

      const uploadId = randomUUID();
      const objectKey = buildPendingUploadObjectKey({
        extension: media.extension,
        uploadId,
        userId: input.userId,
      });

      await putObject({
        body: new Uint8Array(await file.arrayBuffer()),
        contentType: media.contentType,
        key: objectKey,
      });

      return { uploadId };
    }),
  );
}
