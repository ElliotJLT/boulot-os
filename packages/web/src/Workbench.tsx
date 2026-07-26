import { useCallback, useEffect, useRef, useState } from "react";
import { BuildProgress, Markdown, collapse } from "./Activity.js";
import { MODELS } from "./models.js";

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

/**
 * What every application needs, and nothing else.
 *
 * A cover letter and a set of answers used to be part of the build, so every
 * run wrote both whether or not the employer had asked for either. Artificial
 * Societies wanted neither, and it got both: two documents nobody reads, paid
 * for in tokens and in the minutes spent watching them being written.
 *
 * Both are one click away below. Making them opt-in costs a click on the
 * applications that want them and saves the work on the ones that do not.
 */
const STEPS = [
  { key: "cv", label: "Tailor the CV", verb: "Tailoring the CV" },
  { key: "pdf", label: "Render the PDF", verb: "Rendering the PDF" },
] as const;

/**
 * Asked for per application, because most applications ask for neither.
 *
 * These sit in the build list as unticked boxes rather than as buttons
 * elsewhere. One place says what play will do, and ticking a box is how you
 * change it. The previous arrangement had the CV tab promising "press play and
 * Boulot will write it" on a document play was never going to write.
 */
const EXTRAS = [
  { key: "cover", label: "Write a cover letter", verb: "Drafting the cover letter" },
  { key: "questions", label: "Answer their questions", verb: "Answering their questions" },
  {
    key: "review",
    label: "Review it with three agents",
    verb: "Three reviewers are reading it",
  },
] as const;

/**
 * Extras that produce no file of their own.
 *
 * The review panel changes the CV rather than adding a document, so it never
 * counts as "done" and never earns a tab. It stays a box you can tick, which is
 * the right shape anyway: it is the single most expensive thing in the app.
 */
const NO_DOCUMENT = new Set(["review"]);

/** Documents that are read rather than edited, so they render rather than sit in a textarea. */
const READ_ONLY = new Set(["job", "research"]);

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
] as const;

const SOURCES = [
  { key: "job", label: "Job description" },
  { key: "research", label: "Research" },
] as const;

