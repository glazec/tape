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

test("requests native window selection instead of silently recording audio only", async () => {
  const sdk = {
    addEventListener() {},
    removeEventListener() {},
    async prepareDesktopAudioRecording() {
      return "desktop-audio";
    },
  };
  const selector = createRecordingWindowSelector(sdk);

  await assert.rejects(selector.select({ timeoutMs: 0 }), /Choose a meeting window/);
});

function fixture() {
  const listeners = new Map();
  const sdk = {
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name) => listeners.delete(name),
  };
  const selector = createRecordingWindowSelector(sdk);
  return { selector, listeners, emit: (name, window) => listeners.get(name)({ window }) };
}

test("selects scheduled Meet URL rather than first detected call", async () => {
  const { selector, emit, listeners } = fixture();
  emit("meeting-detected", { id: "other", url: "https://meet.google.com/xyz-abcd-efg" });
  emit("meeting-detected", { id: "scheduled" });
  emit("meeting-updated", { id: "scheduled", url: "https://meet.google.com/meet/abc-defg-hij?authuser=1" });
  assert.equal((await selector.select({ timeoutMs: 0, expectedMeetingUrl: "https://meet.google.com/abc-defg-hij" })).windowId, "scheduled");
  assert.equal(listeners.size, 0);
});

test("matches Zoom call IDs across regional hosts and passcodes", async () => {
  const { selector, emit } = fixture();
  emit("meeting-detected", { id: "zoom", url: "https://us02web.zoom.us/j/12345678901?pwd=redacted" });
  assert.equal((await selector.select({ timeoutMs: 0, expectedMeetingUrl: "https://zoom.us/j/12345678901" })).windowId, "zoom");
});

test("does not guess when multiple calls or two copies of the same call are open", async () => {
  for (const expectedMeetingUrl of [undefined, "https://meet.google.com/abc-defg-hij"]) {
    const { selector, emit } = fixture();
    for (const id of ["one", "two"]) emit("meeting-detected", { id, url: "https://meet.google.com/abc-defg-hij" });
    await assert.rejects(selector.select({ timeoutMs: 0, expectedMeetingUrl }), /Multiple matching/);
  }
});

test("does not substitute an unrelated call when scheduled URL is missing or invalid", async () => {
  for (const expectedMeetingUrl of ["https://meet.google.com/xyz-abcd-efg", "https://meet.google.com.evil.example/abc-defg-hij", "not a URL"]) {
    const { selector, emit } = fixture();
    emit("meeting-detected", { id: "other", url: "https://meet.google.com/abc-defg-hij" });
    await assert.rejects(selector.select({ timeoutMs: 0, expectedMeetingUrl }), /No matching/);
  }
});

test("removes closed meetings and merges URL updates without losing identity", async () => {
  const { selector, emit } = fixture();
  emit("meeting-detected", { id: "closed" });
  emit("meeting-closed", { id: "closed" });
  emit("meeting-detected", { id: "active", url: "https://meet.google.com/abc-defg-hij" });
  emit("meeting-updated", { id: "active", title: "Updated title" });
  assert.equal((await selector.select({ timeoutMs: 0, expectedMeetingUrl: "https://meet.google.com/abc-defg-hij" })).windowId, "active");
});
