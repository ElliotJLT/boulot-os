import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * What Boulot itself has spent, today.
 *
 * Every other number in this app is scoped to one application. This one is
 * not: it is the running total of every agent run across all of them, because
 * the question it answers — "what has this app cost me today" — does not care
 * which company a given run was for.
 *
 * Deliberately not a wider number. Claude Code usage outside this app, other
 * projects, other terminals — none of it belongs here. This log is written
 * only from one place (the result event in agent.ts), so it can only ever
 * contain what Boulot itself spent running its own agents.
 */

const DIR = join(homedir(), ".boulot");
const LOG = join(DIR, "usage.jsonl");

/**
 * The rate this app has always shown cost in, unchanged from where it was
 * already hardcoded in three other places (agent.ts, Workbench.tsx,
 * NewApplication.tsx). Centralised here rather than fixed: it is an
 * approximation set once, not a live rate, and worth replacing with a real
 * FX source in one place when that matters more than it does today.
 */
export const USD_TO_GBP = 0.79;

interface Entry {
  /** ISO instant, so "today" can be computed against whatever day it reads back on. */
  at: string;
  usd: number;
}

/** Append one run's cost. Never throws: a lost log entry should not fail the run it describes. */
export function recordCost(usd: number): void {
  if (!usd) return;
  try {
    mkdirSync(DIR, { recursive: true });
    appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), usd } satisfies Entry)}\n`);
  } catch {
    // A cost tracker that crashes the run it is trying to measure is worse
    // than an undercounted total.
  }
}

/** Every entry from local midnight to now, summed. */
export function costToday(): { usd: number; gbp: number; runs: number } {
  if (!existsSync(LOG)) return { usd: 0, gbp: 0, runs: 0 };

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  let usd = 0;
  let runs = 0;
  for (const line of readFileSync(LOG, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let e: Entry;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const at = new Date(e.at);
    if (Number.isNaN(at.getTime()) || at < midnight) continue;
    usd += e.usd;
    runs += 1;
  }
  return { usd, gbp: usd * USD_TO_GBP, runs };
}
