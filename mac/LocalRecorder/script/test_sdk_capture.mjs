import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

// Exercise the actual process controller using a fake sidecar, without capture,
// permissions, network requests, or provider SDK initialization.
let directory;
before(() => {
  directory = mkdtempSync(join(tmpdir(), "tape-sdk-capture-"));
  const controller = readFileSync(new URL("../Sources/MeetingNoteLocalRecorder/RecallDesktopSDKCapture.swift", import.meta.url), "utf8").replace("import LocalRecorderCore", "");
  const core = readFileSync(new URL("../Sources/LocalRecorderCore/RecorderWorkflow.swift", import.meta.url), "utf8");
  const lifecycle = core.slice(core.indexOf("public enum RecorderSDKEvent"), core.indexOf("public enum RecorderRecoveryPolicy"));
  writeFileSync(join(directory, "sidecar.mjs"), `
import readline from "node:readline";
import { closeSync } from "node:fs";
if (process.env.TAPE_TEST_SDK_EXIT_MODE === "pipe-race") closeSync(0);
process.stdout.write(JSON.stringify({ type: "started", windowId: "window" }) + "\\n");
if (process.env.TAPE_TEST_SDK_EXIT_MODE === "startup-exit") process.exit(9);
if (["before-stop", "pipe-race"].includes(process.env.TAPE_TEST_SDK_EXIT_MODE)) setTimeout(() => process.exit(9), 120);
if (process.env.TAPE_TEST_SDK_EXIT_MODE !== "pipe-race") readline.createInterface({input: process.stdin}).on("line", line => {
  const command = JSON.parse(line);
  if (command.type === "stop") process.exit(8); // Deliberately no stopped ack.
  if (command.type === "shutdown") process.exit(0);
});
`);
  writeFileSync(join(directory, "Probe.swift"), `
${controller}
${lifecycle}
struct RecallSDKUploadResponse: Sendable {
  var recallApiUrl: String
  var uploadToken: String
  var sdkUploadId: String
}
enum LocalRecorderFileLocations {
  static func uploadQueueDirectoryURL() -> URL { URL(fileURLWithPath: ProcessInfo.processInfo.environment["TAPE_TEST_SDK_DIRECTORY"]!).appendingPathComponent("queue") }
}
@main struct Main {
  @MainActor static func main() async throws {
    let controller = RecallDesktopSDKRecordingController()
    var unexpected = 0
    controller.onUnexpectedTermination = { _ in unexpected += 1 }
    let upload = RecallSDKUploadResponse(recallApiUrl: "https://example.com", uploadToken: "fake", sdkUploadId: "fake-upload")
    let mode = ProcessInfo.processInfo.environment["TAPE_TEST_SDK_EXIT_MODE"]
    do { try await controller.start(upload: upload, clientRecordingId: "first") }
    catch { if mode != "startup-exit" { throw error } }
    if mode == "startup-exit" {
      precondition(controller.didCaptureStart("first"), "Exit during startup must not erase the actual capture")
      try await controller.shutdown(clientRecordingId: "first")
      print("upload evidence retained until cleanup")
      return
    }
    if ProcessInfo.processInfo.environment["TAPE_TEST_SDK_EXIT_MODE"] == "before-stop" {
      try await Task.sleep(for: .milliseconds(250))
      precondition(unexpected == 1)
    }
    let result = try await controller.stop()
    precondition(result.didCaptureStart, "Process exit must retain capture evidence")
    precondition(controller.didCaptureStart("first"), "Capture evidence must survive until terminal drain cleanup")
    // A new capture can begin independently while the prior upload drains.
    try await controller.start(upload: upload, clientRecordingId: "second")
    _ = try await controller.stop()
    try await controller.shutdown(clientRecordingId: "first")
    try await controller.shutdown(clientRecordingId: "second")
    precondition(!controller.didCaptureStart("first"))
    print("capture stopped; upload evidence retained until cleanup")
  }
}
`);
  execFileSync("xcrun", ["swiftc", "-swift-version", "6", "-parse-as-library", join(directory, "Probe.swift"), "-o", join(directory, "probe")]);
});
after(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
for (const mode of ["before-stop", "during-stop", "startup-exit", "pipe-race"]) {
  test(`SDK process exits ${mode} without a stopped acknowledgment`, () => {
    const output = execFileSync(join(directory, "probe"), [], {
      encoding: "utf8", timeout: 15_000,
      env: { ...process.env, MEETING_NOTE_RECALL_SDK_NODE: process.execPath,
        MEETING_NOTE_RECALL_SDK_SIDECAR_SCRIPT: join(directory, "sidecar.mjs"),
        TAPE_TEST_SDK_DIRECTORY: directory, TAPE_TEST_SDK_EXIT_MODE: mode },
    });
    assert.match(output, /upload evidence retained until cleanup/);
  });
}
