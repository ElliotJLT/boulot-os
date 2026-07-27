import { useEffect, useState } from "react";

/**
 * The master CV, shown as a record rather than a document.
 *
 * It is not a CV you read top to bottom. It is the log every tailored CV is a
 * query against, so the useful view is the one that shows what never gets used.
 * An entry that has survived eighteen applications without once being selected
 * is either badly written or genuinely irrelevant, and either way that is the
 * thing worth seeing.
 *
 * The first version showed all of that and said none of it. Four unlabelled
 * counters, a row of tags, then every entry you have ever written in one
 * column, with three competing pieces of metadata under each. Everything was
 * on screen and nothing was legible, so the page answered "what is in here"
 * when the only question worth asking it is "what should I fix".
 *
 * So it opens with the verdict in a sentence, puts the entries that have
 * actually earned interviews at the top, and gives every other entry one state
 * rather than three. The counters became the filters, because a number you
 * cannot act on is decoration.
 */

/** One entry, one state. Ranked by how much it should change what you do. */
type State = "proven" | "used" | "never";

function stateOf(b: Bullet): State {
  if (b.reachedInterview > 0) return "proven";
  return b.usedIn.length > 0 ? "used" : "never";
}

/**
 * A mark, not a sentence.
 *
 * "Earned an interview 2/3" was a phrase in a box on the right of every row,
 * which at twenty-four rows is twenty-four boxes and no list. The count is the
 * information; the words belong in the row you have opened.
 */
const STATE_MARK: Record<State, (b: Bullet) => string> = {
  proven: (b) => `${b.reachedInterview}/${b.usedIn.length}`,
  used: (b) => `${b.usedIn.length}×`,
  never: () => "—",
};

const STATE_WORDS: Record<State, (b: Bullet) => string> = {
  proven: (b) => `Reached an interview in ${b.reachedInterview} of the ${b.usedIn.length} CVs it went out on`,
  used: (b) => `Used ${b.usedIn.length}×, none progressed`,
  never: () => "Never selected by tailoring",
};

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
  profile: { markdown: string; updated: string | null } | null;
};

type Filter = "all" | "unused" | "no-number" | string;

/**
 * One sentence describing the memory, read out of the memory itself.
 *
 * Parsing the generated file rather than adding fields to the API on purpose:
 * the file is the artefact, and anything the line claims should be something
 * the user can verify by opening it.
 */
function summarise(markdown: string): string {
  const n = (re: RegExp) => Number(new RegExp(re).exec(markdown)?.[1] ?? 0);
  const claims = n(/`evidence\.md` — (\d+) claims/);
  const figures = n(/(\d+) carrying a figure/);
  const questions = n(/`questions\.md` — (\d+)/);
  const apps = n(/from (\d+) applications/);
  const parts = [`${claims} things you have proven`];
  if (figures) parts.push(`${figures} with numbers`);
  if (questions) parts.push(`${questions} worth checking`);
  return `${parts.join(", ")} · from ${apps} applications`;
}

