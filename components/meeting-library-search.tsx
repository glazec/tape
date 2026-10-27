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

import { captureClientAction } from "@/lib/telemetry/client";

export function MeetingLibrarySearch({
  children,
  controls,
}: {
  children: ReactNode;
  controls: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const typingTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
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

    typingTimerRef.current = window.setTimeout(() => {
      typingTimerRef.current = null;
      form.requestSubmit();
    }, 400);
  }

  function searchMeetings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const params = new URLSearchParams();

    for (const [name, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string" && value) {
        params.append(name, value);
      }
    }

    const query = params.toString();
    captureClientAction("meeting_library_search_applied");

    startTransition(() => {
      router.replace(query ? `/dashboard?${query}` : "/dashboard", {
        scroll: false,
      });
    });
  }

  return (
    <>
      <form
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
