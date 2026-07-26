import { useEffect, useState } from "react";

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

export function Insights(
  { who, onClose, embedded }: { who: string; onClose?: () => void; /** Rendered inside Settings, which supplies its own header. */ embedded?: boolean },
) {
  const [f, setF] = useState<Funnel | null>(null);

  useEffect(() => {
    fetch(`/api/${who}/board`)
      .then((r) => r.json())
      .then((b) => setF(b.funnel))
      .catch(() => setF(null));
  }, [who]);

  if (!f) return <main className="empty">No data yet.</main>;

  const max = Math.max(...f.stages.map((s) => s.count), 1);
  const ghostRate = f.applied ? Math.round((f.presumedGhosted / f.applied) * 100) : 0;

  return (
    <div className="insights">
      {!embedded && <header className="bench-top">
        <button className="back" onClick={onClose}>
          ← Board
        </button>
        <h2>Insights</h2>
        <span className="updated">from your files, nothing to fill in</span>
      </header>}

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
