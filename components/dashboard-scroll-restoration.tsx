"use client";

import { useEffect } from "react";

const historyKey = "tapeDashboardScroll";

export function DashboardScrollRestoration() {
  useEffect(() => {
    const url = window.location.href;
    const saved = window.history.state?.[historyKey];
    let stopRestoring = () => {};

    if (saved?.url === url && Number.isFinite(saved.y)) {
      let frame = 0;
      let stopped = false;
      const restore = () => {
        if (stopped) return;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (window.location.href === url) {
            window.scrollTo({ top: saved.y, behavior: "instant" });
          }
        });
      };
      // The overview and meeting list stream independently. Retry as their
      // height changes instead of accepting a position clamped by a skeleton.
      // Keep waiting for slow responses until the user interacts or leaves.
      const observer = new ResizeObserver(restore);
      observer.observe(document.body);
      stopRestoring = () => {
        stopped = true;
        observer.disconnect();
        cancelAnimationFrame(frame);
      };
      restore();
    }

    const save = (event: MouseEvent) => {
      stopRestoring();
      if (
        event.button !== 0 || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey || !(event.target instanceof Element)
      ) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.download || (link.target && link.target !== "_self")) return;
      const destination = new URL(link.href);
      if (
        window.location.pathname !== "/dashboard" ||
        destination.origin !== window.location.origin ||
        !/^\/meetings\/[^/]+$/.test(destination.pathname) ||
        destination.pathname === "/meetings/new"
      ) return;

      window.history.replaceState({
        ...window.history.state,
        [historyKey]: { url: window.location.href, y: window.scrollY },
      }, "");
    };
    const stop = () => stopRestoring();
    document.addEventListener("click", save, true);
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("pointerdown", stop);
    window.addEventListener("keydown", stop);
    window.addEventListener("popstate", stop);
    return () => {
      stopRestoring();
      document.removeEventListener("click", save, true);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("keydown", stop);
      window.removeEventListener("popstate", stop);
    };
  }, []);

  return null;
}
