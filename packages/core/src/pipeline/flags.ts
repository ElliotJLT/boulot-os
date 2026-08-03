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

  const lastUpdated = parseDate(app.lastUpdated);

  /*
   * next_action_date no longer produces flags, because nobody ever set one.
   *
   * The new-job skill stamped every application with "today + 7" and nothing
   * else ever touched the field. Seven days later it went overdue and stayed
   * overdue for good, so the board carried seventeen of these at once — one
   * reading "164d overdue" — against a deadline no person had chosen and no
   * action would ever clear. A flag that fires on every card is not a signal,
   * and it was crowding out the two that are: no reply, and drifting.
   *
   * The field is still read (it is in the schema and in the files) and still
   * shown where a real date exists. It just stops manufacturing urgency.
   */

  if (lastUpdated) {
    const idle = daysBetween(lastUpdated, today);

    if (app.stage === "applied" && idle > THRESHOLDS.noResponseDays) {
      flags.push({ kind: "NO_RESPONSE", label: `no reply in ${idle}d`, priority: 10, days: idle });
    }

    // Stale is specifically "drifting with nothing planned". This used to be
    // suppressed by any next-action date at all, which the intake stamped on
    // everything, so the flag that matters was hidden by the one that did not.
    if (idle > THRESHOLDS.staleDays) {
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
