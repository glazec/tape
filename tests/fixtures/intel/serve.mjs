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
        build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const captureException=()=>{}; export const captureMessage=()=>{}; export const withScope=(fn)=>fn({setTag(){},setContext(){},setLevel(){}});", loader: "js" }));
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
createServer(async (req, res) => {
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
