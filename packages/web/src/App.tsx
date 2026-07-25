import { useEffect, useState } from "react";
import { Workbench } from "./Workbench.js";
import { NewApplication } from "./NewApplication.js";
import { Career } from "./Career.js";
import { Insights } from "./Insights.js";

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

/**
 * A card carries a company, a role, and at most one quiet flag.
 *
 * It used to carry salary, source, substage and a red badge as well. Six
 * columns of that is a wall, and a wall of red is stressful rather than
 * informative. The detail has not gone anywhere: it is one tap away, where you
 * are actually thinking about that application rather than scanning all of them.
 */
function Card({ app, onOpen }: { app: App; onOpen: () => void }) {
  const flag = app.flags2[0];
  const dead = app.stage.startsWith("closed");
  return (
    <article className={`card${dead ? " card-dead" : ""}`} onClick={onOpen} role="button" tabIndex={0}>
      <h3>{app.company}</h3>
      {app.role && <p className="role">{app.role}</p>}
      {flag && !dead && <span className={`mark mark-${SEVERITY[flag.kind] ?? "muted"}`}>{flag.label}</span>}
      {dead && app.outcome && <span className="mark mark-muted">{app.outcome.replace(/_/g, " ")}</span>}
    </article>
  );
}

export function App() {
  const [people, setPeople] = useState<string[]>([]);
  const [who, setWho] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ slug: string; company: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [career, setCareer] = useState(false);
  const [insights, setInsights] = useState(false);
  const [reload, setReload] = useState(0);
  const [authMode, setAuthMode] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => {
        setPeople(h.people);
        setAuthMode(h.authMode);
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
  }, [who, reload]);

  if (insights && who)
    return (
      <main>
        <Insights who={who} onClose={() => setInsights(false)} />
      </main>
    );

  if (career && who)
    return (
      <main>
        <Career who={who} onClose={() => setCareer(false)} />
      </main>
    );

  if (adding && who)
    return (
      <main>
        <NewApplication who={who} onClose={() => setAdding(false)} onCreated={() => setReload((r) => r + 1)} />
      </main>
    );

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
          {authMode && (
            <span className="authmode" title={authMode === "api-key"
              ? "Billed per token to your Anthropic API key, capped per run."
              : "Draws on your Claude subscription's usage limits, not API credit."}>
              {authMode === "api-key" ? "API credit" : "Claude plan"}
            </span>
          )}
          <button onClick={() => setInsights(true)}>Insights</button>
          <button onClick={() => setCareer(true)}>Career record</button>
          <button className="primary" onClick={() => setAdding(true)}>
            + New application
          </button>
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

      <div className="board">
          {COLUMNS.map((col) => {
            const items = board.applications
              .filter((a) => col.stages.includes(a.stage))
              .sort((a, b) => (a.flags2[0]?.priority ?? 99) - (b.flags2[0]?.priority ?? 99));
            if (!items.length) return null;
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
    </main>
  );
}
