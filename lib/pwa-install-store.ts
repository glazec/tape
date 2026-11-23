"use client";

/**
 * Holds the browser's deferred install prompt. Chrome fires
 * `beforeinstallprompt` once, often before the account menu mounts, so the
 * root registrar captures it here and any later component can read it.
 */

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallState = {
  /** Running as an installed app (home screen or desktop window). */
  standalone: boolean;
  /** Chrome style one tap install is available. */
  canPrompt: boolean;
  /** iOS Safari: install happens through Share, Add to Home Screen. */
  iosManual: boolean;
};

const SERVER_STATE: InstallState = { standalone: false, canPrompt: false, iosManual: false };

let deferredPrompt: BeforeInstallPromptEvent | null = null;

type EarlyPromptWindow = Window & { __tapeInstallPrompt?: BeforeInstallPromptEvent };

// The early head script parks the event on window; take it once so a spent
// prompt can never be adopted again.
function takeEarlyPrompt() {
  if (typeof window === "undefined") return null;
  const early = (window as EarlyPromptWindow).__tapeInstallPrompt ?? null;
  delete (window as EarlyPromptWindow).__tapeInstallPrompt;
  return early;
}
let state: InstallState = SERVER_STATE;
const listeners = new Set<() => void>();

function emit(next: InstallState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function detectStandalone() {
  if (typeof window === "undefined") return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

export function detectIosManualInstall() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const isIos =
    /iPhone|iPad|iPod/i.test(ua) ||
    // iPadOS reports itself as a Mac with touch.
    (ua.includes("Macintosh") && window.navigator.maxTouchPoints > 1);
  // Other iOS browsers (CriOS, FxiOS, EdgiOS) can add to home screen too, but
  // through different menus; only Safari's path is stable enough to describe.
  const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  return isIos && isSafari;
}

export function initInstallState() {
  const early = takeEarlyPrompt();
  if (early && !deferredPrompt) deferredPrompt = early;
  const standalone = detectStandalone();
  emit({
    standalone,
    canPrompt: !standalone && deferredPrompt !== null,
    iosManual: !standalone && detectIosManualInstall(),
  });
}

export function setDeferredPrompt(event: BeforeInstallPromptEvent | null) {
  takeEarlyPrompt();
  deferredPrompt = event;
  emit({ ...state, canPrompt: !state.standalone && event !== null });
}

export function markInstalled() {
  takeEarlyPrompt();
  deferredPrompt = null;
  emit({ standalone: true, canPrompt: false, iosManual: false });
}

export async function promptInstall() {
  const event = deferredPrompt;
  if (!event) return "unavailable" as const;
  // A prompt event can only be used once.
  setDeferredPrompt(null);
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}

export function subscribeInstallState(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInstallState() {
  return state;
}

export function getServerInstallState() {
  return SERVER_STATE;
}
