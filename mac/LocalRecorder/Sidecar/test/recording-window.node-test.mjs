import assert from "node:assert/strict";
import { test } from "node:test";

import { createRecordingWindowSelector } from "../src/recording-window.mjs";

test("uses a detected meeting window for participant speaker metadata", async () => {
  const listeners = new Map();
  const sdk = {
    addEventListener(event, listener) {
      listeners.set(event, listener);
    },
    removeEventListener(event, listener) {
      if (listeners.get(event) === listener) listeners.delete(event);
    },
    async prepareDesktopAudioRecording() {
      throw new Error("desktop fallback should not run");
    },
  };
  const selector = createRecordingWindowSelector(sdk);

  listeners.get("meeting-detected")({ window: { id: "meeting-window" } });

  await assert.doesNotReject(async () => {
    assert.deepEqual(await selector.select({ timeoutMs: 10 }), {
      captureMode: "meeting",
      windowId: "meeting-window",
    });
  });
});

test("falls back to whole desktop audio when no meeting window is detected", async () => {
  const sdk = {
    addEventListener() {},
    removeEventListener() {},
    async prepareDesktopAudioRecording() {
      return "desktop-audio";
    },
  };
  const selector = createRecordingWindowSelector(sdk);

  assert.deepEqual(await selector.select({ timeoutMs: 0 }), {
    captureMode: "desktop-audio",
    windowId: "desktop-audio",
  });
});
