// @vitest-environment happy-dom

import { act, render } from "@testing-library/react";
import type { MotionValue } from "framer-motion";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rendererDispose, rendererRender, rendererSetSize } = vi.hoisted(() => ({
  rendererDispose: vi.fn(),
  rendererRender: vi.fn(),
  rendererSetSize: vi.fn(),
}));

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();

  class WebGLRenderer {
    outputColorSpace: unknown;
    shadowMap = { enabled: false, type: 0 };
    toneMapping: unknown;
    toneMappingExposure = 1;

    dispose = rendererDispose;
    render = rendererRender;
    setClearColor = vi.fn();
    setPixelRatio = vi.fn();
    setSize = rendererSetSize;
  }

  return { ...actual, WebGLRenderer };
});

import HeroScene from "@/components/landing/hero-scene";

type ProgressHarness = {
  progress: MotionValue<number>;
  publish(value: number): void;
  unsubscribe: ReturnType<typeof vi.fn>;
};

describe("HeroScene", () => {
  let animationFrames: FrameRequestCallback[];
  let resizeCallbacks: ResizeObserverCallback[];

  beforeEach(() => {
    animationFrames = [];
    resizeCallbacks = [];
    rendererDispose.mockReset();
    rendererRender.mockReset();
    rendererSetSize.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback);
        }

        disconnect = vi.fn();
        observe = vi.fn();
        unobserve = vi.fn();
      },
    );

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      addColorStop: vi.fn(),
      clearRect: vi.fn(),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      fillRect: vi.fn(),
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders a static wide composition for reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue(
      mediaQueryResult(true),
    );
    const harness = createProgressHarness(0);
    const { container, unmount } = render(
      <div>
        <HeroScene progress={harness.progress} />
      </div>,
    );
    const parent = container.firstElementChild as HTMLElement;

    setElementSize(parent, 1200, 700);
    act(() => resizeCallbacks[0]?.([], {} as ResizeObserver));

    expect(rendererSetSize).toHaveBeenLastCalledWith(1200, 700, false);
    expect(rendererRender).toHaveBeenCalledTimes(1);
    expect(animationFrames).toHaveLength(0);
    expect(console.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("deprecated"),
    );

    unmount();
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
    expect(rendererDispose).toHaveBeenCalledTimes(1);
  });

  it("animates a narrow composition and pauses while hidden", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue(
      mediaQueryResult(false),
    );
    const harness = createProgressHarness(0.8);
    const { container, unmount } = render(
      <div>
        <HeroScene progress={harness.progress} />
      </div>,
    );
    const parent = container.firstElementChild as HTMLElement;

    setElementSize(parent, 480, 900);
    act(() => resizeCallbacks[0]?.([], {} as ResizeObserver));
    act(() => animationFrames.shift()?.(100));
    act(() => harness.publish(1));
    act(() => animationFrames.shift()?.(200));

    expect(rendererSetSize).toHaveBeenLastCalledWith(480, 900, false);
    expect(rendererRender).toHaveBeenCalledTimes(2);
    expect(console.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("deprecated"),
    );

    setDocumentHidden(true);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(cancelAnimationFrame).toHaveBeenCalled();

    setDocumentHidden(false);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(requestAnimationFrame).toHaveBeenCalled();

    unmount();
    expect(rendererDispose).toHaveBeenCalledTimes(1);
  });
});

function createProgressHarness(initialValue: number): ProgressHarness {
  let listener: ((value: number) => void) | null = null;
  const unsubscribe = vi.fn();

  return {
    progress: {
      get: () => initialValue,
      on: (_event: string, callback: (value: number) => void) => {
        listener = callback;
        return unsubscribe;
      },
    } as unknown as MotionValue<number>,
    publish(value: number) {
      listener?.(value);
    },
    unsubscribe,
  };
}

function mediaQueryResult(matches: boolean): MediaQueryList {
  return {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

function setElementSize(element: HTMLElement, width: number, height: number) {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: height },
    clientWidth: { configurable: true, value: width },
  });
}

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
}
