export function titleFromUploadFileName(fileName: string) {
  const title = fileName
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.(mp3|m4a|mp4|mov|webm|mkv)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return title || "Uploaded audio";
}
