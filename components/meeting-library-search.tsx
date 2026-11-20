"use client";

import {
  useEffect,
  useRef,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";

import { defaultMeetingLibraryViewConfig } from "@/lib/meeting-library-view-options";
import { captureClientAction } from "@/lib/telemetry/client";
import { startSearchTiming } from "@/lib/sentry/search-timing";

export function MeetingLibrarySearch({
  children,
  controls,
  hasSavedView = false,
  hasQuery = false,
}: {
  children: ReactNode;
  controls: ReactNode;
  hasSavedView?: boolean;
  hasQuery?: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const typingTimerRef = useRef<number | null>(null);
  const finishSearchRef = useRef<ReturnType<typeof startSearchTiming> | null>(null);

  useEffect(() => {
    if (hasQuery && formRef.current) {
      const data = new FormData(formRef.current);
      data.delete("q");
      router.prefetch(getSearchHref(data, hasSavedView));
    }
  }, [hasQuery, hasSavedView, controls, router]);

  useEffect(() => {
    if (!isPending) {
      finishSearchRef.current?.("complete");
      finishSearchRef.current = null;
    }
  }, [isPending]);

  useEffect(
    () => () => {
      finishSearchRef.current?.("cancelled");
      if (typingTimerRef.current !== null) {
        window.clearTimeout(typingTimerRef.current);
      }
    },
    [],
  );

  // Search as the person types, after a short pause, instead of waiting for
  // an explicit Search press.
  function scheduleSearch(form: HTMLFormElement, target: EventTarget) {
    if (!(target instanceof HTMLInputElement) || target.type !== "search") {
      return;
    }

    if (typingTimerRef.current !== null) {
      window.clearTimeout(typingTimerRef.current);
    }

    if (!target.value.trim()) {
      typingTimerRef.current = null;
      form.requestSubmit();
      return;
    }

    typingTimerRef.current = window.setTimeout(() => {
      typingTimerRef.current = null;
      form.requestSubmit();
    }, 400);
  }

  function searchMeetings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (typingTimerRef.current !== null) {
      window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    const href = getSearchHref(new FormData(event.currentTarget), hasSavedView);
    captureClientAction("meeting_library_search_applied");
    finishSearchRef.current?.("cancelled");
    finishSearchRef.current = startSearchTiming("meeting_library");

    startTransition(() => {
      router.replace(href, {
        scroll: false,
      });
    });
  }

  return (
    <>
      <form
        ref={formRef}
        onInput={(event) => scheduleSearch(event.currentTarget, event.target)}
        onSubmit={searchMeetings}
      >
        {controls}
      </form>
      <div
        aria-busy={isPending}
        aria-label="Meeting results"
        className="relative"
      >
        <div inert={isPending ? true : undefined}>{children}</div>
        {isPending ? (
          <div
            aria-label="Searching meetings"
            className="absolute inset-0 z-10 flex min-h-40 items-center justify-center bg-card/85 text-sm font-medium text-muted-foreground backdrop-blur-[1px]"
            role="status"
          >
            <LoaderCircle
              aria-hidden="true"
              className="mr-2 size-4 animate-spin motion-reduce:animate-none"
            />
            Searching meetings
          </div>
        ) : null}
      </div>
    </>
  );
}

function getSearchHref(data: FormData, hasSavedView: boolean) {
  const params = new URLSearchParams();
  for (const [name, value] of data) {
    if (typeof value === "string" && value.trim()) {
      params.set(name, value.trim());
    }
  }
  const defaults = defaultMeetingLibraryViewConfig;
  if (params.get("scope") === defaults.searchScope) params.delete("scope");
  if (params.get("sort") === defaults.sort) params.delete("sort");
  if (params.get("status") === defaults.status) params.delete("status");
  if (hasSavedView && !["q", "scope", "sort", "status"].some((key) => params.has(key))) {
    params.set("view", "all");
  }
  const query = params.toString();
  return query ? `/dashboard?${query}` : "/dashboard";
}
