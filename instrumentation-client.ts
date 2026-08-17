import * as amplitude from "@amplitude/unified";

import {
  captureNavigationStart,
  initializeClientTelemetry,
} from "@/lib/telemetry/client";

type AmplitudeWindow = Window & {
  __tapeAmplitudeInitialization?: Promise<void>;
};

const amplitudeWindow = window as AmplitudeWindow;

function shouldTrackSafeInteraction(_actionType: string, element: Element) {
  const actionElement = element.closest("[data-telemetry-action]");

  return Boolean(
    actionElement &&
      !actionElement.matches(
        "[aria-label], input, select, textarea, [contenteditable='true']",
      ),
  );
}

if (!amplitudeWindow.__tapeAmplitudeInitialization) {
  amplitudeWindow.__tapeAmplitudeInitialization = amplitude.initAll(
    "5836fffe3657ee0cf0058fb4c044329",
    {
      analytics: {
        autocapture: {
          attribution: true,
          elementInteractions: {
            dataAttributePrefix: "data-telemetry-",
            shouldTrackEventResolver: shouldTrackSafeInteraction,
            viewportContentUpdated: { enabled: false },
          },
          fileDownloads: false,
          formInteractions: false,
          frustrationInteractions: {
            deadClicks: true,
            rageClicks: true,
            shouldTrackEventResolver: shouldTrackSafeInteraction,
          },
          networkTracking: false,
          pageUrlEnrichment: false,
          pageViews: false,
          performanceTracking: { mainThreadBlock: true },
          sessions: true,
          webVitals: true,
        },
      },
      sessionReplay: {
        privacyConfig: {
          blockSelector: [
            "audio",
            "video",
            "canvas",
            "iframe",
            "img",
            "picture",
            "[data-amplitude-block]",
          ],
          defaultMaskLevel: "conservative",
          maskAttributes: ["aria-label", "title"],
        },
        sampleRate: 1,
      },
    },
  );
  void amplitudeWindow.__tapeAmplitudeInitialization.catch(() => undefined);
}

initializeClientTelemetry();

export function onRouterTransitionStart(
  url: string,
  navigationType: "push" | "replace" | "traverse",
) {
  captureNavigationStart(url, navigationType);
}
