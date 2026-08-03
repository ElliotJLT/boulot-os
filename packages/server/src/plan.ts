import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * How much of the Claude subscription is left.
 *
 * A different pool from the one Boulot bills. Boulot runs on an API key and
 * pays per token; this is the Max plan's rolling limits, spent by Claude Code
 * and the desktop app doing everything else in the day. Showing them together
 * is the point — they are the two ways an afternoon can stop — but they must
 * never be added up or confused, which is why the labels say which is which.
 *
 * Read from the file the desktop app already keeps rather than from any API.
 * There is no supported endpoint for plan usage, and inventing one out of a
 * session token would break the moment it rotated. This is a local JSON file
 * on the same machine, refreshed every few minutes while the app is running.
 */

const HISTORY = join(
  homedir(),
  "Library",
  "Application Support",
  "Claude",
  "plan-usage-history.json",
);

/*
 * The two windows the app tracks, under the names it stores them by.
 *
 * `fh` is the five-hour rolling limit and `sd` the seven-day one. Confirmed
 * against the desktop widget reading 31% and 26% with the file holding exactly
 * those two numbers at the same moment.
 */
interface Sample {
  t: number;
  u?: { fh?: number; sd?: number };
}

export interface PlanUsage {
  /** Percent of the five-hour window used. */
  fiveHour: number;
  /** Percent of the seven-day window used. */
  week: number;
  /** When the desktop app last wrote a sample. */
  at: number;
}

/**
 * The latest sample, if it is recent enough to mean anything.
 *
 * The file only advances while the desktop app is running, so a percentage
 * from this morning is not "31% used", it is "31% used at some point you would
 * have to go and look up". A stale number presented as current is worse than
 * no number, and this one sits next to live figures where it would inherit
 * their credibility.
 */
export function planUsage(maxAgeMs = 2 * 60 * 60 * 1000): PlanUsage | null {
  try {
    if (!existsSync(HISTORY)) return null;
    // Cheap guard before parsing 60kB of history on every board load.
    if (Date.now() - statSync(HISTORY).mtimeMs > maxAgeMs) return null;

    const parsed = JSON.parse(readFileSync(HISTORY, "utf8")) as { samples?: Sample[] };
    const last = parsed.samples?.at(-1);
    if (!last?.u) return null;
    if (Date.now() - last.t > maxAgeMs) return null;

    const { fh, sd } = last.u;
    if (typeof fh !== "number" && typeof sd !== "number") return null;
    // The org id in each sample is deliberately not read or returned.
    return { fiveHour: fh ?? 0, week: sd ?? 0, at: last.t };
  } catch {
    // A usage chip is not worth failing a board load for.
    return null;
  }
}
