import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import next from "next";

// Exercise the production bundle over HTTPS so secure auth cookies behave as
// they do in deployment, without development compilation and HMR races.
const [, , portText, keyPath, certificatePath] = process.argv;
const port = Number(portText);
const app = next({ dev: false, hostname: "127.0.0.1", port });
await app.prepare();
const handle = app.getRequestHandler();
const server = keyPath
  ? createHttpsServer({ key: readFileSync(keyPath), cert: readFileSync(certificatePath) }, handle)
  : createHttpServer(handle);
server.listen(port, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    server.closeAllConnections();
    server.close();
    await app.close();
    process.exit(0);
  });
}
