import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const packageRoot = join(process.cwd(), "mac", "LocalRecorder");
const bundlerPath = join(packageRoot, "script", "bundle_node_runtime.sh");

describe("local recorder app packaging", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("bundles a checksum verified official Node runtime", () => {
    const root = makeTemporaryDirectory();
    const version = "v24.18.0";
    const archiveName = `node-${version}-darwin-arm64.tar.gz`;
    const extractedRoot = join(root, `node-${version}-darwin-arm64`);
    const distRoot = join(root, "dist", version);
    const destination = join(root, "app-node");
    const fakeNode = join(extractedRoot, "bin", "node");

    mkdirSync(join(extractedRoot, "bin"), { recursive: true });
    mkdirSync(distRoot, { recursive: true });
    writeFileSync(fakeNode, "#!/bin/sh\necho bundled-node\n");
    writeFileSync(join(extractedRoot, "LICENSE"), "Node.js test license\n");
    chmodSync(fakeNode, 0o755);
    execFileSync("tar", ["-czf", join(distRoot, archiveName), "-C", root, `node-${version}-darwin-arm64`]);
    const checksum = execFileSync("shasum", ["-a", "256", join(distRoot, archiveName)], {
      encoding: "utf8",
    }).split(/\s+/)[0];
    writeFileSync(join(distRoot, "SHASUMS256.txt"), `${checksum}  ${archiveName}\n`);

    execFileSync("bash", [bundlerPath, destination], {
      env: {
        ...process.env,
        MEETING_NOTE_NODE_ARCH: "arm64",
        MEETING_NOTE_NODE_CACHE_DIR: join(root, "cache"),
        MEETING_NOTE_NODE_DIST_BASE_URL: `file://${join(root, "dist")}`,
        MEETING_NOTE_NODE_VERSION: version,
      },
    });

    expect(
      execFileSync(join(destination, "bin", "node"), { encoding: "utf8" }).trim(),
    ).toBe("bundled-node");
  });

  it("invokes the Node runtime bundler from the app build", () => {
    const buildScript = readFileSync(
      join(packageRoot, "script", "build_and_run.sh"),
      "utf8",
    );

    expect(buildScript).toContain(
      '"$ROOT_DIR/script/bundle_node_runtime.sh" "$APP_RESOURCES/node"',
    );
  });

  it("uses the repository release origin for the Sparkle feed", () => {
    const buildScript = readFileSync(
      join(packageRoot, "script", "build_and_run.sh"),
      "utf8",
    );
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { repository: { url: string } };
    const repositoryUrl = packageJson.repository.url
      .replace(/^git\+/, "")
      .replace(/\.git$/, "");

    expect(buildScript).toContain(
      `SPARKLE_FEED_URL="${repositoryUrl}/releases/download/macos-appcast/appcast.xml"`,
    );
  });

  it("disables library validation for the local development certificate", () => {
    const buildScript = readFileSync(
      join(packageRoot, "script", "build_and_run.sh"),
      "utf8",
    );

    expect(buildScript).toMatch(
      /elif \[\[ "\$CODESIGN_IDENTITY" == "\$LOCAL_CERT_NAME" \]\]; then[\s\S]*?--entitlements "\$ADHOC_APP_ENTITLEMENTS"[\s\S]*?else/,
    );
    expect(buildScript).toMatch(
      /else\s+codesign[\s\S]*?--entitlements "\$ADHOC_APP_ENTITLEMENTS"[\s\S]*?--sign "\$CODESIGN_IDENTITY"/,
    );
  });

  it("requires the stable certificate for release builds", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github", "workflows", "release-macos.yml"),
      "utf8",
    );
    const buildScript = readFileSync(
      join(packageRoot, "script", "build_and_run.sh"),
      "utf8",
    );

    expect(workflow).toContain(
      "MACOS_RELEASE_CERTIFICATE: ${{ secrets.MACOS_RELEASE_CERTIFICATE }}",
    );
    expect(workflow).toContain(
      "MACOS_RELEASE_CERTIFICATE_PASSWORD: ${{ secrets.MACOS_RELEASE_CERTIFICATE_PASSWORD }}",
    );
    expect(workflow).toContain('Authority=Tape Desktop Release');
    expect(workflow).toContain(
      '"$HOME/Library/Keychains/login.keychain-db"',
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("Upload release candidate");
    expect(workflow).toContain("if: github.event_name == 'push'");
    expect(workflow).not.toContain('CODESIGN_IDENTITY: "-"');
    expect(workflow).not.toContain(
      "The release app must use an ad hoc signature.",
    );
    expect(workflow).toContain(
      'echo "BUILD_VERSION=$(date -u +%Y%m%d%H%M%S)"',
    );
    expect(workflow).not.toContain("git rev-list --count");
    expect(buildScript).toContain(
      'BUILD_VERSION="${BUILD_VERSION:-$(date -u +%Y%m%d%H%M%S)}"',
    );
    expect(workflow).toContain(
      'grep -q "<sparkle:version>$BUILD_VERSION</sparkle:version>"',
    );
    expect(workflow).toContain(
      'grep -q "<sparkle:shortVersionString>$APP_VERSION</sparkle:shortVersionString>"',
    );
    expect(workflow).toContain('ARCHIVE_NAME="Tape-Desktop.zip"');
    expect(workflow).toContain("--latest");
  });

  it("signs the desktop app for microphone access", () => {
    const entitlements = readFileSync(
      join(packageRoot, "Resources", "AdHocApp.entitlements"),
      "utf8",
    );

    expect(entitlements).toContain(
      "<key>com.apple.security.device.audio-input</key>",
    );
    expect(entitlements).toMatch(
      /<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\/>/,
    );
  });

  it("identifies the installed app as Tape Desktop", () => {
    const buildScript = readFileSync(
      join(packageRoot, "script", "build_and_run.sh"),
      "utf8",
    );

    expect(buildScript).toContain('APP_DISPLAY_NAME="Tape Desktop"');
    expect(buildScript).toContain(
      'APP_BUNDLE="$DIST_DIR/$APP_DISPLAY_NAME.app"',
    );
    expect(buildScript).toContain("<key>CFBundleDisplayName</key>");
    expect(buildScript).toContain("<string>$APP_DISPLAY_NAME</string>");
    expect(buildScript).toContain(
      "Tape Desktop records your microphone for local meeting recordings.",
    );
    expect(buildScript).toContain("<key>NSAudioCaptureUsageDescription</key>");
  });

  it("documents the Tape Desktop build entrypoint", () => {
    const setupGuide = readFileSync(
      join(process.cwd(), "docs", "setup.md"),
      "utf8",
    );

    expect(setupGuide).toContain("./script/build_and_run.sh --verify");
    expect(setupGuide).toContain("dist/Tape Desktop.app");
    expect(setupGuide).not.toContain(
      "swift build --target MeetingNoteLocalRecorder",
    );
  });

  it("resets every signature bound permission when the app signature changes", () => {
    const buildScript = readFileSync(
      join(packageRoot, "script", "build_and_run.sh"),
      "utf8",
    );

    expect(buildScript).toContain(
      'tccutil reset Microphone "$BUNDLE_ID"',
    );
    expect(buildScript).toContain(
      'tccutil reset ScreenCapture "$BUNDLE_ID"',
    );
    expect(buildScript).toContain(
      'tccutil reset Accessibility "$BUNDLE_ID"',
    );
  });

  it("requests operational permissions only after the user presses the button", () => {
    const appSource = readFileSync(
      join(
        packageRoot,
        "Sources",
        "MeetingNoteLocalRecorder",
        "MeetingNoteLocalRecorderApp.swift",
      ),
      "utf8",
    );
    const requestNextStart = appSource.indexOf(
      "func requestNextPermission()",
    );
    const requestNextEnd = appSource.indexOf(
      "func startRecording()",
      requestNextStart,
    );
    const requestNextSource = appSource.slice(requestNextStart, requestNextEnd);

    expect(requestNextStart).toBeGreaterThan(-1);
    expect(requestNextSource).toContain("requestMicrophonePermission()");
    expect(requestNextSource).toContain(
      "await requestScreenCapturePermission()",
    );
    expect(requestNextSource).toContain("requestAccessibilityPermission()");
    expect(requestNextSource).toContain("requestNotificationPermission()");
    expect(appSource).not.toContain("requestAllPermissionsAtStartup");
    expect(appSource).toMatch(
      /if !bearerToken\.isEmpty \{\s+statusText = "Finish access setup"\s+Task \{\s+await refreshPermissionsAndStartIfReady\(\)\s+\}\s+Task \{\s+await retryQueuedUploadsIfPossible\(\)/,
    );
    expect(appSource).toMatch(
      /func handleLoginCallback[\s\S]*?statusText = "Finish access setup"\s+Task \{\s+await refreshPermissionsAndStartIfReady\(\)/,
    );
    expect(appSource).toMatch(
      /var nextPermissionStep: RecorderPermissionStep\? \{\s+guard isSignedIn else \{\s+return nil/,
    );
    expect(appSource).toMatch(
      /private func requestScreenCapturePermission\(\) async -> PermissionGrant[\s\S]*?SCShareableContent\.excludingDesktopWindows/,
    );
  });

  it("makes missing required permissions actionable without requiring start at login", () => {
    const appSource = readFileSync(
      join(
        packageRoot,
        "Sources",
        "MeetingNoteLocalRecorder",
        "MeetingNoteLocalRecorderApp.swift",
      ),
      "utf8",
    );

    expect(appSource).toContain(
      "requestPermission: model.requestPermission",
    );
    expect(appSource).toContain('Button("Enable", action: action)');
    expect(appSource).toMatch(
      /title: "Start at login",\s+detail: "Optional",\s+grant: checklist\.startAtLogin,\s+toggle: Binding/,
    );
    expect(appSource).toContain(
      "setStartAtLoginEnabled: model.setStartAtLoginEnabled",
    );
    expect(appSource).toContain("try service.register()");
    expect(appSource).toContain("try service.unregister()");
    expect(appSource).toContain(".toggleStyle(.switch)");
  });
});

function makeTemporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "meeting-note-node-bundle-"));
  temporaryDirectories.push(directory);
  return directory;
}
