// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captureNavigationStart,
  initAll,
  initializeClientTelemetry,
  reset,
  setGroup,
  setUserId,
  track,
} = vi.hoisted(() => ({
  captureNavigationStart: vi.fn(),
  initAll: vi.fn(),
  initializeClientTelemetry: vi.fn(),
  reset: vi.fn(),
  setGroup: vi.fn(),
  setUserId: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@amplitude/unified", () => ({
  initAll,
  reset,
  setGroup,
  setUserId,
  track,
}));

vi.mock("@/lib/telemetry/client", () => ({
  captureNavigationStart,
  initializeClientTelemetry,
}));

type AmplitudeWindow = Window & {
  __tapeAmplitudeInitialization?: Promise<void>;
};

describe("Amplitude browser analytics", () => {
  beforeEach(() => {
    captureNavigationStart.mockReset();
    initAll.mockReset().mockResolvedValue(undefined);
    initializeClientTelemetry.mockReset();
    reset.mockReset();
    setGroup.mockReset();
    setUserId.mockReset();
    track.mockReset();
    delete (window as AmplitudeWindow).__tapeAmplitudeInitialization;
    vi.resetModules();
  });

  it("initializes once with privacy-safe analytics and session replay", async () => {
    await import("@/instrumentation-client");
    vi.resetModules();
    await import("@/instrumentation-client");

    expect(initAll).toHaveBeenCalledOnce();
    expect(initAll).toHaveBeenCalledWith(
      "5836fffe3657ee0cf0058fb4c044329",
      {
        analytics: {
          autocapture: {
            attribution: true,
            elementInteractions: {
              dataAttributePrefix: "data-telemetry-",
              shouldTrackEventResolver: expect.any(Function),
              viewportContentUpdated: { enabled: false },
            },
            fileDownloads: false,
            formInteractions: false,
            frustrationInteractions: {
              deadClicks: true,
              rageClicks: true,
              shouldTrackEventResolver: expect.any(Function),
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

    const options = initAll.mock.calls[0]?.[1];
    const frustrationResolver =
      options.analytics.autocapture.frustrationInteractions
        .shouldTrackEventResolver;
    const interactionResolver =
      options.analytics.autocapture.elementInteractions
        .shouldTrackEventResolver;
    const trackedElement = document.createElement("button");
    trackedElement.dataset.telemetryAction = "meeting_share_opened";
    const sensitiveElement = document.createElement("button");
    sensitiveElement.dataset.telemetryAction = "meeting_access_remove_clicked";
    sensitiveElement.setAttribute("aria-label", "Remove person@example.com");

    expect(frustrationResolver("click", trackedElement)).toBe(true);
    expect(interactionResolver("click", trackedElement)).toBe(true);
    expect(interactionResolver("click", sensitiveElement)).toBe(false);
    expect(
      interactionResolver("click", document.createElement("button")),
    ).toBe(false);
  });

  it("tracks events and manages the initialized user", async () => {
    await import("@/instrumentation-client");
    const {
      captureAmplitudeClientEvent,
      identifyAmplitudeUser,
      resetAmplitudeUser,
    } = await import("@/lib/amplitude/client");

    captureAmplitudeClientEvent("tape_product_action", {
      action: "meeting_share_completed",
    });
    identifyAmplitudeUser("user-id", "workspace-id");
    resetAmplitudeUser();
    await Promise.resolve();
    await Promise.resolve();

    expect(track).toHaveBeenCalledWith("tape_product_action", {
      action: "meeting_share_completed",
    });
    expect(setUserId).toHaveBeenCalledWith("user-id");
    expect(setGroup).toHaveBeenCalledWith("workspace_id", "workspace-id");
    expect(reset).toHaveBeenCalledOnce();
  });
});
