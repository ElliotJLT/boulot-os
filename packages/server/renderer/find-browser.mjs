import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

/**
 * Find something that can print a page to PDF.
 *
 * The renderer needs a browser for one line, `page.pdf({ format: "A4" })`. It is
 * a print engine, not a development tool: the CV is HTML and CSS, print CSS is
 * what makes it look like a designed document rather than a drawn one, and the
 * fit loop can only measure a page because a real layout engine laid it out.
 *
 * What it does not need is its own copy. Chrome, Edge and Brave are all the same
 * engine and one of them is already installed on most machines, so the common
 * case should cost nothing. Downloading 190MB to do a job the user's existing
 * software can already do is the sort of thing that makes an app feel heavy for
 * no reason they can see.
 *
 * The fallback still has to exist. An earlier version of this system searched
 * for a browser and gave up when it found none, which on a stock Mac carrying
 * only Safari meant the PDF step simply failed. Safari cannot be driven this way
 * at all, so "no Chromium anywhere" is a real state and it needs a real answer
 * rather than an error.
 */

const MAC = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
];

const WIN = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
];

const LINUX = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
  "/snap/bin/chromium",
];

/** Per-user install locations, which is where Chrome lands without admin rights. */
function userPaths() {
  const home = homedir();
  if (platform() === "darwin") {
    return MAC.map((p) => join(home, p.replace(/^\//, "")));
  }
  if (platform() === "win32") {
    const local = process.env.LOCALAPPDATA;
    return local ? [join(local, "Google\\Chrome\\Application\\chrome.exe")] : [];
  }
  return [];
}

function systemPaths() {
  if (platform() === "darwin") return MAC;
  if (platform() === "win32") return WIN;
  return LINUX;
}

/**
 * Anything puppeteer has already downloaded, newest first.
 *
 * Checked after the installed browsers rather than before: if the user has
 * Chrome open right now, that is the copy least likely to be a stale version
 * nobody has updated in a year.
 */
function cachedPaths() {
  const cache = process.env.PUPPETEER_CACHE_DIR ?? join(homedir(), ".cache", "puppeteer");
  if (!existsSync(cache)) return [];
  const out = [];
  const kinds = platform() === "darwin"
    ? [["chrome-headless-shell", "chrome-headless-shell"], ["chrome", "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"]]
    : [["chrome-headless-shell", "chrome-headless-shell"], ["chrome", "chrome"]];

  for (const [dir, exe] of kinds) {
    const base = join(cache, dir);
    if (!existsSync(base)) continue;
    let versions = [];
    try {
      versions = readdirSync(base).sort().reverse();
    } catch {
      continue;
    }
    for (const v of versions) out.push(join(base, v, exe));
  }
  return out;
}

/**
 * The browser to print with, or null if there is nothing to print with.
 *
 * `BOULOT_BROWSER` overrides everything, for anyone whose browser lives
 * somewhere unusual or who wants to pin a specific build.
 */
export function findBrowser() {
  const pinned = process.env.BOULOT_BROWSER;
  if (pinned) return existsSync(pinned) ? pinned : null;

  for (const p of [...systemPaths(), ...userPaths(), ...cachedPaths()]) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** A readable name for the thing that was found, for logging. */
export function describeBrowser(path) {
  if (!path) return "none";
  if (path.includes(".cache/puppeteer")) return "downloaded by Boulot";
  const m = /\/([^/]+)\.app\//.exec(path) ?? /([^/\\]+)\.exe$/.exec(path);
  return m ? m[1] : path;
}
