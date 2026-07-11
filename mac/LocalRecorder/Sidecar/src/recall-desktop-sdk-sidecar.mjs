#!/usr/bin/env node
import process from "node:process";
import readline from "node:readline";

import RecallAiSdkImport from "@recallai/desktop-sdk";

import { createRecordingWindowSelector } from "./recording-window.mjs";
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

function addSdkEventListeners(onFatalError) {
  for (const eventName of ["meeting-detected", "recording-ended"]) {
    try {
      RecallAiSdk.addEventListener(eventName, (event) => {
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

  let isStopping = false;
  let windowId = null;
  let cancelParentProcessMonitor = () => {};

  async function stop() {
    if (isStopping) {
      return;
    }

    isStopping = true;
    cancelParentProcessMonitor();

    let exitCode = 0;

    try {
      if (windowId) {
        await RecallAiSdk.stopRecording({ windowId });
        send({ type: "stopped", windowId });
      }
    } catch (error) {
      sendError(error);
      exitCode = 1;
    }

    try {
      await RecallAiSdk.shutdown();
    } catch (error) {
      if (exitCode === 0) {
        sendError(error);
      }
      exitCode = 1;
    }

    process.exit(exitCode);
  }

  process.once("SIGINT", () => {
    void stop();
  });
  process.once("SIGTERM", () => {
    void stop();
  });
  if (parentPid) {
    cancelParentProcessMonitor = startParentProcessMonitor({
      parentPid,
      onParentExit: () => {
        void stop();
      },
    });
  }

  const input = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  input.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (message?.type === "stop") {
        void stop();
      }
    } catch {
      // Ignore malformed control messages.
    }
  });

  const recordingWindowSelector = createRecordingWindowSelector(RecallAiSdk);
  addSdkEventListeners(() => {
    void stop();
  });
  await RecallAiSdk.init({ api_url: apiUrl, apiUrl, restartOnError: false });
  await requestPermission("accessibility");
  await requestPermission("microphone");
  await requestPermission("screen-capture");

  const selection = await recordingWindowSelector.select();
  windowId = selection.windowId;
  await RecallAiSdk.startRecording({ windowId, uploadToken });
  send({ type: "started", windowId, captureMode: selection.captureMode });
}

main().catch((error) => {
  sendError(error);
  process.exitCode = 1;
});
