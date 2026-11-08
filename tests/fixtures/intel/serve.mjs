import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";

const root = process.cwd();
const output = path.join(os.tmpdir(), "tape-intel-components");
await mkdir(output, { recursive: true });
await build({
  entryPoints: [path.join(root, "tests/fixtures/intel/preview.tsx")],
  outfile: path.join(output, "preview.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
  alias: { "@": root },
  plugins: [
    {
      name: "next-fixture",
      setup(build) {
        build.onResolve({ filter: /^@sentry\/nextjs$/ }, () => ({ path: "sentry", namespace: "stub" }));
        build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const captureException=()=>{}; export const captureMessage=()=>{}; export const withScope=(fn)=>fn({setTag(){},setContext(){},setLevel(){}}); export const startInactiveSpan=()=>({end(){},setAttribute(){},setAttributes(){},setStatus(){}});", loader: "js" }));
        build.onResolve({ filter: /^next\/(navigation|link|image)$/ }, (args) => ({
          path: args.path,
          namespace: "fixture",
        }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: args.path.endsWith("image") ? 'import React from "react"; export default function Image({unoptimized,...props}){return React.createElement("img",props)}' : args.path.endsWith("navigation")
            ? 'const router={refresh:()=>window.dispatchEvent(new Event("fixture-refresh")),push:()=>{},replace:(url)=>window.dispatchEvent(new CustomEvent("fixture-navigate",{detail:url}))};export const useRouter=()=>router;'
            : 'import React from "react"; export default function Link(props){ return React.createElement("a",props); }',
          loader: "js",
          resolveDir: root,
        }));
      },
    },
  ],
});
const cssFile = path.join(root, "app/globals.css");
const css = await postcss([tailwind()]).process(
  await readFile(cssFile, "utf8"),
  { from: cssFile },
);
await writeFile(path.join(output, "preview.css"), css.css);
await writeFile(
  path.join(output, "index.html"),
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tape Intel review</title><link rel="stylesheet" href="/preview.css"><style>body{font-family:Arial,sans-serif}</style><div id="root"></div><script type="module" src="/preview.js"></script></html>',
);
if (process.env.FIXTURE_BUILD_ONLY === "1") process.exit(0);
const jobs = new Map();
createServer(async (req, res) => {
  if (req.url.startsWith("/api/intel/search")) {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { input, result } = JSON.parse(body);
      const id = crypto.randomUUID();
      const job = { id, input, estimate: { lowUsd: 0.01, highUsd: 0.09 }, status: "running", total: 2, completed: 1, createdAt: new Date().toISOString() };
      jobs.set(id, job);
      setTimeout(() => Object.assign(job, { status: "complete", completed: 2, result }), input.text === "finish while away" ? 4000 : 50);
      res.writeHead(202); res.end(JSON.stringify({ id })); return;
    }
    const id = new URL(req.url, "http://fixture").searchParams.get("id");
    res.end(JSON.stringify({ job: id ? jobs.get(id) : [...jobs.values()].at(-1) ?? null })); return;
  }
  if (req.url === "/brand/tape-lockup.svg") { res.setHeader("Content-Type", "image/svg+xml"); res.end(await readFile(path.join(root, "public/brand/tape-lockup.svg"))); return; }
  const file =
    req.url === "/preview.js"
      ? "preview.js"
      : req.url === "/preview.css"
        ? "preview.css"
        : "index.html";
  res.setHeader(
    "Content-Type",
    file.endsWith(".js")
      ? "text/javascript"
      : file.endsWith(".css")
        ? "text/css"
        : "text/html",
  );
  res.end(await readFile(path.join(output, file)));
}).listen(8789, "127.0.0.1", () =>
  process.stdout.write("Real component fixture: http://127.0.0.1:8789\n"),
);
