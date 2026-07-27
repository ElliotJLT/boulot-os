import { useEffect, useRef, useState } from "react";
import { IntakeProgress, Markdown, Thinking } from "./Activity.js";
import { MODELS } from "./models.js";

/**
 * Starting an application.
 *
 * One box that takes either a link or pasted text, because job boards block
 * automated fetching often enough that demanding a URL would fail regularly and
 * demanding a paste would be tedious. The agent tries the link and asks for the
 * text when it cannot read it.
 */

type Event =
  | { t: "text"; text: string }
  | { t: "tool"; name: string; label: string }
  | { t: "file"; path: string }
  | { t: "result"; cost: number; error: boolean }
  | { t: "error"; message: string };

type Line = { kind: "activity" | "said" | "problem"; text: string };

const looksLikeUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

export function NewApplication({
  who,
  onClose,
  onCreated,
  onOpen,
  watch,
}: {
  who: string;
  onClose: () => void;
  onCreated: () => void;
  /** Called once the folder exists, so the user can watch the rest happen in it. */
  onOpen?: (slug: string, company: string) => void;
  /** A run already in progress to attach to, instead of starting a new one. */
  watch?: string;
}) {
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [cost, setCost] = useState(0);
  const [failed, setFailed] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const log = useRef<HTMLDivElement>(null);
  // Held in a ref so the socket effect can depend on nothing. An inline
  // callback in the dependency array is recreated every render, which tore the
  // socket down mid-run on every log line.
  const created = useRef(onCreated);
  created.current = onCreated;
  const opened = useRef(onOpen);
  opened.current = onOpen;
  // Only hand off once, however many files the run writes.
  const handedOff = useRef(false);
  // Its own id, because a new application has no folder to be named after yet.
  const jobId = useRef(watch ?? `new-${Date.now()}`);

  /**
   * A name for the card, from what was pasted.
   *
   * The board shows a placeholder the moment you press Start, and "Reading the
   * job" is indistinguishable from the other one you started a minute ago. Job
   * pages almost always open with the company name, and a URL carries it in the
   * host, so the first useful line is a good enough guess. It is replaced by
   * status.md as soon as that exists and is never written to disk.
   */
  const guessCompany = (input: string): string | undefined => {
    const t = input.trim();
    if (!t) return undefined;
    const url = /^https?:\/\/([^/]+)/i.exec(t);
    if (url) {
      const host = (url[1] ?? "").replace(/^www\./, "").split(".")[0] ?? "";
      // Board hosts name the board, not the employer, and the slug after them
      // usually does name the employer.
      if (/^(boards|jobs|apply|job-boards|careers|hire|ashbyhq|greenhouse|lever|workable)$/i.test(host)) {
        const seg = t.split("/").filter(Boolean)[2] ?? "";
        return seg ? seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : undefined;
      }
      return host ? host.charAt(0).toUpperCase() + host.slice(1) : undefined;
    }
    /*
     * The first line is usually the company, and sometimes it is the job title.
     * "Founding Engineer" on a card is worse than no guess at all, because it
     * reads as a company you have never heard of rather than as a placeholder.
     */
    const TITLE = /\b(engineer|manager|designer|developer|lead|director|analyst|scientist|architect|consultant|officer|head of|vp |chief)\b/i;
    const line = t
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 1 && l.length < 60 && !TITLE.test(l));
    return line;
  };

  /*
   * Attach to a run already going.
   *
   * Clicking the shimmering card comes back here, and the events are kept on
   * the server, so the log picks up where it is rather than starting blank.
   */
  useEffect(() => {
    if (!watch) return;
    setRunning(true);
    setStartedAt(Date.now());
    void fetch("/api/jobs")
      .then((r) => r.json())
      .then((d: { jobs: Array<{ id: string; running: boolean; events: Array<Record<string, unknown>> }> }) => {
        const mine = d.jobs.find((j) => j.id === watch);
        if (!mine) return setRunning(false);
        setRunning(mine.running);
        const replay: Line[] = [];
        for (const e of mine.events) {
          if (e.t === "tool") replay.push({ kind: "activity", text: String(e.label) });
          else if (e.t === "text") replay.push({ kind: "said", text: String(e.text) });
        }
        setLines(replay);
      })
      .catch(() => setRunning(false));
  }, [watch]);

  useEffect(() => {
    const socket = new WebSocket(`ws://${location.host}/ws`);
    ws.current = socket;
    socket.onmessage = (e) => {
      const ev: Event = JSON.parse(e.data);
      // Only our own run: three can be going at once.
      const j = (ev as { job?: string }).job;
      if (j && j !== jobId.current) return;
      if ((ev as { t: string }).t === "job") return;
      if (ev.t === "tool") {
        setLines((l) => [...l, { kind: "activity", text: ev.label }]);
      }
      else if (ev.t === "file") {
        setLines((l) => [...l, { kind: "activity", text: `Created ${ev.path.split("/").slice(-2).join("/")}` }]);
        /*
         * The moment the application is real, go and stand in it.
         *
         * status.md is the file that makes a folder an application, so it is
         * the earliest honest point to hand over. Everything after it, the
         * research, the CV, the PDF, then happens on the screen where those
         * things live, rather than scrolling past as log lines on a screen the
         * user is about to leave.
         */
        const m = /\/([^/]+)\/status\.md$/.exec(ev.path);
        if (m && !handedOff.current && opened.current) {
          handedOff.current = true;
          const slug = m[1]!;
          const company = slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
          // A beat, so the "created" line is seen before the screen changes.
          setTimeout(() => opened.current?.(slug, company), 900);
        }
      }
      else if (ev.t === "text") setLines((l) => [...l, { kind: "said", text: ev.text }]);
      else if (ev.t === "error") setLines((l) => [...l, { kind: "problem", text: ev.message }]);
      else if (ev.t === "result") {
        setRunning(false);
        setStartedAt(null);
        setDone(true);
        setCost((c) => c + ev.cost);
        created.current();
        /*
         * A run that produced nothing has to say so.
         *
         * One posting did not name the company, so the agent said "I don't have
         * a company name for this posting" and stopped. No folder, nothing on
         * the board, and the message landed on a screen that had already been
         * left. From the outside the application had simply vanished.
         *
         * handedOff is the honest test: it is set when a folder appears, so if
         * it is still false the run finished having created nothing.
         */
        if (!handedOff.current) setFailed(true);
      }
    };
    return () => socket.close();
  }, []);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  const start = () => {
    const raw = input.trim();
    if (!raw || running || !ws.current) return;
    setRunning(true);
    setStartedAt(Date.now());
    setLines([]);
    setFailed(false);
    setDone(false);

    const prompt = looksLikeUrl(raw)
      ? `Use the boulot:new-job skill to start a new application from this link: ${raw}\n\n` +
        `If you cannot read the page, say so plainly and ask me to paste the description. Do not guess at its contents.`
      : `Use the boulot:new-job skill to start a new application. Here is the job description:\n\n${raw}`;

    ws.current.send(
      JSON.stringify({
        prompt,
        person: who,
        job: jobId.current,
        label: "Reading the job",
        model: MODELS.intake,
        company: guessCompany(input),
      }),
    );
  };

  // Two panes from the moment there is work to show, so arriving at the
  // workbench is the same screen continuing rather than a different one.
  const split = running || lines.length > 0 || done;

  return (
    <div className="bench">
      <header className="bench-top">
        <button className="back" onClick={onClose}>
          ← Board
        </button>
        <h2>New application</h2>
        {cost > 0 && <span className="fit fit-ok">£{(cost * 0.79).toFixed(2)}</span>}
      </header>

      {/*
        One pane, then two.

        This screen used to be a full-width card with the log stacked under it,
        and pressing Start on it led to a workbench laid out nothing like it, so
        the handover read as being thrown to a different part of the app. The
        geometry is the same now: the job on the left, the agent on the right,
        widening into place when the run begins. By the time the folder exists
        and the workbench takes over, the panes are already where they belong
        and only their contents change.
      */}
      <div className={split ? "bench-body newapp-body split" : "bench-body newapp-body"}>
        <section className="pane">
          <div className="tabs">
            <button className="on" type="button" disabled>
              Job description
            </button>
          </div>
          <label className="sr-only" htmlFor="jd">
            Paste a job link, or the whole description
          </label>
          <textarea
            id="jd"
            className="editor"
            value={input}
            readOnly={running}
            placeholder={"Paste a job link, or the whole description.\n\nhttps://jobs.example.com/senior-product-manager"}
            onChange={(e) => setInput(e.target.value)}
          />
          {!split && (
            <div className="newapp-actions">
              <span className="hint">
                {looksLikeUrl(input)
                  ? "Looks like a link. Many job boards block automated reading, so you may be asked to paste the text."
                  : input.trim()
                    ? `${input.trim().length} characters of description`
                    : "Boulot researches the company, sets up the folder, and tells you the fit before writing anything."}
              </span>
              <button onClick={start} disabled={running || !input.trim()}>
                Start
              </button>
            </div>
          )}
        </section>

        <section className="pane side">
          <div className="checklist">
            <div className="checklist-top">
              <h3>{running ? "Reading the job" : done ? "Done" : "Boulot"}</h3>
              <button
                className={running ? "play busy" : "play"}
                onClick={start}
                disabled={running || !input.trim()}
                title={running ? "Reading the job" : "Start"}
              >
                {running ? <span className="pip" /> : done ? "✓" : "▶"}
              </button>
            </div>
          </div>

          <div className="log" ref={log}>
            {failed && (
              <div className="didnt-start">
                <b>No application was created.</b>
                <p>
                  {lines.filter((l) => l.kind === "said").at(-1)?.text ??
                    "Boulot stopped before it made the folder."}
                </p>
                <p className="fix">
                  Your text is still in the box on the left. Adding the company name near the top is
                  usually enough.
                </p>
              </div>
            )}

            {/*
              The stages, and nothing else.

              What used to be here was a collapsible list of every tool call and
              a running commentary: "No prior application on file. Let me set up
              the folder and research the company." That is the agent narrating
              itself, and it reads as a machine performing work rather than
              doing it. The rail says how far along this is, which is the only
              thing anyone is watching for, and the line underneath says what it
              is doing right now.
            */}
            {(running || lines.length > 0) && (
              <IntakeProgress
                labels={lines.filter((l) => l.kind === "activity").map((l) => l.text)}
                running={running}
              />
            )}

            {lines
              .filter((l) => l.kind === "problem")
              .map((l, i) => (
                <p className="problem" key={i}>
                  {l.text}
                </p>
              ))}

            {running && (
              <Thinking
                label={lines.filter((l) => l.kind === "activity").at(-1)?.text ?? "Reading the job"}
                since={startedAt}
              />
            )}
            {done && !failed && (
              <p className="done">
                <button className="linkish" onClick={onClose}>Back to the board</button> to open it.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
