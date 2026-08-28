// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captureMessage,
  captureNavigationStart,
  initAll,
  initializeClientTelemetry,
  initializeSentry,
  reset,
  setGroup,
  setUserId,
  track,
} = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  captureNavigationStart: vi.fn(),
  initAll: vi.fn(),
  initializeClientTelemetry: vi.fn(),
  initializeSentry: vi.fn(),
  reset: vi.fn(),
  setGroup: vi.fn(),
  setUserId: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage,
  captureRouterTransitionStart: vi.fn(),
  init: initializeSentry,
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
    captureMessage.mockReset();
    initAll.mockReset().mockResolvedValue(undefined);
    initializeClientTelemetry.mockReset();
    initializeSentry.mockReset();
    reset.mockReset();
    setGroup.mockReset();
    setUserId.mockReset();
    track.mockReset();
    sessionStorage.clear();
    delete (window as AmplitudeWindow).__tapeAmplitudeInitialization;
    vi.resetModules();
  });

  it("initializes once with privacy-safe analytics and session replay", async () => {
    await import("@/instrumentation-client");
    vi.resetModules();
    await import("@/instrumentation-client");

    expect(initAll).toHaveBeenCalledOnce();
    expect(initializeSentry).toHaveBeenCalledBefore(initAll);
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

  it("reports initialization failure once with no error details", async () => {
    initAll.mockRejectedValue(new Error("private initialization detail"));

    await import("@/instrumentation-client");
    await Promise.resolve();
    await Promise.resolve();

    expect(captureMessage).toHaveBeenCalledOnce();
    expect(captureMessage).toHaveBeenCalledWith(
      "client.observability.failure",
      expect.objectContaining({
        tags: expect.objectContaining({
          "observability.failure_reason": "exception",
          "observability.phase": "initialization",
          "observability.provider": "amplitude",
        }),
      }),
    );
    expect(JSON.stringify(captureMessage.mock.calls)).not.toContain(
      "private initialization detail",
    );
  });

  it("reports rejected event delivery once per browser session", async () => {
    track.mockReturnValue({
      promise: Promise.resolve({ code: 429 }),
    });
    await import("@/instrumentation-client");
    const { captureAmplitudeClientEvent } = await import(
      "@/lib/amplitude/client"
    );

    captureAmplitudeClientEvent("tape_product_action", {
      action: "meeting_share_completed",
    });
    captureAmplitudeClientEvent("tape_product_action", {
      action: "meeting_share_completed",
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(track).toHaveBeenCalledTimes(2);
    expect(captureMessage).toHaveBeenCalledOnce();
    expect(captureMessage).toHaveBeenCalledWith(
      "client.observability.failure",
      expect.objectContaining({
        tags: expect.objectContaining({
          "observability.failure_reason": "rejected",
          "observability.phase": "delivery",
          "observability.provider": "amplitude",
          "observability.status_code": "429",
        }),
      }),
    );
  });

  it("reports an event delivery exception without error details", async () => {
    track.mockReturnValue({
      promise: Promise.reject(new Error("private delivery detail")),
    });
    await import("@/instrumentation-client");
    const { captureAmplitudeClientEvent } = await import(
      "@/lib/amplitude/client"
    );

    captureAmplitudeClientEvent("tape_product_action", {
      action: "meeting_share_completed",
    });
    await vi.waitFor(() => {
      expect(captureMessage).toHaveBeenCalledWith(
        "client.observability.failure",
        expect.objectContaining({
          tags: expect.objectContaining({
            "observability.failure_reason": "exception",
            "observability.phase": "delivery",
            "observability.provider": "amplitude",
          }),
        }),
      );
    });
    expect(JSON.stringify(captureMessage.mock.calls)).not.toContain(
      "private delivery detail",
    );
  });
});
