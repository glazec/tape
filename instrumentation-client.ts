import {
  captureNavigationStart,
  initializeClientTelemetry,
} from "@/lib/telemetry/client";

initializeClientTelemetry();

export function onRouterTransitionStart(
  url: string,
  navigationType: "push" | "replace" | "traverse",
) {
  captureNavigationStart(url, navigationType);
}
