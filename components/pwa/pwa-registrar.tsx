"use client";

import { useEffect } from "react";

import { SERVICE_WORKER_PATH } from "@/lib/pwa";
import {
  initInstallState,
  markInstalled,
  setDeferredPrompt,
  type BeforeInstallPromptEvent,
} from "@/lib/pwa-install-store";

/**
 * Registers Tape's single service worker and captures the install prompt.
 * Development skips registration so hot reload never fights a cached bundle.
 */
export function PwaRegistrar() {
  useEffect(() => {
    initInstallState();

    const onBeforeInstall = (event: Event) => {
      // Keep the browser's mini infobar quiet; the account menu offers install.
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => markInstalled();
    const displayMode = window.matchMedia?.("(display-mode: standalone)");
    const onDisplayModeChange = () => initInstallState();

    // iOS keeps fixed layers full height when the keyboard opens; expose the
    // covered height so bottom sheets can sit above it.
    const visualViewport = window.visualViewport;
    const syncKeyboardInset = () => {
      if (!visualViewport) return;
      const inset = Math.max(0, window.innerHeight - visualViewport.height - visualViewport.offsetTop);
      document.documentElement.style.setProperty("--tape-keyboard-inset", `${Math.round(inset)}px`);
    };
    visualViewport?.addEventListener("resize", syncKeyboardInset);
    visualViewport?.addEventListener("scroll", syncKeyboardInset);

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    displayMode?.addEventListener?.("change", onDisplayModeChange);

    if (process.env.NODE_ENV !== "production" && "serviceWorker" in navigator) {
      // Dev chunk names are not content hashed, so a leftover worker would
      // serve stale code. Remove it and its caches.
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        registrations
          .filter((registration) =>
            registration.active?.scriptURL.includes(SERVICE_WORKER_PATH),
          )
          .forEach((registration) => void registration.unregister()),
      );
      void caches
        ?.keys()
        .then((keys) => keys.filter((key) => key.startsWith("tape-")).forEach((key) => void caches.delete(key)));
    }

    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      const register = async () => {
        try {
          // OneSignal registers the same file with its own query string on
          // phones. Re-registering a different URL would reinstall the worker
          // on every load, so leave an existing Tape worker alone.
          const existing = await navigator.serviceWorker.getRegistration("/");
          const scriptURL = existing?.active?.scriptURL ?? existing?.installing?.scriptURL;
          if (scriptURL && new URL(scriptURL).pathname === SERVICE_WORKER_PATH) {
            void existing?.update();
            return;
          }
          await navigator.serviceWorker.register(SERVICE_WORKER_PATH, {
            scope: "/",
            updateViaCache: "none",
          });
        } catch (error) {
          console.warn("Service worker registration failed", error);
        }
      };
      if (document.readyState === "complete") void register();
      else window.addEventListener("load", () => void register(), { once: true });
    }

    return () => {
      visualViewport?.removeEventListener("resize", syncKeyboardInset);
      visualViewport?.removeEventListener("scroll", syncKeyboardInset);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      displayMode?.removeEventListener?.("change", onDisplayModeChange);
    };
  }, []);

  return null;
}
