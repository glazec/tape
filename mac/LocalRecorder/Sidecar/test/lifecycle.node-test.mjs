import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("../src/recall-desktop-sdk-sidecar.mjs", import.meta.url),
  "utf8",
);

test("awaits SDK initialization and permission requests", () => {
  assert.match(source, /await RecallAiSdk\.init\(/);
  assert.match(source, /await RecallAiSdk\.requestPermission\(name\)/);
});

test("shuts down the SDK before the sidecar process exits", () => {
  const shutdownIndex = source.indexOf("await RecallAiSdk.shutdown()");
  const exitIndex = source.lastIndexOf("process.exit(");

  assert.notEqual(shutdownIndex, -1);
  assert.ok(exitIndex > shutdownIndex);
});

test("accepts the parent app process id for orphan cleanup", () => {
  assert.match(source, /args\.get\("parent-pid"\)/);
  assert.match(source, /startParentProcessMonitor\(/);
});

test("stops the sidecar when the native SDK reports an error", () => {
  assert.match(source, /addEventListener\("error"/);
  assert.match(source, /onFatalError\(\)/);
});
