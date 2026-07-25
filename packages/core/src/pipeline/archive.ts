import type { Application } from "../schema/status.js";
import { THRESHOLDS, daysBetween } from "./flags.js";

/**
 * When an application is finished with you.
 *
 * The board only ever grew. Nothing left it, because leaving required the user
 * to notice a dead application, decide it was dead, and go and file it — three
 * acts of bookkeeping on the least motivating item in the list. Nobody does
 * that, so after a few months every board is mostly graveyard and the live
 * applications are outnumbered by things that ended in March.
 *
 * The fix is to derive it. Two conditions, both computable from files that
 * already exist:
 *
 *   closed   the stage says it ended
 *   silent   applied, nothing heard, well past the point of hearing
 *
 * Neither triggers a move on its own. The app proposes, the user confirms once
 * for the whole batch, because an application archived out from under someone
 * is worse than one that lingers a fortnight.
 */

/** Silence past this point is an answer. Double the chase threshold. */
export const GHOST_DAYS = THRESHOLDS.noResponseDays * 2;

export interface ArchiveCandidate {
  slug: string;
  company: string;
  role: string;
  /** Short phrase for the confirm list. */
  reason: string;
  /** What to record as the outcome if the user accepts. */
  outcome: NonNullable<Application["outcome"]>;
}

/**
 * Whether an application in `active/` has finished.
 *
 * Returns null for anything still live. `today` is injected so the boundaries
 * are testable, which is where date logic goes wrong.
 */
export function archivable(app: Application, today: Date = new Date()): ArchiveCandidate | null {
  if (app.bucket === "archive") return null;

  const base = { slug: app.slug, company: app.company, role: app.role };

  if (app.stage === "closed-won" || app.stage === "closed-lost") {
    const outcome =
      app.outcome ?? (app.stage === "closed-won" ? "offer_accepted" : "rejected");
    return { ...base, reason: outcome.replace(/_/g, " "), outcome };
  }

  // Silence only counts against an application you actually sent, and only when
  // nothing is planned. A future next-action date means you are still working
  // it, however long ago you applied.
  if (app.stage !== "applied" || app.nextActionDate) return null;

  const last = app.lastUpdated ?? app.appliedDate;
  if (!last) return null;
  const parsed = new Date(last);
  if (Number.isNaN(parsed.getTime())) return null;

  const idle = daysBetween(parsed, today);
  if (idle <= GHOST_DAYS) return null;

  return { ...base, reason: `no reply in ${idle} days`, outcome: "ghosted" };
}

export function archiveCandidates(apps: Application[], today: Date = new Date()): ArchiveCandidate[] {
  return apps
    .map((a) => archivable(a, today))
    .filter((c): c is ArchiveCandidate => c !== null);
}
