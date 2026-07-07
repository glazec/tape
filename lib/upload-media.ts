export type UploadMediaKind = "audio" | "video";

export type UploadMedia = {
  extension: string;
  contentType: string;
  kind: UploadMediaKind;
};

export const supportedUploadMedia = [
  { extension: "mp3", contentType: "audio/mpeg", kind: "audio" },
  { extension: "m4a", contentType: "audio/mp4", kind: "audio" },
  { extension: "m4a", contentType: "audio/x-m4a", kind: "audio" },
  { extension: "mp4", contentType: "video/mp4", kind: "video" },
  { extension: "mov", contentType: "video/quicktime", kind: "video" },
  { extension: "webm", contentType: "video/webm", kind: "video" },
  { extension: "mkv", contentType: "video/x-matroska", kind: "video" },
] as const satisfies readonly UploadMedia[];

export const uploadMediaAccept = supportedUploadMedia
  .flatMap((media) => [media.contentType, `.${media.extension}`])
  .join(",");

export const audioUploadMediaAccept = supportedUploadMedia
  .filter((media) => media.kind === "audio")
  .flatMap((media) => [media.contentType, `.${media.extension}`])
  .join(",");

export function getSupportedUploadMedia(input: {
  extension: string;
  contentType: string;
}) {
  const extension = normalizeExtension(input.extension);
  const contentType = normalizeContentType(input.contentType);

  return (
    supportedUploadMedia.find(
      (media) =>
        media.extension === extension && media.contentType === contentType,
    ) ?? null
  );
}

export function getUploadMediaFromFile(file: File) {
  const extension = getFileExtension(file.name);

  if (!extension) {
    return null;
  }

  const candidates = supportedUploadMedia.filter(
    (media) => media.extension === extension,
  );

  if (candidates.length === 0) {
    return null;
  }

  const contentType = normalizeContentType(file.type);

  if (!contentType) {
    return candidates[0];
  }

  return candidates.find((media) => media.contentType === contentType) ?? null;
}

function getFileExtension(fileName: string) {
  const lastSegment = fileName.trim().split(/[\\/]/).pop() ?? "";
  const dotIndex = lastSegment.lastIndexOf(".");

  if (dotIndex < 0 || dotIndex === lastSegment.length - 1) {
    return null;
  }

  return normalizeExtension(lastSegment.slice(dotIndex + 1));
}

function normalizeExtension(value: string) {
  return value.trim().replace(/^\./, "").toLowerCase();
}

function normalizeContentType(value: string) {
  return value.trim().toLowerCase();
}
