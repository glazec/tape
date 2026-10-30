#!/usr/bin/env node
import process from "node:process";
import readline from "node:readline";
import { readFile } from "node:fs/promises";
process.stdout.on("error", (error) => { if (error.code !== "EPIPE") throw error; });

import RecallAiSdkImport from "@recallai/desktop-sdk";

import { createRecordingWindowSelector } from "./recording-window.mjs";
import { createRecordingStartup } from "./recording-startup.mjs";
import { createRecordingLifecycle } from "./recording-lifecycle.mjs";
import { startParentProcessMonitor } from "./parent-monitor.mjs";

const RecallAiSdk = RecallAiSdkImport.default ?? RecallAiSdkImport;

function parseArgs(argv) {
  const args = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (!value.startsWith("--")) {
      continue;
    }

    if (value === "--help") {
      args.set("help", "true");
      continue;
    }

    const key = value.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      args.set(key, "true");
      continue;
    }

    args.set(key, next);
    index += 1;
  }

  return args;
}

function usage() {
  return [
    "usage: recall-desktop-sdk-sidecar.mjs --api-url <url> --upload-token <token> [--parent-pid <pid>]",
    "",
    "stdin: write {\"type\":\"stop\"} to stop the active recording",
  ].join("\n");
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendError(error) {
  send({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
}

async function requestPermission(name) {
  try {
    await RecallAiSdk.requestPermission(name);
  } catch (error) {
    send({
      type: "permission_warning",
      permission: name,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function addSdkEventListeners(onFatalError, onEnded) {
  for (const eventName of ["meeting-detected", "meeting-closed", "recording-ended"]) {
    try {
      RecallAiSdk.addEventListener(eventName, (event) => {
        if (eventName === "recording-ended") onEnded(event);
        send({ type: "sdk_event", event: eventName, payload: event ?? null });
      });
    } catch (error) {
      send({
        type: "event_warning",
        event: eventName,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  RecallAiSdk.addEventListener("error", (error) => {
    sendError(error?.message ?? "Recall Desktop SDK stopped unexpectedly");
    onFatalError();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.has("help")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const apiUrl = args.get("api-url");
  const uploadToken = args.get("upload-token");
  const controlFile = args.get("control-file");
  const parentPidValue = args.get("parent-pid");
  const parentPid = parentPidValue ? Number(parentPidValue) : null;

  if (
    !apiUrl ||
    !uploadToken ||
    (parentPidValue && (!Number.isSafeInteger(parentPid) || parentPid <= 1))
  ) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  let windowId = null;
  let lifecycle;
  let cancelParentProcessMonitor = () => {};
  async function stop() {
    try { await startup.stop(); } catch (error) { sendError(error); }
  }
  // On abnormal parent loss stop capture, but leave the SDK upload alive. Normal
  // app quit is gated until the parent has confirmed the terminal webhook.
  process.once("SIGINT", () => { void stop(); });
  process.once("SIGTERM", () => { void stop(); });
  if (parentPid) {
    cancelParentProcessMonitor = startParentProcessMonitor({ parentPid, onParentExit: () => { void stop(); } });
  }
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (message?.type === "stop") void stop();
      if (message?.type === "shutdown") {
        cancelParentProcessMonitor();
        void lifecycle?.shutdown().catch(sendError);
      }
    } catch { /* Ignore malformed control messages. */ }
  });

  const recordingWindowSelector = createRecordingWindowSelector(RecallAiSdk);
  addSdkEventListeners(() => {
    void stop();
  }, (event) => {
    if (event?.window?.id === windowId) lifecycle?.ended();
  });
  const startup = createRecordingStartup({
    sdk: RecallAiSdk,
    select: () => recordingWindowSelector.select(),
    uploadToken,
    makeLifecycle: (id) => {
      windowId = id;
      lifecycle = createRecordingLifecycle({ sdk: RecallAiSdk, send, windowId, exit: (code) => process.exit(code) });
      if (controlFile) {
        setInterval(async () => {
          try {
            if ((await readFile(controlFile, "utf8")).trim() === "shutdown") await lifecycle.shutdown();
          } catch { /* No recovery command yet, or shutdown is not ready. */ }
        }, 1_000);
      }
      return lifecycle;
    },
    prepared: (id) => send({ type: "prepared", windowId: id }),
    started: (selection, cancelled) => send({ type: "started", ...selection, cancelled }),
  });
  try {
    await RecallAiSdk.init({ api_url: apiUrl, apiUrl, restartOnError: false });
    await requestPermission("accessibility");
    await requestPermission("microphone");
    await requestPermission("screen-capture");
    if (!await startup.run()) {
      await RecallAiSdk.shutdown();
      send({ type: "cancelled" });
      process.exit(0);
    }
  } catch (error) {
    sendError(error);
    if (!lifecycle) {
      await RecallAiSdk.shutdown();
      send({ type: "cancelled" });
      process.exit(1);
    }
    // A started/uncertain capture keeps its upload alive until terminal status.
  }

}

main().catch((error) => {
  sendError(error);
  process.exitCode = 1;
});
