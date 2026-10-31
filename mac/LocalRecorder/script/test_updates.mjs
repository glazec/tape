import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const versionScript = new URL("./app_version.sh", import.meta.url).pathname;
const source = readFileSync(new URL("../Sources/MeetingNoteLocalRecorder/MeetingNoteLocalRecorderApp.swift", import.meta.url), "utf8");
let directory;
let repository;

before(() => {
  directory = mkdtempSync(join(tmpdir(), "tape-updates-"));
  repository = join(directory, "repository");
  execFileSync("git", ["init", "-q", repository]);
  execFileSync("git", ["-C", repository, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "Initial"]);
  execFileSync("git", ["-C", repository, "tag", "mac-v0.3.6"]);

  function method(startText, endText) {
    const start = source.indexOf(startText);
    const end = source.indexOf(endText, start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
  }
  writeFileSync(join(directory, "Probe.swift"), `
import Foundation
struct NSApplication {
  enum TerminateReply { case terminateNow, terminateCancel }
  struct ModalResponse: Equatable {
    static let alertSecondButtonReturn = ModalResponse()
  }
}
final class NSAlert {
  enum Style { case warning }
  var alertStyle = Style.warning
  var messageText = ""
  var informativeText = ""
  func addButton(withTitle: String) {}
  // Choose Quit anyway whenever the app offers it.
  @discardableResult func runModal() -> NSApplication.ModalResponse { .alertSecondButtonReturn }
}
struct Recovery {
  var targets: [Int] = []
  var sdkDrains: [Int] = []
  var pendingStart: Int?
  var pendingLegacyIntent: Int?
}
class SPUUpdater {}
class SUAppcastItem {}
protocol SPUUpdaterDelegate: AnyObject {}
class SPUStandardUpdaterController {
  static var delegate: SPUUpdaterDelegate?
  init(startingUpdater: Bool, updaterDelegate: SPUUpdaterDelegate?, userDriverDelegate: Any?) {
    precondition(startingUpdater)
    Self.delegate = updaterDelegate
  }
  func checkForUpdates(_ sender: Any?) {}
}
${method("private final class LocalRecorderUpdater", "private final class LocalRecorderAppDelegate")}
final class Probe {
  var isRecording = false
  var isFinishingRecording = false
  var isStartingRecording = false
  var pendingUploadCount = 0
  var recoveryState = Recovery()
${method("    func canCloseApp(", "    private func refreshPermissions()")}
}
let recorderAppModel = Probe()
private let updater = LocalRecorderUpdater.shared
precondition(!updater.requiresSafeQuit)
precondition(SPUStandardUpdaterController.delegate === updater)
if !CommandLine.arguments.contains("no-update") {
  if CommandLine.arguments.contains("manual-update") {
    updater.updater(SPUUpdater(), willInstallUpdate: SUAppcastItem())
  } else {
    var requestedRestart = false
    let takesOverInstallation = updater.updater(SPUUpdater(), willInstallUpdateOnQuit: SUAppcastItem()) {
      requestedRestart = true
    }
    precondition(!takesOverInstallation && !requestedRestart)
  }
  precondition(updater.requiresSafeQuit)
}
${method("    func applicationShouldTerminate(", "    func applicationShouldHandleReopen(")}
switch CommandLine.arguments.last! {
case "recording": recorderAppModel.isRecording = true
case "starting": recorderAppModel.isStartingRecording = true
case "finishing": recorderAppModel.isFinishingRecording = true
case "upload": recorderAppModel.pendingUploadCount = 1
case "target": recorderAppModel.recoveryState.targets = [1]
case "sdk": recorderAppModel.recoveryState.sdkDrains = [1]
case "start": recorderAppModel.recoveryState.pendingStart = 1
case "legacy": recorderAppModel.recoveryState.pendingLegacyIntent = 1
default: break
}
print(applicationShouldTerminate(NSApplication()) == .terminateNow ? "quit" : "wait")
`);
  execFileSync("swiftc", [join(directory, "Probe.swift"), "-o", join(directory, "probe")]);
});

after(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

function version(env = {}, cwd = repository) {
  return spawnSync("bash", [versionScript], {
    cwd,
    env: { ...process.env, APP_VERSION: "", BUILD_CONFIGURATION: "debug", ...env },
    encoding: "utf8",
  });
}

test("local builds identify the nearest release and development status", () => {
  const result = version();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "0.3.6-dev");
});

test("source without release tags is explicitly a development build", () => {
  const result = version({}, directory);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "0.0.0-dev");
});

test("release packaging preserves the supplied release version", () => {
  const result = version({ APP_VERSION: "0.3.7", BUILD_CONFIGURATION: "release" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "0.3.7");
});

test("release packaging refuses an absent or malformed release version", () => {
  for (const appVersion of ["", "0.3.7-dev", "0.3", "<invalid>"]) {
    const result = version({ APP_VERSION: appVersion, BUILD_CONFIGURATION: "release" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Release builds require APP_VERSION in MAJOR.MINOR.PATCH format/);
  }
});

test("an explicit local version is preserved", () => {
  const result = version({ APP_VERSION: "0.3.7-dev" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "0.3.7-dev");
});

for (const state of ["recording", "starting", "finishing", "upload", "target", "sdk", "start", "legacy", "idle"]) {
  for (const update of ["automatic-update", "manual-update"]) {
    test(`${update} termination during ${state} respects recording and saving`, () => {
      const result = execFileSync(join(directory, "probe"), [update, state], { encoding: "utf8" });
      assert.equal(result.trim(), state === "idle" ? "quit" : "wait");
    });
  }
}

test("without an update, explicit Quit anyway remains available for saved pending uploads", () => {
  const result = execFileSync(join(directory, "probe"), ["no-update", "upload"], { encoding: "utf8" });
  assert.equal(result.trim(), "quit");
});
