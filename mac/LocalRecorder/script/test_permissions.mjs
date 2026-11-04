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

const systemSource = readFileSync(new URL("../Sources/MeetingNoteLocalRecorder/RecorderSystemActions.swift", import.meta.url), "utf8");
const repairPermissionEnum = systemSource.slice(systemSource.indexOf("    enum RepairPermission:"), systemSource.indexOf("    enum Failure:"));
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
  var screenCapture = PermissionGrant.unknown
  var accessibility = PermissionGrant.unknown
  var notifications = PermissionGrant.unknown
  var startAtLogin = PermissionGrant.unknown
}
typealias PermissionChecklist = Checklist
func CGPreflightScreenCaptureAccess() -> Bool { CommandLine.arguments.contains("screen-granted") }
func AXIsProcessTrusted() -> Bool { CommandLine.arguments.contains("accessibility-granted") }
struct NotificationSettings {
  enum Status { case authorized, provisional, ephemeral, notDetermined, denied }
  var authorizationStatus: Status
}
struct NotificationCenterStub {
  func notificationSettings() async -> NotificationSettings {
    NotificationSettings(authorizationStatus: CommandLine.arguments.contains("notifications-granted") ? .authorized : .notDetermined)
  }
}
@MainActor final class RefreshProbe {
  var permissionChecklist = Checklist()
  let notificationCenter = NotificationCenterStub()
  func currentStartAtLoginPermission() -> PermissionGrant { .unknown }
${method("refreshPermissions()", "private func refreshPermissionsAndStartIfReady()")}
${method("currentScreenCapturePermission()", "private func currentAccessibilityPermission()")}
${method("currentAccessibilityPermission()", "private func currentMicrophonePermission()")}
${method("currentMicrophonePermission()", "private func currentNotificationPermission()")}
${method("currentNotificationPermission()", "private func currentStartAtLoginPermission()")}
}
@MainActor enum RecorderSystemActions {
${repairPermissionEnum}
  static var selected: RepairPermission {
    if CommandLine.arguments.contains("screen") { return .screenCapture }
    if CommandLine.arguments.contains("notifications") { return .notifications }
    if CommandLine.arguments.contains("microphone") { return .microphone }
    return .accessibility
  }
  static var resets = 0
  static func repairPermission(_ permission: RepairPermission, bundleIdentifier: String, applicationURL: URL) async throws {
    precondition(bundleIdentifier == "test.tape")
    precondition(permission == selected)
    precondition(applicationURL == Bundle.main.bundleURL)
    precondition(permission.resetService == (permission == .notifications ? nil : permission.rawValue))
    resets += 1
    if CommandLine.arguments.contains("reset-failure") { throw URLError(.noPermissionsToReadFile) }
  }
  static var launches = 0
  static var replacementReady = false
  static func launchReplacement(at url: URL, arguments: [String] = []) async throws {
    if CommandLine.arguments.contains("repair") {
      precondition(resets == 1, "Reset must complete before relaunch")
      precondition(arguments == [selected.launchArgument])
      precondition(url == Bundle.main.bundleURL)
    }
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
  var screenRequests = 0
  var notificationRequests = 0
  var notificationSettingsOpened = false
  func canCloseApp() -> Bool { !CommandLine.arguments.contains("recording") }
  func stopLevelTest() {}
  func refreshPermissions() async { try? await Task.sleep(for: .milliseconds(20)) }
  func openAccessibilitySettings() {}
  func openMicrophoneSettings() {}
  func openScreenCaptureSettings() {}
  func openNotificationSettings() { notificationSettingsOpened = true }
  func startMonitoring() { fatalError("Signed out permission setup must not monitor") }
  func requestAccessibilityPermission() -> PermissionGrant { accessibilityRequests += 1; return .denied }
  func requestScreenCapturePermission() async -> PermissionGrant { screenRequests += 1; return .denied }
  func requestNotificationPermission() async -> PermissionGrant { notificationRequests += 1; return .denied }
${method("requestMicrophonePermission()", "private func requestNotificationPermission()")}
${method("requestPermission(_ requestedStep:", "func startRecording()")}
${method("restartApp()", "func repairPermission(")}
${method("repairPermissionAndRelaunch(_ permission:", "private func resumePermissionRepair(")}
${method("resumePermissionRepair(arguments:", "func showAppInFinder()")}
${method("observeAudioLevel(source:", "func toggleLevelTest()")}
}
@main struct Main {
  @MainActor static func main() async {
    installMicrophoneMock()
    let probe = Probe()
    if CommandLine.arguments.contains("refresh") {
      let refresh = RefreshProbe()
      // Simulate stale UI state from an older process. Live checks must replace it.
      refresh.permissionChecklist = Checklist(microphone: .granted, screenCapture: .granted, accessibility: .granted, notifications: .granted)
      await refresh.refreshPermissions()
      let state = refresh.permissionChecklist
      precondition(RecorderSystemActions.resets == 0)
      precondition(RecorderSystemActions.launches == 0)
      print("microphone=\\(state.microphone);screen=\\(state.screenCapture);accessibility=\\(state.accessibility);notifications=\\(state.notifications)")
    } else if CommandLine.arguments.contains("repair") {
      probe.permissionChecklist.accessibility = .denied
      await probe.repairPermissionAndRelaunch(RecorderSystemActions.selected, bundleIdentifier: "test.tape")
      precondition(!probe.isRestarting)
      precondition(probe.accessibilityRequests == 0 && probe.screenRequests == 0, "Old process must not request access again")
      print("resets=\\(RecorderSystemActions.resets);launches=\\(RecorderSystemActions.launches);terminations=\\(NSApp.terminations);status=\\(probe.statusText)")
    } else if CommandLine.arguments.contains("resume") {
      await probe.resumePermissionRepair(arguments: CommandLine.arguments)
      print("accessibility=\\(probe.accessibilityRequests);screen=\\(probe.screenRequests);notifications=\\(probe.notificationRequests);notificationSettings=\\(probe.notificationSettingsOpened);microphone=\\(probe.permissionChecklist.microphone)")
    } else if CommandLine.arguments.contains("levels") {
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

test("Accessibility repair resets before relaunching the exact app with a fresh request", () => {
  assert.equal(run(["repair"], 0, 0).stdout.trim(), "resets=1;launches=1;terminations=1;status=");
});
test("failed Accessibility reset does not relaunch or terminate", () => {
  assert.match(run(["repair", "reset-failure"], 0, 0).stdout, /resets=1;launches=0;terminations=0;status=Reset failed/);
});
test("failed relaunch after Accessibility reset keeps the app open with accurate recovery", () => {
  assert.match(run(["repair", "failure"], 0, 0).stdout, /resets=1;launches=1;terminations=0;status=Access reset, but restart failed/);
});

for (const [name, args, expected] of [
  ["Screen capture repair resets and relaunches", ["repair", "screen"], /resets=1;launches=1;terminations=1;status=/],
  ["Screen capture reset failure keeps app open", ["repair", "screen", "reset-failure"], /resets=1;launches=0;terminations=0;status=Reset failed.*Screen and system audio/],
  ["Screen capture relaunch failure keeps app open", ["repair", "screen", "failure"], /resets=1;launches=1;terminations=0;status=Access reset, but restart failed.*Screen and system audio/],
  ["Fresh process requests only screen capture", ["resume", "--repair-ScreenCapture"], /accessibility=0;screen=1/],
  ["Fresh process requests only Accessibility", ["resume", "--repair-Accessibility"], /accessibility=1;screen=0/],
  ["Normal launch does not request permissions", ["resume"], /accessibility=0;screen=0/],
]) {
  test(name, () => assert.match(run(args, 0, 0).stdout, expected));
}

for (const [name, args, expected] of [
  ["Microphone repair relaunches after reset", ["repair", "microphone"], /resets=1;launches=1;terminations=1;status=/],
  ["Notification repair relaunches after registration", ["repair", "notifications"], /resets=1;launches=1;terminations=1;status=/],
  ["Notification registration failure does not claim a reset", ["repair", "notifications", "reset-failure"], /resets=1;launches=0;terminations=0;status=Repair failed/],
  ["Notification restart failure does not claim a reset", ["repair", "notifications", "failure"], /resets=1;launches=1;terminations=0;status=Restart failed/],
  ["Fresh process requests notifications and opens settings on denial", ["resume", "--repair-Notifications"], /accessibility=0;screen=0;notifications=1;notificationSettings=true/],
  ["Fresh process requests microphone", ["resume", "--repair-Microphone"], /accessibility=0;screen=0;notifications=0;notificationSettings=false;microphone=denied/],
]) {
  test(name, () => assert.match(run(args, 0, 0).stdout, expected));
}

for (const [name, args, micStatus, expected] of [
  ["fresh install checks real access without prompting or resetting", [], 0,
    "microphone=unknown;screen=denied;accessibility=denied;notifications=unknown"],
  ["updated app keeps existing grants without prompting or resetting", ["screen-granted", "accessibility-granted", "notifications-granted"], 3,
    "microphone=granted;screen=granted;accessibility=granted;notifications=granted"],
  ["stale Accessibility approval cannot make setup ready", ["screen-granted", "notifications-granted"], 3,
    "microphone=granted;screen=granted;accessibility=denied;notifications=granted"],
  ["stale screen approval cannot make setup ready", ["accessibility-granted", "notifications-granted"], 3,
    "microphone=granted;screen=denied;accessibility=granted;notifications=granted"],
]) {
  test(name, () => {
    const result = run(["refresh", ...args], micStatus, 0);
    assert.equal(result.stdout.trim(), expected);
    assert.equal(result.stderr.trim(), "");
  });
}
