import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";

export default function globalTeardown() {
  if (process.env.PLAYWRIGHT_BASE_URL) {
    return;
  }

  const serverDirectory = requirePlaywrightServerDirectory(
    process.env.PLAYWRIGHT_SERVER_DIRECTORY,
  );
  const cleanup = spawn(
    process.execPath,
    [
      "-e",
      "setTimeout(() => require('node:fs').rmSync(process.argv[1], { force: true, recursive: true }), 1500)",
      serverDirectory,
    ],
    {
      detached: true,
      stdio: "ignore",
    },
  );

  cleanup.unref();
}

function requirePlaywrightServerDirectory(value: string | undefined) {
  if (!value) {
    throw new Error("PLAYWRIGHT_SERVER_DIRECTORY is required");
  }

  const resolvedDirectory = resolve(value);

  if (
    dirname(resolvedDirectory) !== resolve(tmpdir()) ||
    !basename(resolvedDirectory).startsWith("tape-playwright-server-")
  ) {
    throw new Error(
      "PLAYWRIGHT_SERVER_DIRECTORY must be a tape-playwright-server directory inside the system temporary directory",
    );
  }

  return resolvedDirectory;
}
