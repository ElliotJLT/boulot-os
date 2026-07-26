import { useEffect, useState } from "react";
import { Workbench } from "./Workbench.js";
import { NewApplication } from "./NewApplication.js";
import { Settings } from "./Settings.js";
import { Setup } from "./Setup.js";

type Flag = { kind: string; label: string; priority: number; days?: number };
type App = {
  slug: string;
  company: string;
  role: string;
  stage: string;
  substage: string | null;
  outcome: string | null;
  lastUpdated: string | null;
  appliedDate: string | null;
  salary: string | null;
  source: string | null;
  warnings: string[];
  flags2: Flag[];
  bucket: "active" | "archive";
};
type Candidate = { slug: string; company: string; role: string; reason: string; outcome: string };
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
  archivable: Candidate[];
  archived: number;
  warnings: number;
};

/**
 * Three columns, because a job search only has three states you can act on.
 *
 * Six columns meant four of them were usually empty, and "Leads" in particular
 * was a holding pen for things nobody had decided about. A role you have not
 * started writing for is a role you are drafting; the distinction was
 * bookkeeping, so leads fold into Drafting rather than disappearing.
 *
 * Screening and interviewing fold into Applied for the same reason: the card
 * still says what stage it reached, and the board's job is to show what needs
 * work, not to model a funnel it already draws on the Insights page.
 */
