"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type SaveStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved" }
  | { state: "error"; message: string };

const SaveStatusContext = createContext<{
  status: SaveStatus;
  setStatus: (status: SaveStatus) => void;
} | null>(null);

const AutosaveFormContext = createContext<{
  requestSave: (options?: { immediate?: boolean }) => void;
} | null>(null);

/** One save indicator for the whole settings page. */
export function SettingsSaveStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SaveStatus>({ state: "idle" });
  const value = useMemo(() => ({ status, setStatus }), [status]);

  return (
    <SaveStatusContext.Provider value={value}>{children}</SaveStatusContext.Provider>
  );
}

export function SettingsSaveStatus() {
  const context = useContext(SaveStatusContext);
  const status = context?.status ?? { state: "idle" };

  return (
    <span
      aria-live="polite"
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 text-xs",
        status.state === "error" ? "text-destructive" : "text-muted-foreground",
      )}
      role="status"
    >
      {status.state === "saving" ? (
        <>
          <LoaderCircle aria-hidden="true" className="size-3.5 motion-safe:animate-spin" />
          Saving…
        </>
      ) : status.state === "saved" ? (
        <>
          <Check aria-hidden="true" className="size-3.5" />
          Saved
        </>
      ) : status.state === "error" ? (
        status.message
      ) : (
        "Changes save automatically"
      )}
    </span>
  );
}

function useSaveStatus() {
  const context = useContext(SaveStatusContext);

  return context?.setStatus ?? (() => undefined);
}

/**
 * A settings form that saves itself: typing saves after a short pause,
 * toggles and file picks save at once, and Enter saves without leaving the
 * page. The form posts to the same endpoint a plain submit would use.
 */
export function AutosaveForm({
  action,
  children,
  className,
  multipart = false,
  refreshAfterSave = false,
}: {
  action: string;
  children: ReactNode;
  className?: string;
  multipart?: boolean;
  /** Re-read server data after saving, for values the server derives. */
  refreshAfterSave?: boolean;
}) {
  const router = useRouter();
  const setStatus = useSaveStatus();
  const formRef = useRef<HTMLFormElement>(null);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const save = useCallback(async () => {
    const form = formRef.current;

    if (!form) return;

    if (!form.checkValidity()) {
      form.reportValidity();
      setStatus({ state: "error", message: "Fix the highlighted field to save" });
      return;
    }

    await inFlightRef.current;
    setStatus({ state: "saving" });

    const request = (async () => {
      try {
        const response = await fetch(action, {
          body: new FormData(form),
          method: "POST",
          redirect: "manual",
        });

        // The endpoint answers a successful save with a redirect back here.
        if (response.type === "opaqueredirect" || response.ok) {
          setStatus({ state: "saved" });
          if (refreshAfterSave) router.refresh();
          return;
        }

        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setStatus({
          state: "error",
          message: body?.error ?? "Could not save. Try again.",
        });
      } catch {
        setStatus({ state: "error", message: "Could not save. Check your connection." });
      }
    })();

    inFlightRef.current = request;
    await request;
  }, [action, refreshAfterSave, router, setStatus]);

  const requestSave = useCallback(
    ({ immediate = false }: { immediate?: boolean } = {}) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(
        () => {
          timerRef.current = null;
          void save();
        },
        immediate ? 0 : 700,
      );
    },
    [save],
  );

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  function handleChange(event: FormEvent<HTMLFormElement>) {
    const target = event.target;
    const isTyping =
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement &&
        !["checkbox", "radio", "file"].includes(target.type));

    requestSave({ immediate: !isTyping });
  }

  const contextValue = useMemo(() => ({ requestSave }), [requestSave]);

  return (
    <AutosaveFormContext.Provider value={contextValue}>
      <form
        action={action}
        className={className}
        encType={multipart ? "multipart/form-data" : undefined}
        method="post"
        onChange={handleChange}
        onSubmit={(event) => {
          event.preventDefault();
          requestSave({ immediate: true });
        }}
        ref={formRef}
      >
        {children}
      </form>
    </AutosaveFormContext.Provider>
  );
}

export function useAutosaveForm() {
  return useContext(AutosaveFormContext);
}

/** A select inside an AutosaveForm that saves as soon as a value is picked. */
export function AutosaveSelect({
  defaultValue,
  id,
  name,
  options,
}: {
  defaultValue: string;
  id: string;
  name: string;
  options: ReadonlyArray<{ label: string; value: string }>;
}) {
  const autosave = useAutosaveForm();

  return (
    <Select
      defaultValue={defaultValue}
      items={options}
      name={name}
      onValueChange={() => autosave?.requestSave({ immediate: true })}
    >
      <SelectTrigger className="h-9 w-full bg-background" id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function useSettingsSaveStatus() {
  return useSaveStatus();
}
