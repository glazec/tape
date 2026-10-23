import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { expect, it } from "vitest";

it("starts the bundled worker with real Node dependencies and serves health", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".worker-smoke-"));
  const outfile = path.join(directory, "server.mjs");
  try {
    await build({
      entryPoints: ["services/image-worker/server.ts"], bundle: true,
      platform: "node", target: "node24", format: "esm", packages: "external", outfile,
    });
    const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `
      const { startImageWorkerServer } = await import(${JSON.stringify(outfile)});
      const server = await startImageWorkerServer(0);
      try {
        const response = await fetch('http://127.0.0.1:' + server.address().port + '/health');
        if (!response.ok) throw new Error('Health returned ' + response.status);
        console.log(JSON.stringify(await response.json()));
      } finally { server.close(); server.closeAllConnections(); }
    `], { timeout: 15000, env: { PATH: process.env.PATH, NODE_ENV: "test", DATABASE_URL: "postgresql://test:test@localhost:5432/test" } });
    expect(stdout).toContain('"ok":true');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);
