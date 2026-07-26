import { useEffect, useRef, useState } from "react";
import { Markdown, Phases, collapse, phaseOf, type Phase } from "./Activity.js";

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
}: {
  who: string;
  onClose: () => void;
  onCreated: () => void;
  /** Called once the folder exists, so the user can watch the rest happen in it. */
  onOpen?: (slug: string, company: string) => void;
}) {
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [cost, setCost] = useState(0);
  const [phases, setPhases] = useState<Set<Phase>>(new Set());
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

  useEffect(() => {
    const socket = new WebSocket(`ws://${location.host}/ws`);
    ws.current = socket;
    socket.onmessage = (e) => {
      const ev: Event = JSON.parse(e.data);
      if (ev.t === "tool") {
        setLines((l) => [...l, { kind: "activity", text: ev.label }]);
        setPhases((p) => new Set(p).add(phaseOf(ev.label)));
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
        setDone(true);
        setCost((c) => c + ev.cost);
        created.current();
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
    setLines([]);
    setPhases(new Set());
    setDone(false);

    const prompt = looksLikeUrl(raw)
      ? `Use the boulot:new-job skill to start a new application from this link: ${raw}\n\n` +
        `If you cannot read the page, say so plainly and ask me to paste the description. Do not guess at its contents.`
      : `Use the boulot:new-job skill to start a new application. Here is the job description:\n\n${raw}`;

    ws.current.send(JSON.stringify({ prompt, person: who }));
  };

  return (
    <div className="bench">
      <header className="bench-top">
        <button className="back" onClick={onClose}>
          ← Board
        </button>
        <h2>New application</h2>
        {cost > 0 && <span className="fit fit-ok">£{(cost * 0.79).toFixed(2)}</span>}
      </header>

      <div className="newapp">
        <label htmlFor="jd">Paste a job link, or the whole description</label>
        <textarea
          id="jd"
          value={input}
          disabled={running}
          placeholder={"https://jobs.example.com/senior-product-manager\n\nor paste the full job description here"}
          onChange={(e) => setInput(e.target.value)}
        />
        <div className="newapp-actions">
          <span className="hint">
            {looksLikeUrl(input)
              ? "Looks like a link. Many job boards block automated reading, so you may be asked to paste the text."
              : input.trim()
                ? `${input.trim().length} characters of description`
                : "Boulot researches the company, sets up the folder, and tells you the fit before writing anything."}
          </span>
          <button onClick={start} disabled={running || !input.trim()}>
            {running ? "Working…" : "Start"}
          </button>
        </div>

        {(lines.length > 0 || running) && (
          <div className="log newapp-log" ref={log}>
            <Phases active={running} seen={phases} />

            {(() => {
              const activity = collapse(lines.filter((l) => l.kind === "activity").map((l) => l.text));
              const said = lines.filter((l) => l.kind !== "activity");
              return (
                <>
                  <details className="steps" open={running}>
                    <summary>{activity.length} step{activity.length === 1 ? "" : "s"}</summary>
                    {activity.map((a, i) => (
                      <p className="activity" key={i}>
                        {a.text}
                        {a.count > 1 && <span className="times"> ×{a.count}</span>}
                      </p>
                    ))}
                  </details>

                  {said.map((l, i) =>
                    l.kind === "problem" ? (
                      <p className="problem" key={i}>{l.text}</p>
                    ) : (
                      <div className="answer" key={i}>
                        <Markdown text={l.text} />
                      </div>
                    ),
                  )}
                </>
              );
            })()}

            {running && <p className="activity pulse">Working</p>}
            {done && (
              <p className="done">
                <button className="linkish" onClick={onClose}>Back to the board</button> to open it.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
