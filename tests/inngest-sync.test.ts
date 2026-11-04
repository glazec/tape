import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { expect, it } from "vitest";
function sync(appUrl: string, apiHost: string) {
 return new Promise<{ code: number | null; error: string }>(resolve => {
   const child = spawn(process.execPath, ["scripts/sync-inngest.mjs"], { env: { ...process.env, NEXT_PUBLIC_APP_URL: appUrl, INNGEST_BASE_URL: apiHost }, stdio: ["ignore", "ignore", "pipe"] });
   let error = ""; child.stderr.on("data", chunk => { error += chunk; });
   child.on("close", code => resolve({ code, error }));
 });
}
it.each(["http://localhost:3210", "http://127.0.0.1:3117", "http://[::1]:3100"])("does not redirect production jobs to %s", async url => {
 const result = await sync(url, "https://workflow.example.test");
 expect(result.code).toBe(1);
 expect(result.error).toContain("Refusing to register a local app");
});
it("still permits registration with a local development engine", async () => {
 let method: string | undefined;
 const server = createServer((req, res) => { method = req.method; res.end('{"modified":true}'); });
 await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
 try {
   const port = (server.address() as { port: number }).port;
   const result = await sync(`http://127.0.0.1:${port}`, "http://127.0.0.1:8288");
   expect(result.code).toBe(0); expect(method).toBe("PUT");
 } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