export function Career(
  { who, onClose, embedded }: { who: string; onClose?: () => void; /** Rendered inside Settings, which supplies its own header. */ embedded?: boolean },
) {
  const [m, setM] = useState<Master | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [showMemory, setShowMemory] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/${who}/master`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setM)
      .catch(() => setM(null));
  }, [who]);

  if (!m) return <main className="empty">No master CV found.</main>;

  const needle = q.trim().toLowerCase();
  const keep = (b: Bullet) => {
    if (needle && !b.text.toLowerCase().includes(needle) && !b.tags.some((t) => t.includes(needle)))
      return false;
    if (filter === "all") return true;
    if (filter === "proven") return stateOf(b) === "proven";
    if (filter === "unused") return b.usedIn.length === 0;
    if (filter === "no-number") return !b.hasNumber;
    return b.tags.includes(filter);
  };

  const proven = m.roles.flatMap((r) => r.bullets).filter((b) => stateOf(b) === "proven").length;
  const unused = m.totals.bullets - m.totals.used;
  const noNumber = m.totals.bullets - m.totals.withNumbers;
  const showing = m.roles.reduce((n, r) => n + r.bullets.filter(keep).length, 0);

  const FILTERS: Array<{ key: Filter; label: string; count: number; tone?: string }> = [
    { key: "all", label: "All", count: m.totals.bullets },
    { key: "proven", label: "Earned an interview", count: proven, tone: "good" },
    { key: "unused", label: "Never used", count: unused, tone: "warn" },
    { key: "no-number", label: "No number", count: noNumber },
  ];
  void noNumber;

  /*
   * Tags are the agent's index, not the reader's.
   *
   * Fifty of them across the width, all the same weight, looked like a filter
   * bar and behaved like a taxonomy dump. They are how tailoring selects
   * bullets, which makes them load-bearing and uninteresting: nobody opens this
   * page to browse #onboarding. Behind a control, and only the ones with enough
   * behind them to be worth a click.
   */
  const tags = m.allTags.filter((t) => t.count > 1);

  return (
    <div className="career">
      {!embedded && <header className="bench-top">
        <button className="back" onClick={onClose} title="Back to the board" aria-label="Back to the board">
          ←
        </button>
        <h2>Profile</h2>
        <span className="updated">updated {m.updated}</span>
      </header>}

      {m.profile && (
        <section className="memory">
          <button className="memory-line" onClick={() => setShowMemory((v) => !v)}>
            <span className="dot" />
            <b>Boulot has read your applications</b>
            <span>{summarise(m.profile.markdown)}</span>
            <em>updated {m.profile.updated}</em>
          </button>
          {showMemory && <pre className="memory-body">{m.profile.markdown}</pre>}
        </section>
      )}

      {/*
        Three bars, and they are the filters.

        The verdict sentence said the numbers and the chips repeated them, so
        the same three facts appeared twice in different clothes. A bar shows a
        proportion, which is the thing a number cannot: "8 have earned an
        interview" means nothing without the denominator, and "8 of 16" is a
        different feeling from "8 of 90".

        Clicking a bar filters to it, so the progress and the control are the
        same object. A number you cannot act on is decoration, and this page had
        four of them.
      */}
      <div className="record">
        {[
          { key: "proven" as Filter, label: "Earned an interview", n: proven, tone: "good" },
          { key: "all" as Filter, label: "Used in a CV", n: m.totals.used, tone: "" },
          { key: "no-number" as Filter, label: "Carry a figure", n: m.totals.withNumbers, tone: "" },
        ].map((row) => (
          <button
            key={row.label}
            className={`bar ${row.tone}${filter === row.key ? " on" : ""}`}
            onClick={() => setFilter(filter === row.key ? "all" : row.key)}
          >
            <span className="bar-label">{row.label}</span>
            <span className="bar-track">
              <span
                className="bar-fill"
                style={{ inlineSize: `${Math.round((row.n / Math.max(1, m.totals.bullets)) * 100)}%` }}
              />
            </span>
            <span className="bar-n">
              {row.n}<em>/{m.totals.bullets}</em>
            </span>
          </button>
        ))}
      </div>

      {unused > 0 && (
        <p className="record-note">
          <b>{unused}</b> {unused === 1 ? "entry has" : "entries have"} never been picked by
          tailoring. That usually means badly written rather than irrelevant.{" "}
          <button className="linkish" onClick={() => setFilter("unused")}>
            Show them
          </button>
        </p>
      )}

      {/*
        Controls, and then a list you can actually read.
        
        There used to be an "Earned an interview" panel here showing the same
        three entries that appear again forty pixels below, so the first thing
        the page did was repeat itself. The filter does that job now: the count
        is on the chip and pressing it shows exactly those three, in place.
      */}
      <div className="career-controls">
        <input
          className="career-search"
          value={q}
          placeholder="Search your entries…"
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="career-filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip${filter === f.key ? " on" : ""}${f.tone ? ` ${f.tone}` : ""}`}
              onClick={() => setFilter(f.key)}
              disabled={f.count === 0 && f.key !== "all"}
            >
              {f.label} <em>{f.count}</em>
            </button>
          ))}
          {/*
            Fourteen tags across the full width was a second filter row with the
            same visual weight as the first, and tags are the rarer thing to
            reach for. Six, then the rest on request.
          */}
          {tags.length > 0 && (
            <button className="tag more" onClick={() => setShowTags((v) => !v)}>
              {showTags ? "Hide tags" : `Tags (${tags.length})`}
            </button>
          )}
        </div>
      </div>

      {showTags && (
        <div className="tagrow">
          {tags.map((t) => (
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
      )}

      {showing === 0 && (
        <p className="empty-note">Nothing matches. Clear the search, or pick a different filter.</p>
      )}

      {/*
        One line each, opened on demand.
        
        Twenty-four entries at full length is not a list, it is twenty-four
        paragraphs, and the page was unreadable for exactly that reason: nothing
        could be compared to anything because nothing fit on screen at once. A
        row is now a row. Click it and it becomes the paragraph it always was,
        with where it went and what happened there.
      */}
      {m.roles.map((r) => {
        const shown = r.bullets.filter(keep);
        if (!shown.length) return null;
        const ordered = [...shown].sort(
          (a, b) => b.reachedInterview - a.reachedInterview || b.usedIn.length - a.usedIn.length,
        );
        return (
          <section className="role" key={r.org}>
            <header>
              <h3>{r.org}</h3>
              <span className="dates">{r.dates}</span>
              <span className="role-count">
                {shown.length}
                {shown.length === r.bullets.length ? "" : ` of ${r.bullets.length}`}
                {r.deeperDetail > 0 && (
                  <span className="interview-only" title="Kept for interview prep, never printed on a CV">
                    +{r.deeperDetail} notes
                  </span>
                )}
              </span>
            </header>
            <ul>
              {ordered.map((b) => {
                const state = stateOf(b);
                const isOpen = open === b.id;
                return (
                  <li key={b.id} className={`entry ${state}${isOpen ? " open" : ""}`}>
                    <button className="entry-row" onClick={() => setOpen(isOpen ? null : b.id)}>
                      <span className="entry-text">{b.text}</span>
                      <span className={`entry-mark ${state}`} title={STATE_WORDS[state](b)}>
                        {STATE_MARK[state](b)}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="entry-open">
                        <p>{b.text}</p>
                        <div className="entry-meta">
                          {b.tags.map((t) => (
                            <span className="minitag" key={t}>
                              #{t}
                            </span>
                          ))}
                          {!b.hasNumber && <span className="flagless">no number</span>}
                        </div>
                        <p className={`entry-outcome ${state}`}>{STATE_WORDS[state](b)}</p>
                        {b.usedIn.length > 0 && (
                          <p className="entry-where">{b.usedIn.join(" · ")}</p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
