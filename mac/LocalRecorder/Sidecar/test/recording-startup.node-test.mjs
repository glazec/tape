import assert from "node:assert/strict";
import { test } from "node:test";
import { createRecordingStartup } from "../src/recording-startup.mjs";
const deferred = () => { let resolve; return { promise: new Promise(r => { resolve = r; }), resolve: () => resolve() }; };
test("cancellation during window discovery never starts capture", async () => {
  const discovery = deferred(); const calls = [];
  const startup = createRecordingStartup({
    select: async () => { await discovery.promise; return { windowId: "window" }; },
    sdk: { startRecording: async () => calls.push("start") }, uploadToken: "token",
    makeLifecycle: () => ({ stop: async () => calls.push("stop") }),
    prepared: () => calls.push("prepared"), started: () => calls.push("started"),
  });
  const running = startup.run(); await startup.stop(); discovery.resolve();
  assert.equal(await running, false); assert.deepEqual(calls, []);
});
test("cancellation during native start awaits start then confirms capture stop", async () => {
  const start = deferred(); const entered = deferred(); const calls = [];
  const startup = createRecordingStartup({
    select: async () => ({ windowId: "window" }), uploadToken: "token",
    sdk: { startRecording: async () => { calls.push("start"); entered.resolve(); await start.promise; } },
    makeLifecycle: () => ({ stop: async () => calls.push("stopped") }),
    prepared: () => calls.push("prepared"), started: (_, cancelled) => calls.push(cancelled ? "cancelled-ready" : "started"),
  });
  const running = startup.run(); await entered.promise; await startup.stop();
  assert.deepEqual(calls, ["prepared", "start"]);
  start.resolve(); assert.equal(await running, true);
  assert.deepEqual(calls, ["prepared", "start", "cancelled-ready", "stopped"]);
});
