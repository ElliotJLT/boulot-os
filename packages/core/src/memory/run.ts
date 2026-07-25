import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { readMaster } from "../vault/master.js";
import { readCvLines } from "../vault/cv-lines.js";
import { readVault } from "../vault/read.js";
import { consolidate, type Consolidation } from "./consolidate.js";

/**
 * Running a consolidation against a vault.
 *
 * Phase 1 of dreaming is orient: look at what is already there before doing
 * anything. That is the `existing` read below, and it is what lets the caller
 * report what changed rather than just that something did.
 *
 * The lock file mirrors autoDream's, for the same reason: two consolidations
 * writing the same directory at once produce a file that is half of each. The
 * trigger differs. Dreaming waits for elapsed time and a session count, because
 * sessions are its unit of work. Boulot's unit of work is an application, and
 * an application being archived is an unambiguous signal that there is
 * something new to learn and nothing further to wait for.
 */

export const PROFILE_DIR = "profile";
const LOCK = ".consolidating";
/** A lock older than this is a crashed run, not a live one. */
const STALE_LOCK_MS = 60_000;

export interface RunResult extends Consolidation {
  /** False when another run held the lock. */
  ran: boolean;
  generated: string;
}

export function profilePath(personDir: string): string {
  return join(personDir, PROFILE_DIR);
}

/** Read the current index without regenerating, for display. */
export function readProfile(personDir: string): { markdown: string; updated: string | null } | null {
  const file = join(profilePath(personDir), "MEMORY.md");
  if (!existsSync(file)) return null;
  return {
    markdown: readFileSync(file, "utf8"),
    updated: statSync(file).mtime.toISOString().slice(0, 10),
  };
}

export function runConsolidation(personDir: string, person: string, now = new Date()): RunResult | null {
  const master = readMaster(personDir);
  if (!master) return null;

  const dir = profilePath(personDir);
  mkdirSync(dir, { recursive: true });

  const lock = join(dir, LOCK);
  if (existsSync(lock)) {
    try {
      if (now.getTime() - statSync(lock).mtimeMs < STALE_LOCK_MS) {
        return { ran: false, generated: "", files: {}, summary: emptySummary() };
      }
    } catch {
      /* unreadable lock, treat as stale */
    }
  }
  writeFileSync(lock, String(now.getTime()));

  try {
    const lines = readCvLines(personDir);
    /*
     * Oldest first, and only applications that actually produced a CV.
     *
     * Including the others made every claim in the vault look abandoned. The
     * three most recent applications were a lead and two drafts with no cv.md
     * between them, so no claim could appear in any of them, so all 44 were
     * flagged as dropped and the one finding that mattered was buried under
     * them. "You stopped saying this" is only meaningful when measured against
     * applications where you said anything at all.
     */
    const withCv = new Set(lines.map((l) => l.slug));
    const { applications } = readVault(personDir);
    const order = applications
      .filter((a) => withCv.has(a.slug))
      .sort((a, b) =>
        (a.lastUpdated ?? a.appliedDate ?? "").localeCompare(b.lastUpdated ?? b.appliedDate ?? ""),
      )
      .map((a) => a.slug);

    const generated = now.toISOString().slice(0, 10);
    const result = consolidate(master, lines, order, { person, generated });

    for (const [name, contents] of Object.entries(result.files)) {
      writeFileSync(join(dir, name), contents);
    }
    return { ...result, ran: true, generated };
  } finally {
    rmSync(lock, { force: true });
  }
}

function emptySummary() {
  return { claims: 0, withFigures: 0, projects: 0, questions: 0, applications: 0, changed: "" };
}
