import { useEffect, useState } from "react";
import { Insights } from "./Insights.js";

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
  proven: (b) => `${b.reachedInterview} of ${b.usedIn.length} → interview`,
  used: (b) => `on ${b.usedIn.length} CV${b.usedIn.length === 1 ? "" : "s"}`,
  never: () => "unused",
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
type Ranked = { text: string; usedIn: string[]; reached: number };
type Works = {
  applications: number;
  withCv: number;
  reached: number;
  headlines: Ranked[];
  summaries: Ranked[];
};

type Master = {
  updated: string | null;
  works?: Works;
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
        The funnel first, then what the writing did.

        These were two pages behind two clicks, and the split was arbitrary:
        one says what the search is doing, the other says what the writing is
        doing, and neither means much without the other. A 3% reply rate is a
        writing problem; a 30% reply rate with no second interviews is not.
        Same page, in that order, because the funnel is the denominator for
        everything below it.
      */}
      <Insights who={who} embedded />

      {/*
        The three bars that used to sit here are gone.

        "Used in a CV 19/24" and "Carry a figure 14/24" are proportions of an
        evidence bank, and a proportion implies a target. There is no right
        percentage of your career that should carry a figure, so the bar drew a
        goal line where none exists and invited progress towards a number that
        means nothing.

        Worse, they were the third telling of the same three facts: the filter
        chips carry the counts and act on them, and the never-picked line below
        says the one thing worth doing about it. Three representations, one of
        which was actionable.

        The proportion that does mean something is applications to replies, and
        that lives in the panel below, where the denominator is real.
      */}

      {/*
        What has worked, laid out the way a CV is laid out.

        The headline and the summary are the two most-tailored sentences on any
        CV, and they were the two with no memory: rewritten fresh every time,
        then forgotten. This shows the versions that actually earned a reply,
        quoted, with the honest denominator underneath — and the same numbers
        are fed to the agent before it writes anything, so what you see here is
        what it knows there.
      */}
      <section className="worked">
        <h3>What has worked</h3>
        {m.works && m.works.reached > 0 ? (
          <p className="lede">
            From the {m.works.withCv} applications with a CV in the vault, {m.works.reached} reached
            a screen or interview. Small sample — a hint, not a rule — but these are the versions
            that earned a reply, and Boulot starts from them when it writes.
          </p>
        ) : m.works && m.works.withCv > 0 ? (
          <p className="lede">
            {m.works.withCv} sent CVs are in the vault, none of which has reached an interview yet.
            When one does, the wording that worked will appear here and feed back into the writing.
          </p>
        ) : null}

        {m.works &&
          m.works.reached > 0 &&
          m.works.headlines.some((h) => h.reached > 0) && (
            <div className="worked-group">
              <span className="worked-label">Headline</span>
              {m.works!.headlines.filter((h) => h.reached > 0).slice(0, 2).map((h, i) => (
                <div className="worked-item" key={i}>
                  <p className="worked-quote">{h.text}</p>
                  <span className="worked-score" title={h.usedIn.join(", ")}>
                    {h.reached} of {h.usedIn.length} reached interview
                  </span>
                </div>
              ))}
            </div>
          )}

        {m.works &&
          m.works.reached > 0 &&
          m.works.summaries.some((x) => x.reached > 0) && (
            <div className="worked-group">
              <span className="worked-label">Summary</span>
              {m.works!.summaries.filter((x) => x.reached > 0).slice(0, 2).map((x, i) => (
                <div className="worked-item" key={i}>
                  <p className="worked-quote">{x.text}</p>
                  <span className="worked-score" title={x.usedIn.join(", ")}>
                    {x.reached} of {x.usedIn.length} reached interview
                  </span>
                </div>
              ))}
            </div>
          )}

        {/*
          The entries live inside the same card as the headline and summary,
          because they are the third row of the same record, not a separate
          page below it. The search and the filters come with them: a control
          that filters a list belongs to the list.
        */}
        <div className="worked-group worked-entries">
          <span className="worked-label">Bullets</span>
          <div className="worked-body">
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
                {shown.length === r.bullets.length
                  ? `${r.bullets.length} entries`
                  : `showing ${shown.length} of ${r.bullets.length}`}
                {r.deeperDetail > 0 && (
                  <span
                    className="interview-only"
                    title="Detail kept for interview prep. Never printed on a CV."
                  >
                    +{r.deeperDetail} interview-prep notes
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
        </div>
      </section>
    </div>
  );
}
