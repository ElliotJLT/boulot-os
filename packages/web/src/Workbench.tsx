import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown, collapse } from "./Activity.js";

/**
 * The application workbench.
 *
 * Not a chat. An application has a known shape (a tailored CV, a cover letter,
 * answers to their questions, a rendered PDF) so the interface is a checklist
 * with a play button, and the documents fill in as the agent works. Chat is the
 * fallback for tweaks, not the primary way to get anything done.
 *
 * The previous version opened on an empty editor and a chat prompt, which is a
 * dead end: the user had just logged a role and had nothing to react to.
 */

type Fit = {
  fits: boolean;
  pages: number;
  overflowMm: number;
  trimTarget: { section: string; charactersToCut: number } | null;
};
type Doc = { key: string; label: string; file: string; exists: boolean; chars: number };
type Event =
  | { t: "text"; text: string }
  | { t: "tool"; name: string; label: string }
  | { t: "file"; path: string }
  | { t: "result"; cost: number; error: boolean }
  | { t: "error"; message: string };

/** Deliverables, in the order they should be produced. */
const STEPS = [
  { key: "cv", label: "Tailor the CV", verb: "Tailoring the CV" },
  { key: "cover", label: "Draft a cover letter", verb: "Drafting the cover letter" },
  { key: "questions", label: "Answer their questions", verb: "Answering their questions" },
  { key: "pdf", label: "Render the PDF", verb: "Rendering the PDF" },
] as const;

/**
 * How an application ended.
 *
 * Five options, not a free-text box. The outcome is the funnel's denominator,
 * and a field that accepts "didn't hear back", "ghosted" and "no response" as
 * three different answers cannot be counted.
 */
const OUTCOMES = [
  { key: "rejected", label: "Rejected" },
  { key: "ghosted", label: "No reply" },
  { key: "withdrawn", label: "I withdrew" },
  { key: "offer_declined", label: "Declined offer" },
  { key: "offer_accepted", label: "Accepted" },
] as const;

/**
 * Tabs in two groups: what you will send, and what it was built from.
 *
 * Flat, they mixed outputs with source material, so the CV sat next to the job
 * description as though they were the same kind of thing. The PDF now sits
 * beside the CV because it is the same document in the form you actually judge.
 * Labels are short: the group tells you what these are.
 */
const OUTPUTS = [
  { key: "cv", label: "CV" },
  { key: "pdf", label: "PDF" },
  { key: "cover", label: "Cover letter" },
  { key: "questions", label: "Questions" },
] as const;

const SOURCES = [
  { key: "job", label: "Job description" },
  { key: "research", label: "Research" },
] as const;

