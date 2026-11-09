import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { configureMeetingAutomation } from "../src/meeting-automation.mjs";

function fixture(request) {
  const sdk = new EventEmitter();
  sdk.addEventListener = sdk.on;
  sdk.removeEventListener = sdk.off;
  const calls = [];
  sdk.init = async config => {
    calls.push(config);
    sdk.emit("permission-status", { permission: "browser-automation", status: "denied" });
  };
  sdk.requestPermission = async permission => { calls.push(permission); await request(sdk, permission); };
  sdk.shutdown = async () => calls.push("shutdown");
  return { sdk, calls };
}

test("only explicit setup requests automation and waits for the matching grant", async () => {
  const { sdk, calls } = fixture(async (sdk, permission) => {
    sdk.emit("permission-status", { permission: "microphone", status: "denied" });
    sdk.emit("permission-status", { permission, status: "not_requested" });
    sdk.emit("permission-status", { permission, status: "granted" });
  });
  assert.equal(await configureMeetingAutomation(sdk, "browser-automation"), "granted");
  assert.deepEqual(calls, [{ acquirePermissionsOnStartup: [], restartOnError: false }, "browser-automation", "shutdown"]);
  assert.equal(sdk.listenerCount("permission-status"), 0);
});

test("request acceptance without a permission result times out, never claims readiness", async () => {
  const { sdk } = fixture(async () => {});
  assert.equal(await configureMeetingAutomation(sdk, "zoom-raw-media", 5), "timeout");
});

test("denial is retained and unsupported setup does not initialize SDK", async () => {
  const { sdk, calls } = fixture(async (sdk, permission) => sdk.emit("permission-status", { permission, status: "denied" }));
  assert.equal(await configureMeetingAutomation(sdk, "browser-automation"), "denied");
  const previous = calls.length;
  await assert.rejects(configureMeetingAutomation(sdk, "full-disk-access"), /Unsupported/);
  assert.equal(calls.length, previous);
});

test("initialization failure is not hidden by a shutdown error", async () => {
  const { sdk, calls } = fixture(async () => {});
  sdk.init = async () => { throw new Error("SDK library could not load"); };
  sdk.shutdown = async () => { throw new Error("SDK is not started"); };
  await assert.rejects(configureMeetingAutomation(sdk, "browser-automation"), /SDK library could not load/);
  assert.deepEqual(calls, []);
});
