import { useEffect, useRef, useState } from "react";

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
}: {
  who: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [cost, setCost] = useState(0);
  const ws = useRef<WebSocket | null>(null);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const socket = new WebSocket(`ws://${location.host}/ws`);
    ws.current = socket;
    socket.onmessage = (e) => {
      const ev: Event = JSON.parse(e.data);
      if (ev.t === "tool") setLines((l) => [...l, { kind: "activity", text: ev.label }]);
      else if (ev.t === "file")
        setLines((l) => [...l, { kind: "activity", text: `Created ${ev.path.split("/").slice(-2).join("/")}` }]);
      else if (ev.t === "text") setLines((l) => [...l, { kind: "said", text: ev.text }]);
      else if (ev.t === "error") setLines((l) => [...l, { kind: "problem", text: ev.message }]);
      else if (ev.t === "result") {
        setRunning(false);
        setDone(true);
        setCost((c) => c + ev.cost);
        onCreated();
      }
    };
    return () => socket.close();
  }, [onCreated]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  const start = () => {
    const raw = input.trim();
    if (!raw || running || !ws.current) return;
    setRunning(true);
    setLines([]);
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
            {lines.map((l, i) =>
              l.kind === "activity" ? (
                <p className="activity" key={i}>
                  {l.text}
                </p>
              ) : (
                <p className={l.kind === "problem" ? "problem" : "boulot"} key={i}>
                  {l.text}
                </p>
              ),
            )}
            {running && <p className="activity pulse">Thinking</p>}
            {done && (
              <p className="done">
                Done. <button className="linkish" onClick={onClose}>Back to the board</button> to open it.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
