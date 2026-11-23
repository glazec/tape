"use client";

import { useEffect, useRef, useState } from "react";
import { WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";

type ConnectionPhase = "online" | "offline" | "restored" | "leaving";

/**
 * A quiet pill that says when the connection drops and when it returns.
 * Truthful state only: it never claims edits were saved while offline.
 */
export function ConnectionStatus() {
  const [phase, setPhase] = useState<ConnectionPhase>("online");
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clear = () => {
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
      restoreTimer.current = null;
    };
    const onOffline = () => {
      clear();
      setPhase("offline");
    };
    const onOnline = () => {
      clear();
      setPhase((current) => (current === "offline" ? "restored" : current));
      restoreTimer.current = setTimeout(() => {
        setPhase((current) => (current === "restored" ? "leaving" : current));
        restoreTimer.current = setTimeout(() => setPhase("online"), 180);
      }, 2400);
    };

    // Start offline when the page loads without a connection (deferred so the
    // first render matches the server markup).
    const initial = navigator.onLine ? null : setTimeout(onOffline, 0);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      clear();
      if (initial) clearTimeout(initial);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  const visible = phase !== "online";

  return (
    <div
      aria-live="polite"
      className="tape-toast-anchor pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4"
      role="status"
    >
      <div
        className={cn(
          "tape-toast inline-flex items-center gap-2 rounded-full border bg-popover px-3.5 py-2 text-sm text-popover-foreground shadow-lg",
          !visible && "hidden",
        )}
        data-phase={phase}
      >
        {/* One pill stays mounted; only its label crossfades between states. */}
        {phase === "offline" ? (
          <span className="tape-panel-enter inline-flex items-center gap-2" key="offline">
            <WifiOff aria-hidden="true" className="size-4 text-muted-foreground" />
            You&rsquo;re offline. Changes need a connection to save.
          </span>
        ) : phase === "restored" || phase === "leaving" ? (
          <span className="tape-panel-enter inline-flex items-center gap-2" key="restored">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />
            Back online
          </span>
        ) : null}
      </div>
    </div>
  );
}
