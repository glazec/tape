"use client";

import { useEffect, useRef } from "react";

/**
 * Gives a native <details> menu popover manners: closes on an outside tap,
 * on Escape (returning focus to its summary), and after choosing an item.
 * Render it inside the <details>; it adds no markup of its own.
 */
export function DetailsDismiss() {
  const markerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const details = markerRef.current?.closest("details");
    if (!details) return;

    const close = (restoreFocus: boolean) => {
      if (!details.open) return;
      details.open = false;
      if (restoreFocus) details.querySelector("summary")?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!details.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    const onClick = (event: MouseEvent) => {
      const item = (event.target as Element | null)?.closest("a, [data-closes-menu]");
      if (item && details.contains(item) && !item.closest("summary")) close(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    details.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      details.removeEventListener("click", onClick);
    };
  }, []);

  return <span hidden ref={markerRef} />;
}
