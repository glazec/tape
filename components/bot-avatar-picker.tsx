"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Globe, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const AVATAR_SIZE = 512;

/**
 * The bot avatar shown as itself, with Replace and Reset beside it, instead
 * of a bare file input. The chosen file previews before the form is saved.
 * A website address finds that site's logo, which is shown for confirmation
 * before it replaces the avatar.
 */
export function BotAvatarPicker({
  currentAvatarJpegBase64,
  isCustom,
  logoEndpoint,
}: {
  currentAvatarJpegBase64: string | null;
  isCustom: boolean;
  logoEndpoint?: string;
}) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [reset, setReset] = useState(false);
  const [website, setWebsite] = useState("");
  const [logo, setLogo] = useState<{ file: File; url: string; host: string } | null>(null);
  const [isFinding, setIsFinding] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  useEffect(
    () => () => {
      if (logo) URL.revokeObjectURL(logo.url);
    },
    [logo],
  );

  const imageUrl = reset
    ? null
    : (previewUrl ??
      (currentAvatarJpegBase64
        ? `data:image/jpeg;base64,${currentAvatarJpegBase64}`
        : null));

  async function findLogo() {
    if (!logoEndpoint || !website.trim() || isFinding) return;

    setIsFinding(true);
    setLogoError(null);
    setLogo(null);

    try {
      const url = new URL(logoEndpoint, window.location.origin);
      url.searchParams.set("url", website.trim());
      const response = await fetch(url);

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not find a logo");
      }

      const source = response.headers.get("x-logo-source");
      const file = await toAvatarJpeg(await response.blob());
      setLogo({
        file,
        url: URL.createObjectURL(file),
        host: source ? new URL(source).hostname : website.trim(),
      });
    } catch (error) {
      setLogoError(error instanceof Error ? error.message : "Could not find a logo");
    } finally {
      setIsFinding(false);
    }
  }

  function applyLogo() {
    const input = fileInputRef.current;
    if (!logo || !input) return;

    const transfer = new DataTransfer();
    transfer.items.add(logo.file);
    input.files = transfer.files;
    // Reaches both this input's handler and the form's save-on-change.
    input.dispatchEvent(new Event("change", { bubbles: true }));
    setLogo(null);
    setWebsite("");
  }

  function handleWebsiteKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      // Enter looks the logo up instead of saving the form.
      event.preventDefault();
      void findLogo();
    }
  }

  return (
    <div className="flex flex-col gap-3">
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
                ref={fileInputRef}
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
                ? "Custom avatar"
                : "Default avatar"}
          </p>
        </div>
      </div>
      {logoEndpoint ? (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              aria-label="Website to take the logo from"
              className="h-9"
              disabled={isFinding}
              inputMode="url"
              // Typing here must not trigger the form's own save-on-change.
              onChange={(event) => {
                event.stopPropagation();
                setWebsite(event.currentTarget.value);
              }}
              onKeyDown={handleWebsiteKeyDown}
              placeholder="Or use a website logo, e.g. acme.com"
              type="text"
              value={website}
            />
            <Button
              className="h-9 shrink-0"
              disabled={!website.trim() || isFinding}
              onClick={() => void findLogo()}
              type="button"
              variant="outline"
            >
              {isFinding ? (
                <LoaderCircle data-icon="inline-start" className="motion-safe:animate-spin" />
              ) : (
                <Globe data-icon="inline-start" />
              )}
              {isFinding ? "Finding..." : "Find logo"}
            </Button>
          </div>
          {logo ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 p-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
              <img
                alt={`Logo found on ${logo.host}`}
                className="size-12 shrink-0 rounded-full border bg-white object-cover"
                src={logo.url}
              />
              <p className="min-w-0 flex-1 text-sm">
                Use this logo from <span className="font-medium">{logo.host}</span>?
              </p>
              <div className="flex gap-1">
                <Button onClick={applyLogo} size="sm" type="button">
                  Use logo
                </Button>
                <Button onClick={() => setLogo(null)} size="sm" type="button" variant="ghost">
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          {logoError ? (
            <p className="text-xs text-destructive" role="alert">
              {logoError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Centers any logo image on a white square and encodes it as the JPG bots need. */
async function toAvatarJpeg(blob: Blob) {
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("That logo could not be read"));
      element.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("That logo could not be read");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);

    const width = image.naturalWidth || AVATAR_SIZE;
    const height = image.naturalHeight || AVATAR_SIZE;
    const box = AVATAR_SIZE * 0.72;
    const scale = Math.min(box / width, box / height);
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      (AVATAR_SIZE - width * scale) / 2,
      (AVATAR_SIZE - height * scale) / 2,
      width * scale,
      height * scale,
    );

    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!jpeg) throw new Error("That logo could not be read");

    return new File([jpeg], "website-logo.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
