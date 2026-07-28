/**
 * Dates in the vault are days, not instants.
 *
 * `2026-07-28` in a status file means that day where the person is standing. It
 * has no time and no zone, and it must not acquire one on the way to the screen.
 *
 * `new Date("2026-07-28")` disagrees: the ISO date-only form is defined to parse
 * as UTC midnight. In London in July that is 01:00 local, and every comparison
 * against local midnight is an hour out. An interview today came back as
 * "tomorrow", because the difference was +1 hour and rounding a positive
 * fraction of a day up gives one day. It would have been right in winter, which
 * is the worst kind of bug: correct for five months of the year.
 *
 * So the parse is done by hand, into local time. Nothing here needs a timezone
 * setting — the browser already knows where it is, and adding one would let the
 * user "fix" a bug that was never about them.
 */

/** A `YYYY-MM-DD` string as local midnight on that day. */
export function localDay(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) {
    const loose = new Date(iso);
    return Number.isNaN(loose.getTime()) ? null : loose;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Today, at local midnight, so a comparison is whole days. */
export function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Whole days from today to that date. Negative is in the past.
 *
 * Both sides are local midnight, so this is a count of calendar days rather
 * than a duration rounded into one. An interview at any hour today is 0.
 */
export function daysUntil(iso: string): number | null {
  const d = localDay(iso);
  if (!d) return null;
  return Math.round((d.getTime() - today().getTime()) / 86_400_000);
}

/** "28 July". A date a person can say out loud. */
export function longDate(iso: string): string {
  const d = localDay(iso);
  return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "long" }) : iso;
}

/** "today", "tomorrow", "Thursday", "12 Aug" — whichever is most useful. */
export function whenIn(days: number, iso: string): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days < 0) return `${Math.abs(days)} days ago`;
  const d = localDay(iso);
  if (days < 7 && d) return `on ${d.toLocaleDateString("en-GB", { weekday: "long" })}`;
  return d ? `on ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : `in ${days} days`;
}

/** How long ago, in words, for something that has already happened. */
export function ago(iso: string): { label: string; days: number } | null {
  const d = localDay(iso);
  if (!d) return null;
  const days = Math.round((today().getTime() - d.getTime()) / 86_400_000);
  const label =
    days <= 0
      ? "today"
      : days === 1
        ? "yesterday"
        : days < 7
          ? `${days}d ago`
          : days < 14
            ? "last week"
            : `${Math.floor(days / 7)}w ago`;
  return { label, days };
}
