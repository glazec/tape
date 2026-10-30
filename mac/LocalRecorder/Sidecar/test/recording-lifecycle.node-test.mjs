import assert from "node:assert/strict";
import { test } from "node:test";
import { createRecordingLifecycle } from "../src/recording-lifecycle.mjs";
function setup() {
  const calls = [];
  const lifecycle = createRecordingLifecycle({
    sdk: { stopRecording: async () => calls.push("stop"), shutdown: async () => calls.push("shutdown") },
    send: (message) => calls.push(message.type), windowId: "window", exit: () => calls.push("exit"),
  });
  return { calls, lifecycle };
}
test("stop acknowledges capture but keeps upload process alive", async () => {
  const { calls, lifecycle } = setup();
  await lifecycle.stop(); await lifecycle.stop();
  assert.deepEqual(calls, ["stop", "stopped"]);
  await lifecycle.shutdown();
  assert.deepEqual(calls, ["stop", "stopped", "shutdown", "shutdown", "exit"]);
});
test("natural ended segment is preserved without stopping twice", async () => {
  const { calls, lifecycle } = setup();
  lifecycle.ended(); await lifecycle.stop();
  assert.deepEqual(calls, ["stopped"]);
});
test("shutdown refuses to truncate an active capture", async () => {
  const { calls, lifecycle } = setup();
  await assert.rejects(lifecycle.shutdown(), /Capture must stop/);
  assert.deepEqual(calls, []);
});