/** Frontmatter is plumbing; it should not be the first thing you read. */
function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md;
  const end = md.indexOf("\n---", 3);
  return end === -1 ? md : md.slice(end + 4).replace(/^\n+/, "");
}

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
  /** Extras the user has ticked. Play produces exactly the ticked list. */
  const [include, setInclude] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState("");
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
  const [rendering, setRendering] = useState(false);
  const [pdfName, setPdfName] = useState("CV.pdf");
  const [justApplied, setJustApplied] = useState(false);

  const [running, setRunning] = useState<string | null>(null);
  /*
   * What is running, not just that something is.
   *
   * The checklist used to animate on any activity, so asking for a small tweak
   * to a finished CV lit up "Tailoring the CV, Drafting the cover letter,
   * Rendering the PDF" and looked exactly like someone had pressed play. A
   * tweak is a conversation about one document; a build is the four steps.
   *
   * "adopted" is a run that started on another screen. Logging a job hands over
   * to this one mid-flight, and the workbench has to be able to narrate work it
   * did not begin.
   */
  const [runKind, setRunKind] = useState<"build" | "tweak" | "adopted" | null>(null);
  const [activity, setActivity] = useState<string[]>([]);
  /*
   * Both sides of the conversation, in order.
   *
   * This was an array of the agent's replies, so what you asked for vanished
   * the moment you pressed Send and the answer arrived with no question above
   * it. Half a transcript is worse than none: you cannot tell which reply
   * belongs to which request, and after two exchanges you cannot remember what
   * you asked.
   */
  const [turns, setTurns] = useState<Array<{ who: "you" | "boulot"; text: string }>>([]);
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
    setStage(String(d.stage ?? ""));
    if (d.downloadName) setPdfName(String(d.downloadName));
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

  /*
   * Catch up on a run that started before this screen opened.
   *
   * Logging a job hands over to the workbench mid-flight, and leaving the page
   * and coming back should not look like nothing happened. The server keeps the
   * events, so arriving late is a replay rather than a blank panel.
   */
  useEffect(() => {
    void fetch("/api/jobs")
      .then((r) => r.json())
      .then((d: { jobs: Array<{ slug: string | null; label: string; running: boolean; events: Event[] }> }) => {
        const mine = d.jobs.find((j) => j.slug === slug);
        if (!mine) return;
        setActivity(mine.events.filter((e) => e.t === "tool").map((e) => (e as { label: string }).label));
        setTurns(
          mine.events
            .filter((e) => e.t === "text")
            .map((e) => ({ who: "boulot" as const, text: (e as { text: string }).text })),
        );
        if (mine.running) {
          setRunning(mine.label);
          setRunKind("adopted");
        }
      })
      .catch(() => {});
  }, [slug]);

  useEffect(() => {
    const socket = new WebSocket(`ws://${location.host}/ws`);
    ws.current = socket;
    socket.onmessage = (e) => {
      const ev: Event = JSON.parse(e.data);
      /*
       * Only this application's work.
       *
       * With three runs able to go at once, an unfiltered stream would splice
       * another company's research into this one's log. Events carry the job
       * they belong to; anything else is somebody else's business.
       */
      const forUs = (ev as { job?: string; slug?: string }).slug === slug ||
        (ev as { job?: string }).job === slug;
      if (!forUs) return;
      if ((ev as { t: string }).t === "job") {
        const j = ev as unknown as { running: boolean; label?: string };
        setRunning(j.running ? (j.label ?? "Working") : null);
        setRunKind((k) => (j.running ? (k ?? "adopted") : null));
        if (!j.running) void refresh();
        return;
      }
      if (ev.t === "tool") {
        setActivity((a) => [...a, ev.label]);
        // Work arriving with nothing running locally means another screen
        // started it and handed this one the job of showing it.
        setRunning((r) => r ?? "Working");
        setRunKind((k) => k ?? "adopted");
      }
      else if (ev.t === "file") {
        setActivity((a) => [...a, `Saved ${ev.path.split("/").pop()}`]);
        /*
         * Show the document being written, unless the user has picked a tab.
         *
         * Watching research appear is the whole reason to be on this screen
         * while a run is going. Never overrides a deliberate choice.
         */
        const name = ev.path.split("/").pop() ?? "";
        const tabFor: Record<string, string> = {
          "research.md": "research",
          "job.md": "job",
          "cv.md": "cv",
          "cover-letter.md": "cover",
          "application-answers.md": "questions",
        };
        const next = tabFor[name];
        if (next && !chosen.current) {
          tabRef.current = next;
          setTab(next);
        }
        void refresh();
      } else if (ev.t === "text") setTurns((t) => [...t, { who: "boulot", text: ev.text }]);
      else if (ev.t === "error") setTurns((t) => [...t, { who: "boulot", text: ev.message }]);
      else if (ev.t === "result") {
        setRunning(null);
        setRunKind(null);
        setCost((c) => c + ev.cost);
        setPdfKey((k) => k + 1);
        void refresh();
      }
    };
    return () => socket.close();
  }, [refresh]);

  const send = (
    prompt: string,
    label: string,
    kind: "build" | "tweak" = "build",
    model: string = MODELS.tailor,
  ) => {
    if (running || !ws.current) return;
    setRunKind(kind);
    setRunning(label);
    setActivity([]);
    setActivity([]);
    ws.current.send(JSON.stringify({ prompt, person: who, job: slug, slug, label, model }));
  };

  /**
   * File the application away.
   *
   * Nothing is deleted: the folder moves to `archive/`, which the funnel and
   * the career record both still read. Closing back to the board afterwards is
   * the point of the whole feature, so it happens without asking again.
   */
  /**
   * Throw away the drafts and start the writing again.
   *
   * Keeps the job description and the research, which cost web searches and
   * minutes to gather and are not what went wrong. Confirmed once, because it
   * deletes work, and unlike archiving it is not reversible.
   */
  const reset = async () => {
    if (running) return;
    if (!confirm("Delete the CV, cover letter, answers and PDF for this application?\n\nThe job description and research are kept.")) return;
    await fetch(`/api/${who}/job/${slug}/reset`, { method: "POST" });
    setText((t) => ({ ...t, cv: "", cover: "", questions: "" }));
    setInclude(new Set());
    chosen.current = false;
    setTab("cv");
    await refresh();
  };

  /** Record that it went out, and let the board work out the date. */
  const markApplied = async () => {
    await fetch(`/api/${who}/job/${slug}/stage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stage: "applied" }),
    });
    setStage("applied");
    /*
     * Say it happened.
     *
     * The button vanished and nothing else changed, so the only evidence the
     * click had worked was the absence of the thing you clicked. Pressing
     * submit on someone's form is the point of the whole exercise; it deserves
     * an acknowledgement rather than a disappearance.
     */
    setJustApplied(true);
    onArchived?.();
  };

  const archive = async (outcome: string) => {
    const r = await fetch(`/api/${who}/job/${slug}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome }),
    });
    setFiling(false);
    if (!r.ok) {
      setTurns((t) => [...t, { who: "boulot", text: "Could not archive that. It may already be filed." }]);
      return;
    }
    onArchived?.();
    onClose();
  };

  const done = (key: string) =>
    key === "pdf" ? pdfExists : Boolean(docs.find((d) => d.key === key)?.exists);
  const allDone = STEPS.every((s) => done(s.key));

  /**
   * Produce one of the optional documents.
   *
   * Questions is deliberately not run from here: the tab opens empty so the
   * user can paste what the employer actually asked, and the play button then
   * answers those. Guessing the questions from the job description produces
   * confident answers to questions nobody asked.
   */
  const askFor = (key: string) => {
    if (running || key !== "cover") return;
    send(
      `For the application in active/${slug}, use the boulot:application-answers skill to write a ` +
        `cover letter to active/${slug}/cover-letter.md. Read cv.md, job.md and research.md first.`,
      "Writing the cover letter",
      // Not a build. Passing no kind defaulted to one, which is why asking for
      // a cover letter made the CV and PDF steps animate as though the whole
      // application were being rebuilt.
      "tweak",
      MODELS.writing,
    );
  };

  const runAll = async () => {
    /*
     * Save first.
     *
     * Questions are pasted into the tab and then the run reads them off disk,
     * so an unsaved paste would have the agent answering the previous contents
     * of the file, or an empty one.
     */
    if (dirty) await save();
    /*
     * The CV first, then the extras, then the PDF.
     *
     * A cover letter written before the CV argues from the master record rather
     * than from the tailored one, and the PDF has to come last or it renders a
     * CV that is about to change.
     */
    const plan = [
      STEPS[0],
      ...EXTRAS.filter((e) => include.has(e.key)),
      STEPS[1],
    ] as ReadonlyArray<{ key: string; label: string; verb: string }>;
    const missing = plan.filter((s) => !done(s.key));
    if (!missing.length) return;
    /*
     * Hand it the documents rather than making it find them.
     *
     * One measured run cost $5.90 and spent it like this: nine vault searches,
     * the job description read four times, the career record three times, the
     * CV it had just written three times. The files never changed during the
     * run. Attaching them inline is the same trick the tweak box already uses,
     * and it is cheaper than the tool calls it replaces because the prefix
     * caches.
     */
    const attach = (label: string, body: string, file: string) =>
      body.trim() ? `\n\n<${label} path="active/${slug}/${file}">\n${body.trim()}\n</${label}>` : "";

    const instruction = (key: string) =>
      key === "cv"
        ? `Use the boulot:tailor-cv skill to write active/${slug}/cv.md. Show the JD mapping table.`
        : key === "cover"
          ? `Use the boulot:application-answers skill to write a cover letter to active/${slug}/cover-letter.md.`
          : key === "questions"
            ? `Answer the questions already written in active/${slug}/application-answers.md, in that file, beneath each one. Answer only what is written there.`
            : key === "review"
              ? `Run the three adversarial reviewers described in boulot:tailor-cv, then apply their edits to cv.md.`
              : `Call boulot_render_pdf on active/${slug}/cv.md to active/${slug}/cv.pdf and report the fit.`;

    send(
      `For the application in active/${slug}, do these in order:\n\n` +
        missing.map((s, i) => `${i + 1}. ${instruction(s.key)}`).join("\n") +
        `\n\nThe job description is included below, so you do not need to open it. ` +
        `Read cv-master.md once for the evidence bank, and research.md once if you ` +
        `need the company angle. Do not re-read a file you have already read in ` +
        `this run, and do not search the vault for reference CVs: the master ` +
        `record is the source.` +
        attach("job_description", text.job ?? "", "job.md") +
        `\n\nKeep commentary short.`,
      "Building the application",
    );
  };

  /*
   * Save on its own, shortly after you stop typing.
   *
   * Pasting questions into a box and then having to find a Save button is the
   * kind of step that exists only because the code found it convenient. The
   * documents are files on disk with no other reader, so there is nothing to
   * conflict with and nothing to lose by writing them.
   *
   * Debounced rather than per-keystroke: a write per character would be a lot
   * of pointless disk traffic and would make every keypress a network call.
   */
  useEffect(() => {
    if (!dirty) return;
    const which = tabRef.current;
    const t = setTimeout(() => {
      void fetch(`/api/${who}/job/${slug}/doc/${which}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown: text[which] ?? "" }),
      })
        .then(() => {
          setDirty(false);
          /*
           * Editing the CV re-renders the PDF.
           *
           * Without this the preview is whatever the agent last produced, so
           * the moment you fix a line by hand the page beside it is a lie. The
           * renderer needs no model and takes about four seconds, so there is
           * nothing to weigh up: the honest page is free.
           */
          if (which !== "cv") return;
          setRendering(true);
          return fetch(`/api/${who}/job/${slug}/pdf`, { method: "POST" })
            .then((r) => r.json())
            .then((d) => {
              setFit(d.fit ?? null);
              setPdfExists(Boolean(d.pdf));
              setPdfKey((k) => k + 1);
            })
            .finally(() => setRendering(false));
        })
        .catch(() => setRendering(false));
    }, 900);
    return () => clearTimeout(t);
  }, [text, dirty, who, slug]);

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

    setTurns((t) => [...t, { who: "you", text: q }]);
    send(
      `Application: active/${slug}\n\n` +
        `The current contents of the files are included below, so you do not need to open them. ` +
        `Use Edit to change them.` +
        attach("cv", cv, "cv.md") +
        attach("job_description", job, "job.md") +
        `\n\nRequest: ${q}\n\n` +
        /*
         * The instruction that makes corrections stick.
         *
         * Without it, telling the agent that a bare PR count is a vanity metric
         * teaches it nothing: the run ends and the same note gets made again
         * next week. The bar is deliberately high, because a lessons file that
         * fills with one-off facts about single applications is noise and stops
         * being read.
         */
        `If this request corrects how you should write in general, rather than ` +
        `changing one detail of this application, append a single line to ` +
        `profile/lessons.md saying what to do differently, in the imperative. ` +
        `Create the file if it does not exist. Do not record anything specific ` +
        `to this one employer, and do not record it twice: read the file first ` +
        `and skip if it is already there. If this is a one-off change, do not ` +
        `write anything.`,
      "Working",
      "tweak",
      MODELS.tweak,
    );
    setAsk("");
  };

  return (
    <div className="bench">
      <header className="bench-top">
        <button className="back" onClick={onClose} title="Back to the board" aria-label="Back to the board">
          ←
        </button>
        <h2>
          {company}
          {(justApplied || stage === "applied") && (
            <span
              className={justApplied ? "applied-tick pop" : "applied-tick"}
              title="Marked as applied"
              aria-label="Applied"
            >
              ✓
            </span>
          )}
        </h2>
        <div className="bench-actions">
          {fit && (
            <span className={`fit ${fit.fits ? "fit-ok" : "fit-over"}`}>
              {fit.fits ? `${fit.pages}pp` : `${fit.pages}pp · ${fit.overflowMm}mm over`}
            </span>
          )}
          {dirty ? (
            <span className="saving">Saving…</span>
          ) : rendering ? (
            <span className="saving">Re-rendering the page…</span>
          ) : null}
          {pdfExists && (
            <a className="ghost" href={`/api/${who}/job/${slug}/file/cv.pdf`} download={pdfName}>
              Download
            </a>
          )}
          {/*
            The other thing you do on this screen: say you sent it.
            
            Dragging the card works too, but you are here when you actually
            press submit on their form, and going back to the board to record
            that is the kind of errand nobody runs.
          */}
          {stage !== "applied" && !stage.startsWith("closed") && (
            <button className="ghost" onClick={() => void markApplied()}>
              Mark as applied
            </button>
          )}
          {/*
            Anything regenerable counts.
            
            This checked only for a CV or a PDF, so an application that had a
            cover letter and nothing else offered no way to start over, which is
            exactly the state a first attempt leaves you in.
          */}
          {(pdfExists || ["cv", "cover", "questions"].some((k) => done(k))) && (
            <button className="ghost" disabled={Boolean(running)} onClick={() => void reset()}>
              Start over
            </button>
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
              {[
                ...OUTPUTS,
                // An extra earns a tab by existing. Until then it is a button.
                ...EXTRAS.filter(
                  (e) =>
                    !NO_DOCUMENT.has(e.key) &&
                    (include.has(e.key) || docs.find((d) => d.key === e.key)?.exists),
                ).map((e) => ({ key: e.key, label: e.key === "cover" ? "Cover letter" : "Questions" })),
              ].map((t) => {
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

          {/*
            "Answer these" used to sit here. It was left behind when the build
            list gained checkboxes, so there were two ways to ask for the same
            thing and only one of them respected the order. Pressing it with no
            CV written answered the questions from the master record, which is
            the failure it was supposed to prevent.
          */}
          {tab === "pdf" ? (
            <iframe className="pdf" key={pdfKey} title="CV" src={`/api/${who}/job/${slug}/file/cv.pdf?v=${pdfKey}`} />
          ) : text[tab] === undefined ? (
            <p className="hint">Loading…</p>
          ) : READ_ONLY.has(tab) ? (
            /*
             * Reference, not a draft.
             *
             * The job description and the research were shown as raw markdown in
             * a monospace box, frontmatter and all, so the most useful reading
             * on the screen was the least readable thing on it. These are the
             * two documents nobody edits, so they render.
             */
            <div className="reading">
              <Markdown text={stripFrontmatter(text[tab] ?? "")} />
            </div>
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
              <h3>
                {runKind === "tweak"
                  ? (running ?? "Working")
                  : allDone
                    ? "Ready to send"
                    : "Build this application"}
              </h3>
              <button
                className="play"
                onClick={() => void runAll()}
                disabled={Boolean(running) || allDone}
                title={allDone ? "Everything is written" : "Write the whole application"}
              >
                {running ? <span className="spinner" /> : allDone ? "✓" : "▶"}
              </button>
            </div>
            <ol>
              {[
                STEPS[0],
                ...EXTRAS,
                STEPS[1],
              ].map((s) => {
                const optional = EXTRAS.some((e) => e.key === s.key);
                const ticked = include.has(s.key);
                const isDone = done(s.key);
                const isLive = runKind === "build" && Boolean(running) && !isDone && (!optional || ticked);
                if (optional && !isDone) {
                  return (
                    <li key={s.key} className={ticked ? "step-opt on" : "step-opt"}>
                      <label>
                        <input
                          type="checkbox"
                          checked={ticked}
                          disabled={Boolean(running)}
                          onChange={(e) =>
                            setInclude((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(s.key);
                              else next.delete(s.key);
                              return next;
                            })
                          }
                        />
                        <span>{isLive ? s.verb : s.label}</span>
                      </label>
                    </li>
                  );
                }
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
            {/*
              Where the work has got to, above the list of what it touched.
              
              A build reads the job description three times because three
              reviewers each read it, which is correct and reads as a stuck
              loop. The calls are still here, one fold down, for anyone who
              wants them.
            */}
            {activity.length > 0 && runKind !== "tweak" && (
              <BuildProgress labels={activity} running={Boolean(running)} />
            )}
            {activity.length > 0 && (
              <details className="steps" open={false}>
                <summary>{collapse(activity).length} steps</summary>
                {collapse(activity).map((a, i) => (
                  <p className="activity" key={i}>
                    {a.text}
                    {a.count > 1 && <span className="times"> ×{a.count}</span>}
                  </p>
                ))}
              </details>
            )}
            {turns.map((t, i) =>
              t.who === "you" ? (
                <div className="asked" key={i}>
                  {t.text}
                </div>
              ) : (
                <div className="answer" key={i}>
                  <Markdown text={t.text} />
                </div>
              ),
            )}
            {Boolean(running) && (
              <p className="keeps-going">
                This keeps running if you leave. Go back to the board and start another one.
              </p>
            )}
            {!running && !activity.length && !turns.length && (
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
