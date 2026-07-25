import type { Application } from "../schema/status.js";

/**
 * Pipeline health flags.
 *
 * Computed in code, not asked of a model. Three reasons: the answer is a pure
 * function of two dates, a model gets it subtly wrong at the boundaries, and
 * asking costs a round trip for arithmetic.
 *
 * There were three conflicting definitions of "stale" across the vault:
 * 14 days in CLAUDE.md, 21 in /status and check-pipeline, 30 in tracker.md.
 * One number, one file, one test.
 */
export const THRESHOLDS = {
  /** No activity and no planned next action. */
  staleDays: 21,
  /** Applied, but nothing heard back. */
  noResponseDays: 14,
} as const;

export type FlagKind =
  | "OVERDUE"
  | "DUE_TODAY"
  | "DUE_TOMORROW"
  | "NO_RESPONSE"
  | "STALE"
  | "DEAD"
  | "ON_HOLD"
  | "AT_RISK";

export interface Flag {
  kind: FlagKind;
  /** Short human phrase for a card badge. */
  label: string;
  /** Sort key. Lower sorts first. */
  priority: number;
  days?: number;
}

const TERMINAL = new Set(["closed-won", "closed-lost"]);

/**
 * Whole days from `from` to `to`, ignoring clock time.
 *
 * UTC getters throughout, deliberately. Frontmatter carries date-only strings
 * ("2026-07-20") which `new Date()` parses as UTC midnight. Reading those back
 * with local getters shifts the day backwards for anyone west of UTC, so a
 * fourteen-day-old application reads as fifteen days old in New York and the
 * flag thresholds move with the user's timezone.
 */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Compute flags for one application.
 *
 * `today` is injected rather than read from the clock so the behaviour is
 * testable at boundaries, which is exactly where date logic goes wrong.
 */
export function flagsFor(app: Application, today: Date = new Date()): Flag[] {
  const flags: Flag[] = [];

  if (TERMINAL.has(app.stage)) {
    return [{ kind: "DEAD", label: app.outcome ?? "closed", priority: 90 }];
  }

  const nextAction = parseDate(app.nextActionDate);
  const lastUpdated = parseDate(app.lastUpdated);

  if (nextAction) {
    const delta = daysBetween(today, nextAction);
    if (delta < 0) {
      flags.push({ kind: "OVERDUE", label: `${Math.abs(delta)}d overdue`, priority: 0, days: Math.abs(delta) });
    } else if (delta === 0) {
      flags.push({ kind: "DUE_TODAY", label: "due today", priority: 1 });
    } else if (delta === 1) {
      flags.push({ kind: "DUE_TOMORROW", label: "due tomorrow", priority: 2 });
    }
  }

  if (lastUpdated) {
    const idle = daysBetween(lastUpdated, today);

    if (app.stage === "applied" && idle > THRESHOLDS.noResponseDays) {
      flags.push({ kind: "NO_RESPONSE", label: `no reply in ${idle}d`, priority: 10, days: idle });
    }

    // Stale is specifically "drifting with nothing planned". An application
    // with a future next-action date is not stale, however long it has been.
    if (!nextAction && idle > THRESHOLDS.staleDays) {
      flags.push({ kind: "STALE", label: `stale, ${idle}d`, priority: 20, days: idle });
    }
  }

  if (app.flags.atRisk) flags.push({ kind: "AT_RISK", label: "at risk", priority: 5 });
  if (app.flags.onHold) flags.push({ kind: "ON_HOLD", label: "on hold", priority: 50 });

  return flags.sort((a, b) => a.priority - b.priority);
}

/** The single flag worth putting on a card. */
export function primaryFlag(app: Application, today: Date = new Date()): Flag | null {
  return flagsFor(app, today)[0] ?? null;
}

/**
 * The three next actions.
 *
 * "3 next actions max" is a standing rule in this system: never dump a
 * twenty-item list without forcing a priority call. Enforced here rather than
 * left to a prompt to remember.
 */
export function nextActions(apps: Application[], today: Date = new Date(), limit = 3) {
  return apps
    .map((app) => ({ app, flag: primaryFlag(app, today) }))
    .filter((x): x is { app: Application; flag: Flag } => x.flag != null && x.flag.kind !== "DEAD")
    .sort((a, b) => a.flag.priority - b.flag.priority || (b.flag.days ?? 0) - (a.flag.days ?? 0))
    .slice(0, limit);
}
