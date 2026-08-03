import type { AppLike } from "./works.js";

/**
 * How much you actually did, day by day.
 *
 * Every other number here is a rate: what fraction replied, what fraction
 * reached an interview. Rates are the right measure for whether the writing
 * works and the wrong one for whether you did anything this week, because a
 * fortnight of sending nothing leaves them completely unchanged. The one thing
 * a search needs to show a person between roles is whether the work is
 * happening, and until now nothing did.
 *
 * Counted on the day the application went out, not the day the folder was
 * made. A role researched on Monday and sent on Thursday belongs to Thursday:
 * a grid of preparation would be a grid of intentions.
 */

export interface Day {
  /** `YYYY-MM-DD`, local. */
  date: string;
  count: number;
  /** 0 for none, then 1..4 by volume, for the four shades of the grid. */
  level: 0 | 1 | 2 | 3 | 4;
}

/**
 * The shades, and why there are only four.
 *
 * Thresholds are set from what a real day of applying looks like rather than
 * from a percentile of the data: one is a day you did something, three is a
 * good day, five is a burst. Deriving them from the person's own distribution
 * would mean a quiet fortnight repainting the whole grid darker, so a good day
 * in March stops looking like one in August.
 */
export function levelFor(count: number): Day["level"] {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  return 4;
}

/** Local `YYYY-MM-DD`, never UTC: a day is where the person is standing. */
function key(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * A contiguous run of days ending today, oldest first.
 *
 * Contiguous matters: the grid has to show the gaps, and a sparse map keyed by
 * the days that happened to have applications would silently close them up.
 */
export function activityGrid(
  apps: Array<Pick<AppLike, "slug"> & { appliedDate?: string | null }>,
  days = 182,
  today: Date = new Date(),
): Day[] {
  const counts = new Map<string, number>();
  for (const a of apps) {
    const raw = a.appliedDate?.trim();
    if (!raw) continue;
    // Dates in the vault are day strings. Take the first ten characters rather
    // than parsing, so a timezone can never move one across midnight.
    const day = raw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const out: Day[] = [];
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  cursor.setDate(cursor.getDate() - (days - 1));
  for (let i = 0; i < days; i += 1) {
    const k = key(cursor);
    const count = counts.get(k) ?? 0;
    out.push({ date: k, count, level: levelFor(count) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export interface Momentum {
  today: number;
  /** The last seven days including today. */
  week: number;
  /** Days in a row, ending today, with at least one application. */
  streak: number;
  /** The best single day in the window. */
  best: number;
}

/**
 * The few numbers worth putting where they cannot be avoided.
 *
 * A streak counts back from today and stops at the first empty day. Today
 * being empty does not break it — it is barely started, and a counter that
 * resets every midnight and refills by lunchtime is a nag rather than a
 * measure. Yesterday being empty does.
 */
export function momentum(grid: Day[]): Momentum {
  const today = grid.at(-1)?.count ?? 0;
  const week = grid.slice(-7).reduce((n, d) => n + d.count, 0);
  const best = grid.reduce((n, d) => Math.max(n, d.count), 0);

  let streak = 0;
  for (let i = grid.length - 1; i >= 0; i -= 1) {
    const day = grid[i]!;
    if (day.count > 0) streak += 1;
    else if (i !== grid.length - 1) break;
  }
  return { today, week, streak, best };
}
