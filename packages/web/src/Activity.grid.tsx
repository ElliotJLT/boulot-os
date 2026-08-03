import { longDate } from "./dates.js";

/**
 * Six months of applying, as a grid.
 *
 * Every other number on the profile is a rate, and a rate cannot tell you
 * whether you did anything last week: send nothing for a fortnight and they
 * all hold perfectly still. This is the one view that shows effort rather than
 * yield, which between roles is the thing worth being able to see without
 * asking for it.
 *
 * Columns are weeks, rows are days, Monday at the top. Stolen wholesale from
 * the obvious place, because the shape is already legible to everyone who
 * would look at it and inventing a different one would only cost the reader.
 */

export interface Day {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Monday-first weekday index, because a work week does not start on Sunday. */
function row(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return (new Date(y!, m! - 1, d!).getDay() + 6) % 7;
}

export function ActivityGrid({ days }: { days: Day[] }) {
  if (!days.length) return null;

  /*
   * Pad to a whole week so the first column is not a ragged stump.
   *
   * The window starts on whatever day it starts on. Without the padding the
   * first column begins partway down and reads as a gap in the data rather
   * than as the edge of the window.
   */
  const weeks: Array<Array<Day | null>> = [];
  let week: Array<Day | null> = Array.from({ length: row(days[0]!.date) }, () => null);
  for (const day of days) {
    week.push(day);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) weeks.push([...week, ...Array.from({ length: 7 - week.length }, () => null)]);

  /*
   * A month label above the column where the month first appears.
   *
   * Only where it changes, and never on the first column, where it would
   * usually be a month the window has mostly cut off.
   */
  const labels = weeks.map((w, i) => {
    const first = w.find((d): d is Day => Boolean(d));
    if (!first || i === 0) return null;
    const prev = weeks[i - 1]?.find((d): d is Day => Boolean(d));
    const month = Number(first.date.slice(5, 7)) - 1;
    if (prev && Number(prev.date.slice(5, 7)) - 1 === month) return null;
    return MONTHS[month] ?? null;
  });

  return (
    <div className="grid-wrap">
      <div className="grid-months">
        {labels.map((l, i) => (
          <span key={i} className="grid-month">
            {l}
          </span>
        ))}
      </div>
      <div className="grid-body">
        {weeks.map((w, i) => (
          <div className="grid-week" key={i}>
            {w.map((d, j) =>
              d ? (
                <span
                  key={d.date}
                  className={`grid-day lvl-${d.level}`}
                  title={`${d.count === 0 ? "Nothing" : `${d.count} application${d.count === 1 ? "" : "s"}`} on ${longDate(d.date)}`}
                />
              ) : (
                <span key={`pad-${i}-${j}`} className="grid-day grid-pad" />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