export function Workbench({
  who,
  slug,
  company,
  onClose,
  onArchived,
}: {
  who: string;
  slug: string;
  company: string;
  onClose: () => void;
  onArchived?: () => void;
}) {
  const [filing, setFiling] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [pdfExists, setPdfExists] = useState(false);
  const [fit, setFit] = useState<Fit | null>(null);
  // Opens on the PDF when one exists, because that is the thing you are
  // actually judging. The markdown is how you change it, not how you read it.
  // Only applies until the user picks a tab themselves.
  const [tab, setTab] = useState<string>("cv");
  const chosen = useRef(false);
  const [text, setText] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [flash, setFlash] = useState(false);

  const [running, setRunning] = useState<string | null>(null);
  const [activity, setActivity] = useState<string[]>([]);
  const [said, setSaid] = useState<string[]>([]);
  const [ask, setAsk] = useState("");
  const [cost, setCost] = useState(0);
  const [pdfKey, setPdfKey] = useState(0);

  const ws = useRef<WebSocket | null>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const refresh = useCallback(async () => {
    const d = await fetch(`/api/${who}/job/${slug}/docs`).then((r) => r.json());
    setDocs(d.docs ?? []);
    setPdfExists(Boolean(d.pdf));
    if (d.pdf && !chosen.current) {
      chosen.current = true;
      tabRef.current = "pdf";
      setTab("pdf");
    }
    setFit(d.fit ?? null);
    // Always keep cv and job in memory: the tweak box attaches them regardless
    // of which tab is showing, and the PDF tab has no markdown of its own.
    const active = tabRef.current;
    const needed = [...new Set([active === "pdf" ? "cv" : active, "cv", "job"])];
    const loaded = await Promise.all(
      needed.map((k) =>
        fetch(`/api/${who}/job/${slug}/doc/${k}`)
          .then((r) => r.json())
          .then((d) => [k, d.markdown ?? ""] as const),
      ),
    );
    if (dirtyRef.current) return;
    setText((t) => ({ ...t, ...Object.fromEntries(loaded.filter(([k]) => k !== active)) }));
    const doc = { markdown: loaded.find(([k]) => k === active)?.[1] ?? "" };
    if (active === "pdf") return;
    setText((t) => {
      // Flash the pane when the agent changes what you are looking at, so it is
      // obvious something arrived rather than silently swapping underneath.
      if (t[active] !== undefined && t[active] !== doc.markdown) {
        setFlash(true);
        setTimeout(() => setFlash(false), 800);
      }
      return { ...t, [active]: doc.markdown ?? "" };
    });
  }, [who, slug]);

  useEffect(() => {
    void refresh();
  }, [refresh, tab]);

  useEffect(() => {
    const socket = new WebSocket(`ws://${location.host}/ws`);
    ws.current = socket;
    socket.onmessage = (e) => {
      const ev: Event = JSON.parse(e.data);
      if (ev.t === "tool") setActivity((a) => [...a, ev.label]);
      else if (ev.t === "file") {
        setActivity((a) => [...a, `Saved ${ev.path.split("/").pop()}`]);
        void refresh();
      } else if (ev.t === "text") setSaid((s) => [...s, ev.text]);
      else if (ev.t === "error") setSaid((s) => [...s, ev.message]);
      else if (ev.t === "result") {
        setRunning(null);
        setCost((c) => c + ev.cost);
        setPdfKey((k) => k + 1);
        void refresh();
      }
    };
    return () => socket.close();
  }, [refresh]);

  const send = (prompt: string, label: string) => {
    if (running || !ws.current) return;
    setRunning(label);
    setActivity([]);
    setSaid([]);
    ws.current.send(JSON.stringify({ prompt, person: who }));
  };

  /**
   * File the application away.
   *
   * Nothing is deleted: the folder moves to `archive/`, which the funnel and
   * the career record both still read. Closing back to the board afterwards is
   * the point of the whole feature, so it happens without asking again.
   */
  const archive = async (outcome: string) => {
    const r = await fetch(`/api/${who}/job/${slug}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome }),
    });
    setFiling(false);
    if (!r.ok) {
      setSaid((s) => [...s, "Could not archive that. It may already be filed."]);
      return;
    }
    onArchived?.();
    onClose();
  };

  const done = (key: string) =>
    key === "pdf" ? pdfExists : Boolean(docs.find((d) => d.key === key)?.exists);
  const allDone = STEPS.every((s) => done(s.key));

  const runAll = () => {
    const missing = STEPS.filter((s) => !done(s.key));
    if (!missing.length) return;
    const instruction = (key: string) =>
      key === "cv"
        ? `Use the boulot:tailor-cv skill to write active/${slug}/cv.md. Show the JD mapping table.`
        : key === "cover"
          ? `Use the boulot:application-answers skill to write a cover letter to active/${slug}/cover-letter.md.`
          : key === "questions"
            ? `If active/${slug}/application-answers.md lists questions, answer them there. If it does not exist, check job.md for application questions; if there are none, write a one-line note saying so.`
            : `Call boulot_render_pdf on active/${slug}/cv.md to active/${slug}/cv.pdf and report the fit.`;
    send(
      `For the application in active/${slug}, do these in order:\n\n` +
        missing.map((s, i) => `${i + 1}. ${instruction(s.key)}`).join("\n") +
        `\n\nKeep commentary short.`,
      "Building the application",
    );
  };

  const save = async () => {
    await fetch(`/api/${who}/job/${slug}/doc/${tab}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ markdown: text[tab] ?? "" }),
    });
    setDirty(false);
    void refresh();
  };

  /**
   * Ask for a change, with the documents attached.
   *
   * The agent used to go and find the CV and the job description before it
   * could answer anything, six steps to read two files that were already open
   * in the browser. It reread each of them twice. Sending the content inline
   * removes the round trip entirely, and it is cheaper than the tool calls it
   * replaces because the prefix caches.
   *
   * The wording of the covering line matters more than it should. An earlier
   * version said "you already have them: do not search for them and do not
   * read them again", meaning do not call the Read tool. The model read it as
   * do not consult this content, and answered questions about the attached CV
   * with "NONE" while the text sat in front of it. Tested: the tag wrapper is
   * fine, attaching the document is fine, and that one sentence is what broke
   * it. Say what is true ("these are included, you do not need to open them")
   * rather than issuing a prohibition that can be read too widely.
   *
   * Sending the editor's content, not the file's, also means an unsaved edit is
   * what gets reasoned about. Reading from disk would have quietly ignored
   * whatever you had just typed.
   */
  const tweak = async () => {
    const q = ask.trim();
    if (!q || running) return;
    if (dirty) await save();

    const cv = text.cv ?? "";
    const job = text.job ?? "";
    const attach = (label: string, body: string, file: string) =>
      body.trim() ? `\n\n<${label} path="active/${slug}/${file}">\n${body.trim()}\n</${label}>` : "";

    send(
      `Application: active/${slug}\n\n` +
        `The current contents of the files are included below, so you do not need to open them. ` +
        `Use Edit to change them.` +
        attach("cv", cv, "cv.md") +
        attach("job_description", job, "job.md") +
        `\n\nRequest: ${q}`,
      "Working",
    );
    setAsk("");
  };

  return (
    <div className="bench">
      <header className="bench-top">
        <button className="back" onClick={onClose}>
          ← Board
        </button>
        <h2>{company}</h2>
        <div className="bench-actions">
          {fit && (
            <span className={`fit ${fit.fits ? "fit-ok" : "fit-over"}`}>
              {fit.fits ? `${fit.pages}pp` : `${fit.pages}pp · ${fit.overflowMm}mm over`}
            </span>
          )}
          {dirty && (
            <button className="ghost" onClick={save}>
              Save
            </button>
          )}
          {pdfExists && (
            <a className="ghost" href={`/api/${who}/job/${slug}/file/cv.pdf`} download={`${company} CV.pdf`}>
              Download
            </a>
          )}
          <button className="ghost" onClick={() => setFiling((f) => !f)}>
            {filing ? "Cancel" : "Archive"}
          </button>
        </div>
      </header>

      {/*
        Filing asks for the outcome, and asks in one click rather than a modal.
        The outcome is the only part of this worth capturing: it is what the
        funnel divides by, so an application archived as "rejected" and one
        archived as "ghosted" say completely different things about the search.
      */}
      {filing && (
        <div className="filing">
          <span>How did it end?</span>
          {OUTCOMES.map((o) => (
            <button key={o.key} className="outcome" onClick={() => archive(o.key)}>
              {o.label}
            </button>
          ))}
        </div>
      )}

      <div className="bench-body">
        <section className={`pane${flash ? " pane-flash" : ""}`}>
          <div className="tabs">
            <div className="tab-group">
              {OUTPUTS.map((t) => {
                if (t.key === "pdf" && !pdfExists) return null;
                const d = docs.find((x) => x.key === t.key);
                return (
                  <button
                    key={t.key}
                    className={tab === t.key ? "on" : ""}
                    onClick={() => {
                      chosen.current = true;
                      setTab(t.key);
                      setDirty(false);
                    }}
                  >
                    {t.label}
                    {t.key !== "pdf" && d && !d.exists && <span className="empty-dot" title="not written yet" />}
                  </button>
                );
              })}
            </div>

            <span className="tab-split" />

            <div className="tab-group tab-source">
              {SOURCES.map((t) => {
                const d = docs.find((x) => x.key === t.key);
                return (
                  <button
                    key={t.key}
                    className={tab === t.key ? "on" : ""}
                    onClick={() => {
                      chosen.current = true;
                      setTab(t.key);
                      setDirty(false);
                    }}
                  >
                    {t.label}
                    {d && !d.exists && <span className="empty-dot" title="not written yet" />}
                  </button>
                );
              })}
            </div>
          </div>

          {tab === "pdf" ? (
            <iframe className="pdf" key={pdfKey} title="CV" src={`/api/${who}/job/${slug}/file/cv.pdf?v=${pdfKey}`} />
          ) : text[tab] === undefined ? (
            <p className="hint">Loading…</p>
          ) : (
            <textarea
              className="editor"
              value={text[tab]}
              spellCheck={false}
              placeholder={
                tab === "questions"
                  ? "Paste the application questions here and press play, or write them out:\n\n1. Why do you want to work here?"
                  : "Nothing here yet. Press play and Boulot will write it, or start typing."
              }
              onChange={(e) => {
                setText((t) => ({ ...t, [tab]: e.target.value }));
                setDirty(true);
              }}
            />
          )}

          {fit && !fit.fits && fit.trimTarget && (
            <p className="fitline">
              Cut about <strong>{fit.trimTarget.charactersToCut}</strong> characters from{" "}
              <strong>{fit.trimTarget.section}</strong>. What spills off the end is usually not what to cut.
            </p>
          )}
        </section>

        <section className="pane side">
          <div className="checklist">
            <div className="checklist-top">
              <h3>{allDone ? "Ready to send" : "Build this application"}</h3>
              <button
                className="play"
                onClick={runAll}
                disabled={Boolean(running) || allDone}
                title={allDone ? "Everything is written" : "Write the whole application"}
              >
                {running ? <span className="spinner" /> : allDone ? "✓" : "▶"}
              </button>
            </div>
            <ol>
              {STEPS.map((s) => {
                const isDone = done(s.key);
                const isLive = Boolean(running) && !isDone;
                return (
                  <li key={s.key} className={isDone ? "step-done" : isLive ? "step-live" : ""}>
                    <span className="box">{isDone ? "✓" : isLive ? <span className="dot" /> : ""}</span>
                    <span>{isLive ? s.verb : s.label}</span>
                  </li>
                );
              })}
            </ol>
            {cost > 0 && <p className="cost">£{(cost * 0.79).toFixed(2)} this session</p>}
          </div>

          <div className="log">
            {activity.length > 0 && (
              <details className="steps" open={Boolean(running)}>
                <summary>{collapse(activity).length} steps</summary>
                {collapse(activity).map((a, i) => (
                  <p className="activity" key={i}>
                    {a.text}
                    {a.count > 1 && <span className="times"> ×{a.count}</span>}
                  </p>
                ))}
              </details>
            )}
            {said.map((t, i) => (
              <div className="answer" key={i}>
                <Markdown text={t} />
              </div>
            ))}
            {!running && !activity.length && !said.length && (
              <p className="hint">
                Press play and Boulot writes the whole application, updating the documents on the left as it
                goes. Edit anything yourself, or ask for a change below.
              </p>
            )}
          </div>

          <div className="composer">
            <textarea
              rows={2}
              value={ask}
              placeholder="Tweak something…"
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) tweak();
              }}
            />
            <button onClick={tweak} disabled={Boolean(running) || !ask.trim()}>
              Send
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
