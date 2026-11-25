"use client";

import { useRef, useState } from "react";
import { FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RecordingPickerWindow = Window & {
  showOpenFilePicker?: (options: {
    multiple: boolean;
  }) => Promise<FileSystemFileHandle[]>;
};

export function RecordingFilePicker({
  accept,
  disabled,
  hasSelection = false,
  id,
  invalid,
  label,
  name,
  onSelect,
}: {
  accept: string;
  disabled: boolean;
  hasSelection?: boolean;
  id: string;
  invalid?: boolean;
  label: string;
  name: string;
  onSelect: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [opening, setOpening] = useState(false);
  const [useBrowserPicker, setUseBrowserPicker] = useState(false);

  async function browse() {
    const input = inputRef.current;
    if (!input || disabled || opening) return;

    const browser = window as RecordingPickerWindow;
    const isAndroid = /Android/i.test(browser.navigator.userAgent);
    if (!isAndroid || !browser.showOpenFilePicker || useBrowserPicker) {
      // Android providers can report different MIME types for the same recording.
      if (isAndroid) input.removeAttribute("accept");
      input.value = "";
      input.click();
      return;
    }

    setOpening(true);
    try {
      const handles = await browser.showOpenFilePicker({ multiple: true });
      const files = await Promise.all(handles.map((handle) => handle.getFile()));
      if (inputRef.current && !input.disabled && files.length > 0) {
        onSelect(files);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setUseBrowserPicker(true);
      }
    } finally {
      setOpening(false);
    }
  }

  return (
    <>
      <input
        accept={accept}
        aria-hidden="true"
        aria-label={label}
        className="sr-only"
        disabled={disabled}
        id={id}
        multiple
        name={name}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          if (!disabled && files.length > 0) onSelect(files);
        }}
        ref={inputRef}
        tabIndex={-1}
        type="file"
      />
      <Button
        aria-invalid={invalid}
        className={cn(
          "min-h-11 gap-2 px-4",
          hasSelection ? "self-end px-0" : "sm:self-start",
        )}
        disabled={disabled || opening}
        id={`${id}-browse`}
        onClick={browse}
        type="button"
        variant={hasSelection ? "link" : "outline"}
      >
        {hasSelection ? null : <FolderOpen aria-hidden="true" />}
        {hasSelection ? "Choose a different file" : "Browse recording files"}
      </Button>
      {useBrowserPicker ? (
        <p className="text-xs text-muted-foreground" role="status">
          Tap the button to use your browser’s picker. If prompted, choose Files.
        </p>
      ) : null}
      {!hasSelection ? (
        <details className="text-sm text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hidden">
          <summary className="min-h-11 cursor-pointer py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            Can’t find your recording?
          </summary>
          <p className="pb-2 text-xs leading-5">
            In Pixel Recorder, touch and hold the saved recording. Tap Share,
            File, then Audio. Save it to Google Drive, then open Drive in the
            file picker.
          </p>
        </details>
      ) : null}
    </>
  );
}
