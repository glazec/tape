import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { startConfirmedRecording } from "../src/confirmed-recording.mjs";

function sdk(startRecording = async () => {}) {
  const emitter = new EventEmitter();
  emitter.addEventListener = emitter.on;
  emitter.removeEventListener = emitter.off;
  emitter.startRecording = startRecording;
  return emitter;
}

test("command acceptance and another meeting event do not confirm capture", async () => {
  const fake = sdk();
  let settled = false;
  const result = startConfirmedRecording(fake, { windowId: "meeting" }).then(value => { settled = true; return value; });
  fake.emit("recording-started", { window: { id: "other" }, rawMedia: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  fake.emit("recording-started", { window: { id: "meeting" }, rawMedia: true });
  assert.deepEqual(await result, { rawMedia: true });
  assert.equal(fake.listenerCount("recording-started"), 0);
  assert.equal(fake.listenerCount("error"), 0);
});

test("local fallback is reported without claiming background capture", async () => {
  const fake = sdk(async () => fake.emit("recording-started", { window: { id: "meeting" }, rawMedia: false }));
  assert.deepEqual(await startConfirmedRecording(fake, { windowId: "meeting" }), { rawMedia: false });
});

test("asynchronous failure and missing confirmation reject startup", async () => {
  const fake = sdk(async () => fake.emit("error", { message: "capture failed" }));
  await assert.rejects(startConfirmedRecording(fake, { windowId: "meeting" }), /capture failed/);
  await assert.rejects(startConfirmedRecording(sdk(), { windowId: "meeting" }, 5), /did not confirm/);
});
