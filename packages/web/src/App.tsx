import { useEffect, useState } from "react";
import { Workbench } from "./Workbench.js";

type Flag = { kind: string; label: string; priority: number; days?: number };
type App = {
  slug: string;
  company: string;
  role: string;
  stage: string;
  substage: string | null;
  outcome: string | null;
  lastUpdated: string | null;
  salary: string | null;
  source: string | null;
  warnings: string[];
  flags2: Flag[];
};
type Board = {
  person: string;
  applications: App[];
  nextActions: Array<{ slug: string; company: string; role: string; flag: Flag }>;
  funnel: {
    applied: number;
    stages: Array<{ label: string; count: number; rate: number }>;
    medianDaysToClose: number | null;
    presumedGhosted: number;
  };
  warnings: number;
};

/** Columns are the funnel, left to right. Terminal states collapse into one. */
const COLUMNS: Array<{ key: string; label: string; stages: string[] }> = [
  { key: "lead", label: "Leads", stages: ["lead"] },
  { key: "drafting", label: "Drafting", stages: ["drafting"] },
  { key: "applied", label: "Applied", stages: ["applied"] },
  { key: "screening", label: "Screening", stages: ["screening"] },
  { key: "interviewing", label: "Interviewing", stages: ["interviewing", "offer"] },
  { key: "closed", label: "Closed", stages: ["closed-won", "closed-lost"] },
];

/**
 * Flag severity drives colour, and only three levels exist on purpose.
 * A board where six things are red is a board where nothing is red.
 */
const SEVERITY: Record<string, "urgent" | "warn" | "muted"> = {
  OVERDUE: "urgent",
  DUE_TODAY: "urgent",
  AT_RISK: "urgent",
  DUE_TOMORROW: "warn",
  NO_RESPONSE: "warn",
  STALE: "warn",
  ON_HOLD: "muted",
  DEAD: "muted",
};

function Chip({ flag }: { flag: Flag }) {
  return <span className={`chip chip-${SEVERITY[flag.kind] ?? "muted"}`}>{flag.label}</span>;
}

function Card({ app, onOpen }: { app: App; onOpen: () => void }) {
  const flag = app.flags2[0];
  const dead = app.stage.startsWith("closed");
  return (
    <article className={`card${dead ? " card-dead" : ""}`} onClick={onOpen} role="button" tabIndex={0}>
      <div className="card-top">
        <h3>{app.company}</h3>
        {flag && <Chip flag={flag} />}
      </div>
      {app.role && <p className="role">{app.role}</p>}
      {app.substage && <p className="substage">{app.substage}</p>}
      <div className="meta">
        {app.salary && <span>{app.salary}</span>}
        {app.source && <span>{app.source}</span>}
        {app.warnings.length > 0 && (
          <span className="warn-dot" title={app.warnings.join("; ")}>
            needs a look
          </span>
        )}
      </div>
    </article>
  );
}

function Funnel({ funnel }: { funnel: Board["funnel"] }) {
  const max = Math.max(...funnel.stages.map((s) => s.count), 1);
  return (
    <section className="funnel">
      <h2>Funnel</h2>
      <p className="derived">derived from your files, nothing to fill in</p>
      {funnel.stages.map((s) => (
        <div className="funnel-row" key={s.label}>
          <span className="funnel-label">{s.label}</span>
          <span className="funnel-bar" style={{ inlineSize: `${(s.count / max) * 100}%` }} />
          <span className="funnel-count">
            {s.count}
            {s.label !== "Applied" && <em> {(s.rate * 100).toFixed(0)}%</em>}
          </span>
        </div>
      ))}
      <dl className="stats">
        <div>
          <dt>median days to close</dt>
          <dd>{funnel.medianDaysToClose ?? "—"}</dd>
        </div>
        <div>
          <dt>presumed ghosted</dt>
          <dd>{funnel.presumedGhosted}</dd>
        </div>
      </dl>
    </section>
  );
}

export function App() {
  const [people, setPeople] = useState<string[]>([]);
  const [who, setWho] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ slug: string; company: string } | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => {
        setPeople(h.people);
        setWho((w) => w ?? h.people[0] ?? null);
        if (!h.vaultExists) setError(`No vault at ${h.vault}`);
      })
      .catch(() => setError("Server not reachable"));
  }, []);

  useEffect(() => {
    if (!who) return;
    fetch(`/api/${who}/board`)
      .then((r) => r.json())
      .then(setBoard)
      .catch(() => setError("Could not load board"));
  }, [who]);

  if (open && who)
    return (
      <main>
        <Workbench who={who} slug={open.slug} company={open.company} onClose={() => setOpen(null)} />
      </main>
    );

  if (error) return <main className="empty">{error}</main>;
  if (!board) return <main className="empty">Reading your vault…</main>;

  return (
    <main>
      <header className="top">
        <div className="brand">
          <span className="logo" />
          <h1>Boulot</h1>
        </div>
        <nav className="people">
          {people.map((p) => (
            <button key={p} className={p === who ? "on" : ""} onClick={() => setWho(p)}>
              {p[0] + p.slice(1).toLowerCase()}
            </button>
          ))}
        </nav>
      </header>

      <section className="next">
        <h2>Do these three</h2>
        <ol>
          {board.nextActions.map((n) => (
            <li key={n.slug}>
              <Chip flag={n.flag} />
              <strong>{n.company}</strong>
              <span className="role">{n.role}</span>
            </li>
          ))}
          {board.nextActions.length === 0 && <li className="none">Nothing needs chasing.</li>}
        </ol>
      </section>

      <div className="layout">
        <div className="board">
          {COLUMNS.map((col) => {
            const items = board.applications
              .filter((a) => col.stages.includes(a.stage))
              .sort((a, b) => (a.flags2[0]?.priority ?? 99) - (b.flags2[0]?.priority ?? 99));
            return (
              <section className="column" key={col.key}>
                <header>
                  <h2>{col.label}</h2>
                  <span className="count">{items.length}</span>
                </header>
                {items.map((a) => (
                  <Card key={a.slug + a.stage} app={a} onOpen={() => setOpen({ slug: a.slug, company: a.company })} />
                ))}
              </section>
            );
          })}
        </div>
        <aside>
          <Funnel funnel={board.funnel} />
        </aside>
      </div>
    </main>
  );
}
