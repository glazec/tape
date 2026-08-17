import type { UploadMedia } from "@/lib/upload-media";

export type BrowserAudioBatchFile = {
  durationMs: number;
  file: File;
  uploadMedia: UploadMedia;
};

export type BrowserAudioBatchResult = {
  delayedCount?: number;
  meetingId?: string;
  redirectTo?: string;
};

export class AudioBatchSignInRequiredError extends Error {}
class AudioBatchPreparationRejectedError extends Error {}

export async function uploadAudioBatch(input: {
  completePath: string;
  files: BrowserAudioBatchFile[];
  signPath?: string;
  stagePath?: string;
  startedAt?: string;
}) {
  const uploads: Array<{ uploadId: string }> = [];

  try {
    const signResponse = await fetch(
      input.signPath ?? "/api/uploads/audio/batch/sign",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          files: input.files.map((file) => ({
            contentType: file.uploadMedia.contentType,
            extension: file.uploadMedia.extension,
            fileSize: file.file.size,
          })),
        }),
      },
    );

    if (signResponse.status === 401) {
      throw new AudioBatchSignInRequiredError();
    }

    if (!signResponse.ok) {
      if (signResponse.status >= 400 && signResponse.status < 500) {
        const body = (await signResponse.json().catch(() => null)) as {
          error?: string;
        } | null;

        throw new AudioBatchPreparationRejectedError(
          body?.error ?? "Audio upload could not be prepared",
        );
      }

      throw new Error("Audio upload could not be prepared");
    }

    const signed = (await signResponse.json().catch(() => null)) as {
      uploads?: Array<{ uploadId?: string; uploadUrl?: string }>;
    } | null;

    if (signed?.uploads?.length !== input.files.length) {
      throw new Error("Audio upload could not be prepared");
    }

    for (const [index, file] of input.files.entries()) {
      const upload = signed.uploads[index];

      if (!upload?.uploadId || !upload.uploadUrl) {
        throw new Error("Audio upload could not be prepared");
      }

      const uploadResponse = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.uploadMedia.contentType },
        body: file.file,
      });

      if (!uploadResponse.ok) {
        throw new Error("Audio upload failed");
      }

      uploads.push({ uploadId: upload.uploadId });
    }
  } catch (error) {
    if (
      error instanceof AudioBatchSignInRequiredError ||
      error instanceof AudioBatchPreparationRejectedError
    ) {
      throw error;
    }

    for (const file of input.files.slice(uploads.length)) {
      const formData = new FormData();
      formData.set("meeting-audio", file.file);
      const stageResponse = await fetch(
        input.stagePath ?? "/api/uploads/audio/batch",
        { method: "POST", body: formData },
      );

      if (stageResponse.status === 401) {
        throw new AudioBatchSignInRequiredError();
      }

      if (!stageResponse.ok) {
        throw new Error("Audio upload failed");
      }

      const staged = (await stageResponse.json().catch(() => null)) as {
        uploads?: Array<{ uploadId?: string }>;
      } | null;
      const uploadId = staged?.uploads?.[0]?.uploadId;

      if (!uploadId || staged?.uploads?.length !== 1) {
        throw new Error("Audio upload failed");
      }

      uploads.push({ uploadId });
    }
  }

  const stagedFiles = input.files.map((file, index) => ({
    contentType: file.uploadMedia.contentType,
    durationMs: file.durationMs,
    extension: file.uploadMedia.extension,
    fileName: file.file.name,
    uploadId: uploads[index]!.uploadId,
  }));

  const completeResponse = await fetch(input.completePath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      files: stagedFiles,
      ...(input.startedAt ? { startedAt: input.startedAt } : {}),
    }),
  });

  if (completeResponse.status === 401) {
    throw new AudioBatchSignInRequiredError();
  }

  if (!completeResponse.ok) {
    const body = (await completeResponse.json().catch(() => null)) as {
      error?: string;
    } | null;

    throw new Error(body?.error ?? "Audio batch completion failed");
  }

  return (await completeResponse
    .json()
    .catch(() => ({}))) as BrowserAudioBatchResult;
}
