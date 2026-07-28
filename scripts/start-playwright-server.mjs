import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const authenticated = process.env.PLAYWRIGHT_AUTHENTICATED === "true";
const port = requirePort(process.env.PLAYWRIGHT_PORT);
const nextArguments = ["run", "dev", "--", "--port", port, "--webpack"];
const projectDirectory = process.cwd();
const serverDirectory = requirePlaywrightServerDirectory(
  process.env.PLAYWRIGHT_SERVER_DIRECTORY,
);
const ignoredTopLevelEntries = new Set([
  ".claude",
  ".git",
  ".next",
  ".playwright-mcp",
  ".superpowers",
  ".swiftpm",
  ".vercel",
  ".worktrees",
  "coverage",
  "dist",
  "node_modules",
  "output",
  "playwright-report",
  "test-results",
]);

rmSync(serverDirectory, { force: true, recursive: true });
mkdirSync(serverDirectory, { recursive: true });

for (const entry of readdirSync(projectDirectory, { withFileTypes: true })) {
  if (ignoredTopLevelEntries.has(entry.name) || entry.name.startsWith(".env")) {
    continue;
  }

  cpSync(
    join(projectDirectory, entry.name),
    join(serverDirectory, entry.name),
    { recursive: true },
  );
}

symlinkSync(
  join(projectDirectory, "node_modules"),
  join(serverDirectory, "node_modules"),
  "dir",
);

if (authenticated) {
  const certificateDirectory = join(
    serverDirectory,
    "test-results",
    "playwright-certificate",
  );
  const certificatePath = join(certificateDirectory, "localhost.pem");
  const keyPath = join(certificateDirectory, "localhost-key.pem");

  mkdirSync(certificateDirectory, { recursive: true });
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certificatePath,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  nextArguments.push(
    "--experimental-https",
    "--experimental-https-key",
    keyPath,
    "--experimental-https-cert",
    certificatePath,
  );
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const server = spawn(npmCommand, nextArguments, {
  cwd: serverDirectory,
  env: process.env,
  stdio: "inherit",
});

let stopping = false;
let cleanedUp = false;

function cleanUp() {
  if (cleanedUp) {
    return;
  }

  cleanedUp = true;
  rmSync(serverDirectory, { force: true, recursive: true });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    server.kill(signal);
  });
}

server.on("exit", (code) => {
  cleanUp();
  process.exit(stopping ? 0 : (code ?? 1));
});

process.on("exit", cleanUp);

function requirePort(value) {
  const portValue = value ?? "3100";
  const portNumber = Number(portValue);

  if (
    !/^\d+$/.test(portValue) ||
    !Number.isInteger(portNumber) ||
    portNumber < 1 ||
    portNumber > 65_535
  ) {
    throw new Error("PLAYWRIGHT_PORT must be an integer from 1 to 65535");
  }

  return portValue;
}

function requirePlaywrightServerDirectory(value) {
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
