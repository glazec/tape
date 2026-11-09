import assert from "node:assert/strict";
import { test } from "node:test";
import { abandonStartup } from "../src/abandon-startup.mjs";

function harness(shutdown) {
  const sent = [];
  const exits = [];
  return {
    sent,
    exits,
    options: {
      sdk: { shutdown },
      send: message => sent.push(message),
      exit: code => exits.push(code),
    },
  };
}

test("a dead SDK helper still acknowledges cancellation and exits", async () => {
  const { sent, exits, options } = harness(async () => {
    throw new Error("The Desktop SDK is not started or is no longer accepting commands");
  });
  await abandonStartup({ ...options, code: 1 });
  assert.deepEqual(sent, [{ type: "cancelled" }]);
  assert.deepEqual(exits, [1]);
});

test("a healthy SDK shuts down before cancellation is acknowledged", async () => {
  const order = [];
  const { sent, exits, options } = harness(async () => { order.push("shutdown"); });
  options.send = message => { order.push(message.type); sent.push(message); };
  await abandonStartup({ ...options, code: 0 });
  assert.deepEqual(order, ["shutdown", "cancelled"]);
  assert.deepEqual(exits, [0]);
});

test("a shutdown that never settles cannot hold the acknowledgement", async () => {
  const { sent, exits, options } = harness(() => new Promise(() => {}));
  await abandonStartup({ ...options, code: 1, shutdownTimeoutMs: 5 });
  assert.deepEqual(sent, [{ type: "cancelled" }]);
  assert.deepEqual(exits, [1]);
});
