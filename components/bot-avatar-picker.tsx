"use client";

import { useEffect, useId, useState } from "react";

/**
 * The bot avatar shown as itself, with Replace and Reset beside it, instead
 * of a bare file input. The chosen file previews before the form is saved.
 */
export function BotAvatarPicker({
  currentAvatarJpegBase64,
  isCustom,
}: {
  currentAvatarJpegBase64: string | null;
  isCustom: boolean;
}) {
  const inputId = useId();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [reset, setReset] = useState(false);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const imageUrl = reset
    ? null
    : (previewUrl ??
      (currentAvatarJpegBase64
        ? `data:image/jpeg;base64,${currentAvatarJpegBase64}`
        : null));

  return (
    <div className="flex items-center gap-4">
      <div
        aria-label="Current team meeting bot avatar"
        className="size-14 shrink-0 rounded-full border bg-muted bg-cover bg-center"
        role="img"
        style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
      />
      <div className="min-w-0 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <label
            className="cursor-pointer font-medium underline decoration-border underline-offset-4 hover:decoration-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring"
            htmlFor={inputId}
          >
            {isCustom || previewUrl ? "Replace" : "Upload JPG"}
            <input
              accept="image/jpeg"
              className="sr-only"
              id={inputId}
              name="avatar"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                setFileName(file?.name ?? null);
                setReset(false);
                setPreviewUrl(file ? URL.createObjectURL(file) : null);
              }}
              type="file"
            />
          </label>
          {isCustom ? (
            <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
              <input
                checked={reset}
                className="size-3.5"
                name="resetAvatar"
                onChange={(event) => setReset(event.currentTarget.checked)}
                type="checkbox"
              />
              Use default avatar
            </label>
          ) : null}
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {fileName
            ? `${fileName} · saves with the profile`
            : isCustom
              ? "Custom avatar · JPG under 1 MB"
              : "Default avatar · JPG under 1 MB"}
        </p>
      </div>
    </div>
  );
}
