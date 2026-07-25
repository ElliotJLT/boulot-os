import { useEffect, useState } from "react";

/**
 * The master CV, shown as a record rather than a document.
 *
 * It is not a CV you read top to bottom. It is the log every tailored CV is a
 * query against, so the useful view is the one that shows what is stale, what
 * is untagged, and above all what never gets used. An entry that has survived
 * eighteen applications without ever being selected is either badly written or
 * genuinely irrelevant, and either way that is the thing worth seeing.
 */

type Bullet = {
  id: string;
  text: string;
  tags: string[];
  hasNumber: boolean;
  usedIn: string[];
  reachedInterview: number;
  rejected: number;
};
type Attention = { kind: string; detail: string; action: string; count?: number };
type Role = { org: string; title: string; dates: string; context: string; bullets: Bullet[]; deeperDetail: number };
type Master = {
  updated: string | null;
  summaryVariants: string[];
  roles: Role[];
  totals: { bullets: number; tagged: number; withNumbers: number; used: number };
  allTags: Array<{ tag: string; count: number }>;
  attention: Attention[];
  proven: Bullet[];
};

type Filter = "all" | "unused" | "no-number" | string;

export function Career({ who, onClose }: { who: string; onClose: () => void }) {
  const [m, setM] = useState<Master | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    fetch(`/api/${who}/master`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setM)
      .catch(() => setM(null));
  }, [who]);

  if (!m) return <main className="empty">No master CV found.</main>;

  const keep = (b: Bullet) =>
    filter === "all"
      ? true
      : filter === "unused"
        ? b.usedIn.length === 0
        : filter === "no-number"
          ? !b.hasNumber
          : b.tags.includes(filter);

  const unused = m.totals.bullets - m.totals.used;

  return (
    <div className="career">
      <header className="bench-top">
        <button className="back" onClick={onClose}>
          ← Board
        </button>
        <h2>Career record</h2>
        <span className="updated">updated {m.updated}</span>
      </header>

      {m.attention.length > 0 && (
        <section className="attention">
          <h3>Worth doing</h3>
          <ul>
            {m.attention.map((a, i) => (
              <li key={i}>
                <b>{a.detail}</b>
                <span>{a.action}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {m.proven.length > 0 && (
        <section className="proven">
          <h3>Earned an interview</h3>
          <p className="lede">
            These appeared in CVs that got past the screen. Small sample, so treat it as a hint rather
            than a rule, but they are the closest thing you have to evidence about what lands.
          </p>
          <ul>
            {m.proven.slice(0, 5).map((b) => (
              <li key={b.id}>
                <span className="score">
                  {b.reachedInterview}/{b.usedIn.length}
                </span>
                <p>{b.text}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h3 className="section-title">Every entry</h3>
      <div className="career-stats">
        <button className={filter === "all" ? "stat on" : "stat"} onClick={() => setFilter("all")}>
          <b>{m.totals.bullets}</b>
          <span>entries</span>
        </button>
        <button className={filter === "unused" ? "stat on" : "stat"} onClick={() => setFilter("unused")}>
          <b>{unused}</b>
          <span>never used</span>
        </button>
        <button className={filter === "no-number" ? "stat on" : "stat"} onClick={() => setFilter("no-number")}>
          <b>{m.totals.bullets - m.totals.withNumbers}</b>
          <span>no number</span>
        </button>
        <div className="stat flat">
          <b>{m.summaryVariants.length}</b>
          <span>summary variants</span>
        </div>
      </div>

      <div className="tagrow">
        {m.allTags.slice(0, 14).map((t) => (
          <button
            key={t.tag}
            className={filter === t.tag ? "tag on" : "tag"}
            onClick={() => setFilter(filter === t.tag ? "all" : t.tag)}
          >
            #{t.tag}
            <em>{t.count}</em>
          </button>
        ))}
      </div>

      {m.roles.map((r) => {
        const shown = r.bullets.filter(keep);
        if (!shown.length) return null;
        return (
          <section className="role" key={r.org}>
            <header>
              <h3>{r.org}</h3>
              <span className="dates">{r.dates}</span>
              <span className="ctx">{r.context}</span>
              {r.deeperDetail > 0 && (
                <span className="interview-only" title="Kept for interview prep, never printed on a CV">
                  +{r.deeperDetail} interview notes
                </span>
              )}
            </header>
            <ul>
              {shown.map((b) => (
                <li key={b.id} className={b.usedIn.length ? "" : "never"}>
                  <p>{b.text}</p>
                  <div className="entry-meta">
                    {b.tags.map((t) => (
                      <span className="minitag" key={t}>
                        #{t}
                      </span>
                    ))}
                    {!b.hasNumber && <span className="flagless">no number</span>}
                    <span
                      className={b.reachedInterview > 0 ? "usage good" : "usage"}
                      title={b.usedIn.length ? b.usedIn.join(", ") : "never selected by tailoring"}
                    >
                      {b.usedIn.length === 0
                        ? "never used"
                        : b.reachedInterview > 0
                          ? `${b.reachedInterview} of ${b.usedIn.length} reached interview`
                          : `used ${b.usedIn.length}×, none progressed`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
