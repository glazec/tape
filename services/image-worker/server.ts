import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { serve } from "inngest/node";
import { SpanStatusCode, trace } from "@opentelemetry/api";

import { imageWorkerInngest } from "@/services/image-worker/client";
import { functions } from "@/services/image-worker/functions";
import {
  emitTelemetryLog,
  flushTelemetry,
  registerServerTelemetry,
} from "@/lib/telemetry/server";

registerServerTelemetry({ defaultServiceName: "tape-image-worker" });

export function createImageWorkerServer(): Server {
  const inngestHandler = serve({
    client: imageWorkerInngest,
    functions,
    servePath: "/api/inngest",
  });

  return createServer((request, response) => {
    const pathname = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    ).pathname;
    const method = request.method ?? "GET";

    trace
      .getTracer("tape-image-worker")
      .startActiveSpan(`HTTP ${method} ${pathname}`, (span) => {
        let ended = false;
        const endSpan = () => {
          if (ended) {
            return;
          }

          ended = true;
          span.setAttribute(
            "http.response.status_code",
            response.statusCode,
          );
          if (response.statusCode >= 500) {
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
          span.end();
        };

        span.setAttributes({
          "http.request.method": method,
          "http.route": pathname,
          "url.path": pathname,
        });
        response.once("finish", endSpan);
        response.once("close", endSpan);

        if (pathname === "/health") {
          emitTelemetryLog({
            attributes: {
              "http.request.method": method,
              "http.response.status_code": 200,
              "http.route": "/health",
            },
            eventName: "image_worker.heartbeat",
          });
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({ ok: true, service: "meeting-image-worker" }),
          );
          return;
        }

        if (pathname === "/api/inngest") {
          inngestHandler(request, response);
          return;
        }

        response.writeHead(404, {
          "content-type": "text/plain; charset=utf-8",
        });
        response.end("Not found");
      });
  });
}

export async function startImageWorkerServer(port: number) {
  const server = createImageWorkerServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const listeningPort =
    address && typeof address === "object" ? address.port : port;

  emitTelemetryLog({
    attributes: { "server.port": listeningPort },
    eventName: "image_worker.started",
  });
  await flushTelemetry();

  return server;
}

const entrypointUrl = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (entrypointUrl === import.meta.url) {
  const port = Number.parseInt(process.env.PORT ?? "3001", 10);

  void startImageWorkerServer(port);
}
