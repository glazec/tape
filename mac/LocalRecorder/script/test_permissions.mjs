import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

// Compile the actual app methods into a small process. Mock only the system
// permission decision, so no microphone access or TCC changes are needed.
const source = readFileSync(new URL("../Sources/MeetingNoteLocalRecorder/MeetingNoteLocalRecorderApp.swift", import.meta.url), "utf8");
function method(name, next) {
  const privateStart = source.indexOf(`    private func ${name}`);
  const start = privateStart >= 0 ? privateStart : source.indexOf(`    func ${name}`);
  const end = source.indexOf(`    ${next}`, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end).replace("private func", "func");
}

let directory;
before(() => {
  directory = mkdtempSync(join(tmpdir(), "tape-permissions-"));
  writeFileSync(join(directory, "Mock.m"), `
#import <AVFoundation/AVFoundation.h>
#import <objc/runtime.h>
#import <dispatch/dispatch.h>
#include <stdlib.h>
#include <stdio.h>
void installMicrophoneMock(void) {
  Method status = class_getClassMethod([AVCaptureDevice class], @selector(authorizationStatusForMediaType:));
  method_setImplementation(status, imp_implementationWithBlock(^AVAuthorizationStatus(id cls, AVMediaType type) {
    return (AVAuthorizationStatus)atoi(getenv("TAPE_TEST_MIC_STATUS"));
  }));
  Method request = class_getClassMethod([AVCaptureDevice class], @selector(requestAccessForMediaType:completionHandler:));
  method_setImplementation(request, imp_implementationWithBlock(^(id cls, AVMediaType type, void (^handler)(BOOL)) {
    fprintf(stderr, "prompt\\n");
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{
      handler(atoi(getenv("TAPE_TEST_MIC_GRANTED")) != 0);
    });
  }));
}
`);
  writeFileSync(join(directory, "Probe.swift"), `
import AVFoundation
import Foundation
@_silgen_name("installMicrophoneMock") func installMicrophoneMock()
enum LocalRecorderAudioSource { case microphone, computerAudio }
struct SilenceTracker {
  enum Result { case none, prompt }
  func observe(source: LocalRecorderAudioSource, level: Float, at: Date) -> Bool { false }
}
enum PermissionGrant: Sendable { case unknown, granted, denied }
enum RecorderPermissionStep { case microphone, accessibility, screenAndSystemAudio, alerts }
struct Checklist {
  var microphone = PermissionGrant.unknown
  var accessibility = PermissionGrant.unknown
  var screenCapture = PermissionGrant.unknown
  var notifications = PermissionGrant.unknown
}
@MainActor enum RecorderSystemActions {
  static var launches = 0
  static var replacementReady = false
  static func launchReplacement(at url: URL) async throws {
    launches += 1
    try await Task.sleep(for: .milliseconds(50))
    if CommandLine.arguments.contains("failure") { throw URLError(.cannotOpenFile) }
    replacementReady = true
  }
}
@MainActor final class AppStub {
  var terminations = 0
  func terminate(_ sender: Any?) {
    precondition(RecorderSystemActions.replacementReady, "Must wait for a replacement before quitting")
    terminations += 1
  }
}
@MainActor let NSApp = AppStub()
@MainActor final class Probe {
  static let audioLevelSampleCount = 36
  var isRecording = false
  var isTestingLevels = false
  var microphoneLevel: Float = 0
  var systemAudioLevel: Float = 0
  var audioLevels = Array(repeating: Float(0), count: audioLevelSampleCount)
  var endPromptPolicy = SilenceTracker()
  func showSilencePrompt() {}
  var isSignedIn = false
  var isRequestingPermissions = false
  var isRestarting = false
  var permissionChecklist = Checklist()
  var nextPermissionStep: RecorderPermissionStep? = nil
  var statusText = ""
  var canMonitor = false
  var accessibilityRequests = 0
  func canCloseApp() -> Bool { !CommandLine.arguments.contains("recording") }
  func stopLevelTest() {}
  func refreshPermissions() async { try? await Task.sleep(for: .milliseconds(20)) }
  func openMicrophoneSettings() {}
  func openScreenCaptureSettings() {}
  func openNotificationSettings() {}
  func startMonitoring() { fatalError("Signed out permission setup must not monitor") }
  func requestAccessibilityPermission() -> PermissionGrant { accessibilityRequests += 1; return .denied }
  func requestScreenCapturePermission() async -> PermissionGrant { .denied }
  func requestNotificationPermission() async -> PermissionGrant { .denied }
${method("requestMicrophonePermission()", "private func requestNotificationPermission()")}
${method("requestPermission(_ requestedStep:", "func startRecording()")}
${method("restartApp()", "func repairAccessibility()")}
${method("observeAudioLevel(source:", "func toggleLevelTest()")}
}
@main struct Main {
  @MainActor static func main() async {
    installMicrophoneMock()
    let probe = Probe()
    if CommandLine.arguments.contains("levels") {
      probe.isRecording = true
      probe.observeAudioLevel(source: .computerAudio, level: 0.04)
      precondition(probe.audioLevels.last! > 0, "Mac sound must animate the waveform without microphone callbacks")
      probe.observeAudioLevel(source: .microphone, level: 0)
      precondition(probe.audioLevels.last! > 0, "Silent microphone must not erase active Mac sound")
      probe.observeAudioLevel(source: .computerAudio, level: 0)
      precondition(probe.audioLevels.last == 0)
      precondition(probe.audioLevels.count == Probe.audioLevelSampleCount)
      probe.isRecording = false
      probe.isTestingLevels = true
      probe.observeAudioLevel(source: .microphone, level: 1)
      precondition(probe.microphoneLevel == 1 && probe.audioLevels.last == 0)
      print("levels passed")
    } else if CommandLine.arguments.contains("restart") {
      probe.restartApp()
      probe.restartApp()
      precondition(NSApp.terminations == 0)
      try? await Task.sleep(for: .milliseconds(200))
      precondition(!probe.isRestarting)
      print("terminations=\\(NSApp.terminations);launches=\\(RecorderSystemActions.launches);status=\\(probe.statusText)")
    } else if CommandLine.arguments.contains("setup") {
      probe.requestPermission(.accessibility)
      probe.requestPermission(.accessibility)
      try? await Task.sleep(for: .milliseconds(200))
      precondition(probe.accessibilityRequests == 1, "Allow must work before sign in and ignore duplicate clicks")
      precondition(!probe.isRequestingPermissions)
      print("setup completed")
    } else {
      print(await probe.requestMicrophonePermission())
    }
  }
}
`);
  execFileSync("xcrun", ["clang", "-fobjc-arc", "-c", join(directory, "Mock.m"), "-o", join(directory, "Mock.o")]);
  execFileSync("xcrun", ["swiftc", "-O", "-swift-version", "6", "-parse-as-library", join(directory, "Probe.swift"), join(directory, "Mock.o"), "-o", join(directory, "probe")]);
});
after(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

for (const [name, status, granted, expected] of [
  ["microphone approval on a background queue", 0, 1, "granted"],
  ["microphone denial on a background queue", 0, 0, "denied"],
  ["already authorized microphone", 3, 0, "granted"],
  ["previously denied microphone", 2, 1, "denied"],
  ["restricted microphone", 1, 1, "denied"],
]) {
  test(name, () => {
    const result = run([], status, granted);
    assert.equal(result.stdout.trim(), expected);
    assert.equal(result.stderr.trim(), status === 0 ? "prompt" : "");
  });
}
test("Accessibility Allow works before sign in and serializes duplicate clicks", () => {
  assert.equal(run(["setup"], 0, 0).stdout.trim(), "setup completed");
});
test("restart waits for a replacement and ignores duplicate clicks", () => {
  assert.equal(run(["restart"], 0, 0).stdout.trim(), "terminations=1;launches=1;status=");
});
test("failed restart keeps the app open and reports the failure", () => {
  assert.match(run(["restart", "failure"], 0, 0).stdout, /terminations=0;launches=1;status=Could not restart/);
});
test("restart does not interrupt an active recording", () => {
  assert.equal(run(["restart", "recording"], 0, 0).stdout.trim(), "terminations=0;launches=0;status=");
});
function run(args, status, granted) {
  const result = spawnSync(join(directory, "probe"), args, {
    encoding: "utf8", timeout: 10_000,
    env: { ...process.env, TAPE_TEST_MIC_STATUS: String(status), TAPE_TEST_MIC_GRANTED: String(granted) },
  });
  assert.equal(result.status, 0, result.stderr || String(result.error || result.signal));
  return result;
}

test("waveform follows either audio source and stays bounded", () => {
  assert.equal(run(["levels"], 0, 0).stdout.trim(), "levels passed");
});