const COLUMNS: Array<{ key: string; label: string; stages: string[] }> = [
  { key: "drafting", label: "Prep", stages: ["lead", "drafting"] },
  { key: "applied", label: "Applied", stages: ["applied", "screening", "interviewing", "offer"] },
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
function Card({ app, working, onOpen }: { app: App; working?: boolean; onOpen: () => void }) {
  const flag = app.flags2[0];
  const dead = app.stage.startsWith("closed");
  return (
    <article
      className={`card${dead ? " card-dead" : ""}${working ? " card-working" : ""}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      draggable
      /*
       * Native drag rather than a library. The whole interaction is "pick up a
       * card, drop it in a column", which the platform already does, and a
       * dependency for it would be more code than the four handlers below.
       */
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", app.slug);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <h3>{app.company}</h3>
      {app.role && <p className="role">{app.role}</p>}
      {app.stage === "applied" && app.appliedDate && (
        <span className="sent">Applied {app.appliedDate}</span>
      )}
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
  const [settings, setSettings] = useState(false);
  const [filing, setFiling] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  /** Applications an agent is working on right now, from the server. */
  const [busy, setBusy] = useState<
    Array<{ id: string; slug: string | null; company: string | null; role: string | null; label: string }>
  >([]);
  /** A running job being watched from the board, before it has a folder. */
  const [watching, setWatching] = useState<string | null>(null);
  const [maxAgents, setMaxAgents] = useState(3);
  const [reload, setReload] = useState(0);
  const [authMode, setAuthMode] = useState<string | null>(null);
  const [health, setHealth] = useState<{ vault: string; needsSetup: string | null; firstPerson: string | null } | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => {
        setPeople(h.people);
        setAuthMode(h.authMode);
        setHealth(h);
        setWho((w) => w ?? h.people[0] ?? null);
      })
      .catch(() => setError("Server not reachable"));
  }, []);

  /*
   * What is working, while you are looking at something else.
   *
   * Runs outlive the tab that started them, so the board has to be able to say
   * so. Polled rather than pushed: this is a two-second-resolution fact about
   * at most three things, and a socket here would be a second stream saying
   * what the first one already says.
   */
  useEffect(() => {
    const poll = () =>
      fetch("/api/jobs")
        .then((r) => r.json())
        .then((d: {
          max?: number;
          jobs: Array<{
            id: string; slug: string | null; company: string | null; role: string | null;
            label: string; running: boolean;
          }>;
        }) => {
          const live = d.jobs.filter((j) => j.running);
          if (typeof d.max === "number") setMaxAgents(d.max);
          /*
           * Reload the board whenever the shape of the work changes.
           *
           * This only reloaded when the last run finished, so an application
           * created mid-run had nothing to make the board fetch it: the
           * placeholder shimmered, the folder appeared on disk, and the real
           * card did not show until the page was refreshed by hand. Three
           * separate reports of a role "disappearing" were this.
           *
           * The signature is the set of running jobs and the slugs they have
           * learned, so a job gaining a folder counts as a change just as much
           * as a job ending does.
           */
          const signature = live.map((j) => `${j.id}:${j.slug ?? ""}`).sort().join("|");
          setBusy((prev) => {
            const before = prev.map((j) => `${j.id}:${j.slug ?? ""}`).sort().join("|");
            if (before !== signature) setReload((r) => r + 1);
            return live;
          });
        })
        .catch(() => {});
    void poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!who) return;
    fetch(`/api/${who}/board`)
      .then((r) => r.json())
      .then(setBoard)
      .catch(() => setError("Could not load board"));
  }, [who, reload]);

  /*
   * Onboarding comes before everything, including the error state.
   *
   * This used to be `if (!h.vaultExists) setError("No vault at ...")`, which
   * turned the single most common first experience into a dead end with no
   * action on it.
   */
  if (health?.needsSetup)
    return (
      <main>
        <Setup
          health={health}
          onDone={(w) => {
            setHealth(null);
            setWho(w);
            setReload((r) => r + 1);
            void fetch("/api/health").then((r) => r.json()).then(setHealth);
          }}
        />
      </main>
    );

  if (settings && who && health)
    return (
      <main>
        <Settings
          who={who}
          authMode={authMode}
          vault={health.vault}
          archived={board?.archived ?? 0}
          onClose={() => setSettings(false)}
          onChanged={() => setReload((r) => r + 1)}
        />
      </main>
    );

  if ((adding || watching) && who)
    return (
      <main>
        <NewApplication
          {...(watching ? { watch: watching } : {})}
          who={who}
          onClose={() => {
            setAdding(false);
            setWatching(null);
          }}
          onCreated={() => setReload((r) => r + 1)}
          onOpen={(slug, company) => {
            setReload((r) => r + 1);
            setAdding(false);
            setOpen({ slug, company });
          }}
        />
      </main>
    );

  if (open && who)
    return (
      <main>
        <Workbench
          who={who}
          slug={open.slug}
          company={open.company}
          onClose={() => setOpen(null)}
          onArchived={() => setReload((r) => r + 1)}
        />
      </main>
    );

  if (error) return <main className="empty">{error}</main>;
  if (!board) return <main className="empty">Reading your vault…</main>;

  /**
   * Move the finished ones in one go.
   *
   * Sequential rather than parallel: these are folder renames on the user's
   * disk, and a dozen concurrent moves through the same path checks buys
   * nothing worth the race. The board reloads once at the end.
   */
  /**
   * Drop a card into a column.
   *
   * Optimistic: the card moves immediately and the board reloads afterwards.
   * Waiting for a round trip to a local file write makes dragging feel broken
   * even when it worked, and if the write fails the reload puts it back.
   */
  const move = async (slug: string, column: string) => {
    setDragOver(null);
    const current = board.applications.find((a) => a.slug === slug);
    const target = COLUMNS.find((c) => c.key === column);
    if (!current || !target || target.stages.includes(current.stage)) return;

    setBoard((b) =>
      b ? { ...b, applications: b.applications.map((a) => (a.slug === slug ? { ...a, stage: column === "closed" ? "closed-lost" : column } : a)) } : b,
    );
    await fetch(`/api/${who}/job/${slug}/stage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stage: column }),
    }).catch(() => {});
    setReload((r) => r + 1);
  };

  const fileAll = async (cands: Candidate[]) => {
    for (const c of cands) {
      await fetch(`/api/${who}/job/${c.slug}/archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcome: c.outcome }),
      });
    }
    setFiling(false);
    setReload((r) => r + 1);
  };

  return (
    <main>
      <header className="top">
        <div className="brand">
          <span className="logo" />
          <h1>Boulot</h1>
        </div>
        <nav className="people">
          {/*
            How many agents are working, always.
            
            Runs outlive the tab, so without this the only way to know whether
            anything is happening is to remember. It also says the ceiling,
            because "you can have three of these going" is not discoverable and
            is the main thing that makes the app faster to use than doing it by
            hand.
          */}
          <span className={busy.length ? "agents on" : "agents"} title="Applications being worked on right now">
            <span className="agent-dot" />
            {busy.length}/{maxAgents} agents
          </span>
          {/*
            Three things, because only one of them is something you do.
            
            Plan, insights, archive and career record used to sit across the top
            of the page you use to apply for jobs, and none of them is part of
            applying for a job. They are in Settings now.
          */}
          <button onClick={() => setSettings(true)}>Settings</button>
          <button className="primary" onClick={() => setAdding(true)}>
            + New application
          </button>
        </nav>
      </header>

      {/*
        A board with nothing on it.
        
        Someone who has just finished onboarding lands here, and the previous
        version showed them "Nothing needs chasing" over an empty page. That is
        technically true and reads as a broken app. There is exactly one useful
        action at this point, so it is the only thing offered.
      */}
      {board.applications.length === 0 ? (
        <section className="firstjob">
          <h2>Your record is ready. Now find something to point it at.</h2>
          <p>
            Paste a job link or the text of an advert. Boulot reads it, maps every requirement to
            something you have actually done, writes the CV and renders the PDF.
          </p>
          <button className="primary" onClick={() => setAdding(true)}>
            Add your first job
          </button>
        </section>
      ) : null}

      {/*
        The "3 applications have finished" prompt used to sit here. It was a
        banner asking permission to tidy up, on a page whose job is the four
        things you have not done yet. Archiving happens from the workbench and
        by dragging into Closed, both of which are where you already are when
        you find out an application ended.
      */}
      <div className="board">
          {COLUMNS.map((col) => {
            const items = board.applications
              // The archive is a separate page. An application that ended in
              // March is not competing for attention with one you sent today.
              .filter((a) => a.bucket === "active")
              .filter((a) => col.stages.includes(a.stage))
              /*
               * Applied sorts by when it went out, newest first.
               *
               * The other columns sort by what needs attention, which is right
               * for work in progress: the thing about to go stale should be at
               * the top. Applied is not work in progress, it is a record of
               * what you sent and when, and the only reading anyone does of it
               * is chronological. Sorting it by flag put a three-week-old
               * application above one sent this morning.
               *
               * Undated applications sort last rather than first, because a
               * missing date is unknown rather than ancient.
               */
              .sort((a, b) => {
                if (col.key === "applied") {
                  /*
                   * The applied date, and only that.
                   *
                   * Falling back to lastUpdated sorted an application with no
                   * applied date into the middle of today's, where its card
                   * said "(no date)" while sitting above one dated three days
                   * ago. An order the eye cannot verify from the cards is worse
                   * than a cruder one it can.
                   */
                  const when = (x: typeof a) => x.appliedDate ?? "";
                  const [l, r] = [when(a), when(b)];
                  if (l && r) return r.localeCompare(l);
                  // A date beats no date; two blanks fall through to the flag.
                  if (l) return -1;
                  if (r) return 1;
                }
                return (a.flags2[0]?.priority ?? 99) - (b.flags2[0]?.priority ?? 99);
              });
            // Empty columns stay on screen now: a column you cannot drop into
            // is not a column, and hiding them made the board rearrange itself
            // mid-drag.
            return (
              <section
                className={`column${dragOver === col.key ? " column-over" : ""}`}
                key={col.key}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOver !== col.key) setDragOver(col.key);
                }}
                onDragLeave={(e) => {
                  // Only when the pointer actually left the column, not when it
                  // crossed onto a card inside it.
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const slug = e.dataTransfer.getData("text/plain");
                  if (slug) void move(slug, col.key);
                }}
              >
                <header>
                  <h2>{col.label}</h2>
                  <span className="count">{items.length}</span>
                </header>
                {items.map((a) => (
                  <Card
                    key={a.slug + a.stage}
                    app={a}
                    working={busy.some((b) => b.slug === a.slug)}
                    onOpen={() => setOpen({ slug: a.slug, company: a.company })}
                  />
                ))}
                {/*
                  A job being logged has no card yet, because it has no folder
                  yet. It gets a placeholder in Prep so that pressing Start and
                  walking away does not look like nothing happened.
                */}
                {col.key === "drafting" &&
                  busy
                    .filter((b) => !b.slug)
                    .map((b) => (
                      <article
                        className="card card-working"
                        key={b.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setWatching(b.id)}
                      >
                        <h3>{b.company ?? "Reading the job"}</h3>
                        <p className="role">{b.role ?? b.label}</p>
                      </article>
                    ))}
                {!items.length && <p className="col-empty">Drop here</p>}
              </section>
            );
          })}
      </div>
    </main>
  );
}
