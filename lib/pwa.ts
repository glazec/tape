// Paper (#F7F3EC) matches the icon plate, so the splash screen and the icon
// read as one surface when the installed app launches.
export const PWA_BACKGROUND_COLOR = "#f7f3ec";
// The app header's resting background, so the standalone status bar blends in.
export const PWA_THEME_COLOR = "#fdfcfb";
export const SERVICE_WORKER_PATH = "/OneSignalSDKWorker.js";

/** Inline head script that holds an install prompt fired before hydration. */
export const EARLY_INSTALL_PROMPT_SCRIPT = `window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__tapeInstallPrompt=e;});`;
