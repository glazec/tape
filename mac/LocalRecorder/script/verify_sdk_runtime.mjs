import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

// Signature verification alone does not prove that a signed helper can load its
// libraries. Exercise the packaged runtime without requesting capture access.
if (!process.argv[2]) throw new Error("Usage: node verify_sdk_runtime.mjs <app bundle>");
const app = resolve(process.argv[2]);
const resources = join(app, "Contents", "Resources");
const sdkURL = pathToFileURL(join(resources, "RecallDesktopSDKSidecar", "node_modules", "@recallai", "desktop-sdk", "index.js")).href;
execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "pipe" });
const output = execFileSync(join(resources, "node", "bin", "node"), ["--input-type=module", "-e", `
  import imported from ${JSON.stringify(sdkURL)};
  const sdk = imported.default ?? imported;
  await sdk.init({ acquirePermissionsOnStartup: [], restartOnError: false, telemetryMode: "off" });
  await sdk.shutdown();
  console.log("Packaged SDK initialized and shut down successfully");
`], { encoding: "utf8", timeout: 30_000 });
process.stdout.write(output);
