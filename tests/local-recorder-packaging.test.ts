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
});

function makeTemporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "meeting-note-node-bundle-"));
  temporaryDirectories.push(directory);
  return directory;
}
