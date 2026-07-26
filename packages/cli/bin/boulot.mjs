#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";

/**
 * `boulot` — start the app and open it.
 *
 * The whole job of this file is to remove the four decisions a person should
 * never have to make to look at their own CV: which directory to be in, which
 * package manager to invoke, which port is free, and which URL to type. Every
 * one of those was a reason someone gave up before seeing anything.
 *
 * It stays deliberately dependency-free and unbundled. A launcher that needs
 * its own `npm install` before it can launch has not solved the problem it
 * exists to solve.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
  boulot — your career, run like a product

  Usage
    boulot                 start the app and open it in your browser
    boulot --vault <path>  use a different folder for your career files
    boulot --port <n>      start on a specific port
    boulot --no-open       start without opening a browser

  Your files live in ~/Boulot by default. Nothing is uploaded anywhere: the app
  runs on this machine and your CVs stay on this disk.
`);
  process.exit(0);
}

/*
 * Which folder to open, most explicit instruction first: the flag someone just
 * typed, then the environment, then what they chose on first run, then a guess.
 *
 * Reading the saved config here as well as in the server matters because this
 * is what gets printed before anything starts. Printing ~/Boulot and then
 * opening a different folder would be a small lie told at the worst moment.
 */
function savedConfig() {
  try {
    return JSON.parse(readFileSync(join(homedir(), ".boulot", "config.json"), "utf8"));
  } catch {
    return {};
  }
}
const saved = savedConfig();
const vault = resolve(
  flag("vault", process.env.BOULOT_VAULT ?? saved.vault ?? join(homedir(), "Boulot")),
);

/**
 * Find a port nobody is using.
 *
 * Asking the OS for port 0 and reading back what it assigned is the only method
 * without a race: anything that tests a port and then binds it can lose the gap
 * in between. The preferred port is tried first purely so the URL is stable
 * between runs, which matters when someone has bookmarked it.
 */
async function freePort(preferred) {
  const tryPort = (p) =>
    new Promise((res) => {
      const s = createServer();
      s.once("error", () => res(null));
      s.once("listening", () => {
        const { port } = s.address();
        s.close(() => res(port));
      });
      s.listen(p, "127.0.0.1");
    });
  return (await tryPort(preferred)) ?? (await tryPort(0));
}

/** Open a URL in the default browser, without caring if it fails. */
function openBrowser(url) {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true, shell: platform() === "win32" }).unref();
  } catch {
    /* The URL is printed either way, which is the part that matters. */
  }
}

const serverEntry = join(root, "packages", "server", "src", "index.ts");
const built = join(root, "packages", "server", "dist", "index.js");
const webDist = join(root, "packages", "web", "dist", "index.html");

if (!existsSync(serverEntry) && !existsSync(built)) {
  console.error(`\n  Could not find the Boulot server under ${root}.`);
  console.error(`  If you cloned the repo, run \`pnpm install\` in it first.\n`);
  process.exit(1);
}

if (!existsSync(webDist)) {
  console.error(`\n  The interface has not been built yet.`);
  console.error(`  Run \`pnpm install && pnpm build\` in ${root} first.\n`);
  process.exit(1);
}

const port = await freePort(Number(flag("port", process.env.PORT ?? 4319)));
const url = `http://localhost:${port}`;

console.log(`\n  Boulot`);
console.log(`  your files   ${vault}${saved.person ? `  (${saved.person})` : ""}`);
console.log(`  address      ${url}`);
console.log(`\n  Starting. Press Ctrl-C to stop.\n`);

/*
 * Run the server through tsx from the repo rather than requiring a build step.
 * `boulot` is the command someone runs on a fresh clone, and "it works once you
 * have compiled it" is the same cliff in a different costume.
 */
/*
 * Locate tsx by resolving it from the server package rather than guessing a
 * path. pnpm does not hoist to the workspace root, so `<root>/node_modules/tsx`
 * does not exist and the first version of this crashed with a module-not-found
 * the moment it left the developer's own shell.
 */
function findTsx() {
  const candidates = [
    join(root, "packages", "server", "node_modules", "tsx", "dist", "cli.mjs"),
    join(root, "node_modules", "tsx", "dist", "cli.mjs"),
  ];
  return candidates.find(existsSync) ?? null;
}

const useBuilt = existsSync(built);
const tsx = useBuilt ? null : findTsx();
if (!useBuilt && !tsx) {
  console.error(`\n  Could not find tsx under ${root}.`);
  console.error(`  Run \`pnpm install\` in the repo, then try again.\n`);
  process.exit(1);
}

const child = spawn(
  process.execPath,
  useBuilt ? [built] : [tsx, serverEntry],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PORT: String(port), BOULOT_VAULT: vault },
  },
);

let opened = false;
/*
 * Wait for the server to answer before opening a tab. Opening immediately shows
 * the browser's own connection-refused page, which reads as "this is broken"
 * rather than "this is starting".
 */
const waitForServer = async () => {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  return false;
};

if (!args.includes("--no-open")) {
  void waitForServer().then((up) => {
    if (up && !opened) {
      opened = true;
      openBrowser(url);
    }
  });
}

child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    child.kill(sig);
    process.exit(0);
  });
}
