import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const dist = path.join(root, "dist");
const watch = process.argv.includes("--watch");

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

function copyPublic() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  copyDir(path.join(root, "public"), dist);
}

const shared = {
  bundle: true,
  sourcemap: true,
  target: ["chrome110"],
  logLevel: "info",
};

/** @type {esbuild.BuildOptions[]} */
const builds = [
  {
    ...shared,
    entryPoints: [path.join(root, "src/background/index.ts")],
    outfile: path.join(dist, "background/index.js"),
    format: "esm",
    platform: "browser",
  },
  {
    ...shared,
    entryPoints: [path.join(root, "src/content/index.ts")],
    outfile: path.join(dist, "content/index.js"),
    format: "iife",
    platform: "browser",
  },
  {
    ...shared,
    entryPoints: [path.join(root, "src/page/networkInterceptor.ts")],
    outfile: path.join(dist, "page/networkInterceptor.js"),
    format: "iife",
    platform: "browser",
  },
  {
    ...shared,
    entryPoints: [path.join(root, "src/page/fetchProxy.ts")],
    outfile: path.join(dist, "page/fetchProxy.js"),
    format: "iife",
    platform: "browser",
  },
  {
    ...shared,
    entryPoints: [path.join(root, "src/popup/popup.ts")],
    outfile: path.join(dist, "popup/popup.js"),
    format: "iife",
    platform: "browser",
  },
];

copyPublic();

if (watch) {
  const contexts = await Promise.all(builds.map((opts) => esbuild.context(opts)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("[ext] watching… load chrome-extension/dist in Chrome");
} else {
  await Promise.all(builds.map((opts) => esbuild.build(opts)));
  console.log("[ext] built → chrome-extension/dist");
}
