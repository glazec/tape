import assert from "node:assert/strict";
import { test } from "node:test";

import { startParentProcessMonitor } from "../src/parent-monitor.mjs";

test("stops the recording when the parent app no longer exists", async () => {
  let stopped = false;
  const cancel = startParentProcessMonitor({
    intervalMs: 1,
    onParentExit() {
      stopped = true;
    },
    parentPid: 123,
    processApi: {
      kill() {
        throw new Error("ESRCH");
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  cancel();

  assert.equal(stopped, true);
});
