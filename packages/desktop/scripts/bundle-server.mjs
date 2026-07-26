#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync, chmodSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Package the server so it can ship inside the desktop bundle.
 *
 * Tauri's `externalBin` wants one executable per target triple, and a Node
 * server is not one file. Two ways to make it one: compile a single executable
 * with Node's SEA, or ship the `node` binary as the sidecar and hand it a
 * script. The second is used here, because the first requires bundling every
 * dependency into one file and two of ours cannot be bundled:
 *
 *   @anthropic-ai/claude-agent-sdk  ships platform-specific binaries and spawns
 *                                   a CLI, so inlining its JS breaks it
 *   puppeteer                       resolves a browser at runtime from disk
 *
 * So the parts that tolerate bundling get bundled, the two that do not are
 * copied as real packages, and `node` itself becomes the sidecar.
 *
 * Chromium is deliberately not included. The download is roughly 380 MB against
 * a 50 MB application, so it is fetched on first render with a progress bar
 * rather than making every user pay for it at install time whether or not they
 * ever export a PDF.
 */

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const root = resolve(desktop, "..", "..");
const out = join(desktop, "server-bundle");
const binaries = join(desktop, "src-tauri", "binaries");

/** Rust's name for this machine, which is what Tauri expects in the filename. */
function targetTriple() {
  const info = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const host = /^host:\s*(\S+)$/m.exec(info)?.[1];
  if (!host) throw new Error("could not read the host triple from rustc -vV");
  return host;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(binaries, { recursive: true });

// The dependencies that have to stay as real packages on disk.
const KEEP_EXTERNAL = ["@anthropic-ai/claude-agent-sdk", "puppeteer", "puppeteer-core"];

console.log("bundling the server");
execFileSync(
  join(root, "node_modules", ".bin", "esbuild"),
  [
    join(root, "packages", "server", "src", "index.ts"),
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node20",
    `--outfile=${join(out, "server.mjs")}`,
    // ESM output that keeps `require` working for the packages left external.
    "--banner:js=import{createRequire as __cr}from'module';const require=__cr(import.meta.url);",
    ...KEEP_EXTERNAL.map((p) => `--external:${p}`),
  ],
  { stdio: "inherit", cwd: root },
);

console.log("copying the packages that cannot be bundled");
mkdirSync(join(out, "node_modules"), { recursive: true });
for (const pkg of KEEP_EXTERNAL) {
  // pnpm stores the real directory behind a symlink; copy what it points at.
  const from = join(root, "packages", "server", "node_modules", pkg);
  if (!existsSync(from)) {
    console.warn(`  skipped ${pkg} (not installed)`);
    continue;
  }
  cpSync(from, join(out, "node_modules", pkg), { recursive: true, dereference: true });
}

console.log("copying the CV renderer and the skill pack");
cpSync(join(root, "packages", "server", "renderer"), join(out, "renderer"), { recursive: true });
cpSync(join(root, "packages", "plugin"), join(out, "plugin"), { recursive: true, dereference: true });
cpSync(join(root, "packages", "web", "dist"), join(out, "web"), { recursive: true });

writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }, null, 2));

/*
 * A launcher that pins the paths.
 *
 * Inside the bundle the server is one file beside its assets, not three
 * directories up from them, so the repo-relative defaults are all wrong. Setting
 * them here keeps the knowledge of the bundle layout in the thing that creates
 * the layout.
 */
writeFileSync(
  join(out, "start.mjs"),
  [
    'import { dirname, join } from "node:path";',
    'import { fileURLToPath } from "node:url";',
    'const here = dirname(fileURLToPath(import.meta.url));',
    'process.env.BOULOT_WEB ??= join(here, "web");',
    'process.env.BOULOT_RENDERER ??= join(here, "renderer", "render-cv.mjs");',
    'process.env.BOULOT_PLUGIN ??= join(here, "plugin");',
    'await import("./server.mjs");',
    "",
  ].join("\n"),
);

/*
 * `node` becomes the sidecar executable.
 *
 * Copying the running interpreter rather than downloading one keeps the build
 * reproducible on a machine that is already known to work, and guarantees the
 * architecture matches the one Tauri is about to bundle for.
 */
const triple = targetTriple();
const dest = join(binaries, `boulot-server-${triple}`);
copyFileSync(process.execPath, dest);
chmodSync(dest, 0o755);

console.log(`\n  server bundle  ${out}`);
console.log(`  sidecar        ${dest}`);
console.log(`  node           ${process.version}\n`);
