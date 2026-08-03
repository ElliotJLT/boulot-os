import { useEffect, useState } from "react";
import { ActivityGrid, type Day } from "./Activity.grid.js";

/**
 * Where the numbers live.
 *
 * They were on the board, competing with the thing the board is for. A job
 * search is stressful enough without a conversion funnel sitting next to the
 * roles you have not heard back from. Here they can be looked at deliberately,
 * which is the only time they are useful.
 */

type Funnel = {
  applied: number;
  stages: Array<{ label: string; count: number; rate: number }>;
  medianDaysToClose: number | null;
  presumedGhosted: number;
  bySource: Array<{ source: string; applied: number; interviewed: number; rate: number }>;
};

type Activity = {
  grid: Day[];
  momentum: { today: number; week: number; streak: number; best: number };
};

export function Insights(
  { who, onClose, embedded }: { who: string; onClose?: () => void; /** Rendered inside Settings, which supplies its own header. */ embedded?: boolean },
) {
  const [f, setF] = useState<Funnel | null>(null);
  const [act, setAct] = useState<Activity | null>(null);

  useEffect(() => {
    fetch(`/api/${who}/board`)
      .then((r) => r.json())
      .then((b) => {
        setF(b.funnel);
        setAct(b.activity ?? null);
      })
      .catch(() => setF(null));
  }, [who]);

  if (!f) return <main className="empty">No data yet.</main>;

  const max = Math.max(...f.stages.map((s) => s.count), 1);
  const ghostRate = f.applied ? Math.round((f.presumedGhosted / f.applied) * 100) : 0;

  return (
    <div className="insights">
      {!embedded && <header className="bench-top">
        <button className="back" onClick={onClose} title="Back to the board" aria-label="Back to the board">
          ←
        </button>
        <h2>Insights</h2>
        <span className="updated">from your files, nothing to fill in</span>
      </header>}

      {/*
        Effort first, then yield.
        
        The funnel says what the writing earned and is silent on whether any
        was done: a fortnight of sending nothing leaves every rate exactly
        where it was. This says what actually happened, and the two belong in
        one panel because either alone is misleading — a great conversion rate
        on four applications is not a good month.
      */}
      {act && act.grid.length > 0 && (
        <section className="card-panel wide activity-panel">
          <div className="activity-head">
            <h3>What you sent</h3>
          </div>
          <div className="activity-body">
            <div className="activity-chart">
              <ActivityGrid days={act.grid} />
              <div className="grid-key">
                <span>less</span>
                {[0, 1, 2, 3, 4].map((l) => (
                  <span key={l} className={`grid-day lvl-${l}`} />
                ))}
                <span>more</span>
              </div>
            </div>
            <dl className="momentum">
              <div>
                <dt>today</dt>
                <dd>{act.momentum.today}</dd>
              </div>
              <div>
                <dt>this week</dt>
                <dd>{act.momentum.week}</dd>
              </div>
              <div>
                <dt>day streak</dt>
                <dd>{act.momentum.streak}</dd>
              </div>
              <div>
                <dt>reached interview</dt>
                <dd>
                  {f.applied
                    ? `${Math.round(((f.stages.find((s) => s.label === "Interview")?.count ?? 0) / f.applied) * 100)}%`
                    : "—"}
                </dd>
              </div>
            </dl>
          </div>
        </section>
      )}

      <div className="ins-grid">
        <section className="card-panel">
          <h3>Funnel</h3>
          {f.stages.map((s) => (
            <div className="funnel-row" key={s.label}>
              <span className="funnel-label">{s.label}</span>
              <span className="funnel-bar" style={{ inlineSize: `${(s.count / max) * 100}%` }} />
              <span className="funnel-count">
                {s.count}
                {s.label !== "Applied" && <em> {(s.rate * 100).toFixed(0)}%</em>}
              </span>
            </div>
          ))}
        </section>

        <section className="card-panel">
          <h3>Timing</h3>
          <dl className="stats">
            <div>
              <dt>median days, applied to closed</dt>
              <dd>{f.medianDaysToClose ?? "—"}</dd>
            </div>
            <div>
              <dt>never heard back</dt>
              <dd>{f.presumedGhosted}</dd>
            </div>
          </dl>
          <p className="note">
            {ghostRate > 40
              ? `${ghostRate}% of what you send goes silent. That is normal and it is not about you, but it does mean volume is a poor strategy: the reply rate is set by the fit, not the count.`
              : `${ghostRate}% went silent, which is better than typical.`}
          </p>
        </section>

        {f.bySource.filter((s) => s.applied > 1 && s.source !== "unknown").length > 0 && (
          <section className="card-panel wide">
            <h3>Where applications come from</h3>
            <table className="md-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Applied</th>
                  <th>Reached interview</th>
                </tr>
              </thead>
              <tbody>
                {f.bySource
                  .filter((s) => s.applied > 1 && s.source !== "unknown")
                  .map((s) => (
                    <tr key={s.source}>
                      <td>{s.source}</td>
                      <td>{s.applied}</td>
                      <td>
                        {s.interviewed} <em className="pct">{(s.rate * 100).toFixed(0)}%</em>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <p className="note">
              Small numbers. Worth noticing a channel that has never converted, not worth restructuring a
              search around.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
