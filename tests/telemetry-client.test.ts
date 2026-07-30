// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("browser telemetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));
    window.history.replaceState({}, "", "/dashboard?private=yes");
    sessionStorage.clear();
    delete (window as Window & { __tapeTelemetryInitialized?: boolean })
      .__tapeTelemetryInitialized;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
    document.body.replaceChildren();
  });

  it("batches page views and safe interaction metadata", async () => {
    const { initializeClientTelemetry } = await import(
      "@/lib/telemetry/client"
    );
    const link = document.createElement("a");
    link.href =
      "/meetings/11111111-1111-4111-8111-111111111111?token=secret";
    link.textContent = "Private meeting title";
    document.body.append(link);

    initializeClientTelemetry();
    link.click();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(fetch).toHaveBeenCalledOnce();
    const [, request] = vi.mocked(fetch).mock.calls[0];
    const payload = JSON.parse(String(request?.body)) as {
      events: Array<Record<string, unknown>>;
    };

    expect(payload.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: "/dashboard",
          type: "page_view",
        }),
        expect.objectContaining({
          action: "link",
          destinationRoute: "/meetings/:id",
          targetType: "link",
          type: "user_action",
        }),
      ]),
    );
    expect(JSON.stringify(payload)).not.toContain("Private meeting title");
    expect(JSON.stringify(payload)).not.toContain("token=secret");
  });

  it("captures client errors without throwing into the product", async () => {
    const {
      initializeClientTelemetry,
      TEST_SESSION_STORAGE_KEY,
    } = await import(
      "@/lib/telemetry/client"
    );
    sessionStorage.setItem(
      TEST_SESSION_STORAGE_KEY,
      "33333333-3333-4333-8333-333333333333",
    );

    initializeClientTelemetry();
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new TypeError("failed https://example.com/a?token=secret"),
        message: "failed https://example.com/a?token=secret",
      }),
    );
    await vi.advanceTimersByTimeAsync(2_000);

    const [, request] = vi.mocked(fetch).mock.calls[0];
    const payload = JSON.parse(String(request?.body)) as {
      events: Array<Record<string, unknown>>;
    };
    expect(payload.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          errorMessage: "failed https://example.com/a",
          errorName: "TypeError",
          testSessionId:
            "33333333-3333-4333-8333-333333333333",
          type: "client_error",
        }),
      ]),
    );
  });
});
