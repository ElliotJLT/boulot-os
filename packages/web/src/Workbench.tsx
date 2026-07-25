import { useEffect, useRef, useState } from "react";

/**
 * The application workbench: CV on the left, agent on the right.
 *
 * The CV is directly editable because regenerating a whole document to change
 * one word is the wrong loop. Small fixes are faster by hand; the agent is for
 * the parts that need judgment.
 */

type Fit = {
  fits: boolean;
  pages: number;
  maxPages: number;
  overflowMm: number;
  trimTarget: { section: string; charactersToCut: number; charsPerMm: number } | null;
  sections: Array<{ title: string; heightMm: number; pastBudget: boolean; crossesBudget: boolean }>;
};

type Event =
  | { t: "text"; text: string }
  | { t: "tool"; name: string; label: string }
  | { t: "file"; path: string }
  | { t: "result"; cost: number; error: boolean }
  | { t: "error"; message: string };

type Turn = { role: "you" | "boulot"; text: string } | { role: "activity"; label: string };

export function Workbench({
  who,
  slug,
  company,
  onClose,
}: {
  who: string;
  slug: string;
  company: string;
  onClose: () => void;
}) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [fit, setFit] = useState<Fit | null>(null);
  const [rendering, setRendering] = useState(false);
  const [pdfKey, setPdfKey] = useState(0);
  const [tab, setTab] = useState<"edit" | "pdf">("edit");

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [cost, setCost] = useState(0);
  const ws = useRef<WebSocket | null>(null);
  const log = useRef<HTMLDivElement>(null);
  // `dirty` must not be in the socket effect's deps: typing in the editor would
  // otherwise close the socket underneath a running agent.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    fetch(`/api/${who}/job/${slug}/cv`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setMarkdown(d.markdown);
        setFit(d.fit);
      })
      .catch(() => setMarkdown(""));
  }, [who, slug]);

  useEffect(() => {
    const socket = new WebSocket(`ws://${location.host}/ws`);
    ws.current = socket;
    socket.onmessage = (e) => {
      const ev: Event = JSON.parse(e.data);
      setTurns((t) => {
        if (ev.t === "text") return [...t, { role: "boulot", text: ev.text }];
        if (ev.t === "tool") return [...t, { role: "activity", label: ev.label }];
        if (ev.t === "file") return [...t, { role: "activity", label: `Saved ${ev.path.split("/").pop()}` }];
        if (ev.t === "error") return [...t, { role: "boulot", text: `Something went wrong: ${ev.message}` }];
        return t;
      });
      if (ev.t === "result") {
        setBusy(false);
        setCost((c) => c + ev.cost);
        // The agent may have rewritten the CV underneath us.
        fetch(`/api/${who}/job/${slug}/cv`)
          .then((r) => r.json())
          .then((d) => {
            if (!dirtyRef.current) setMarkdown(d.markdown);
            setFit(d.fit);
          })
          .catch(() => {});
      }
    };
    return () => socket.close();
  }, [who, slug]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const save = async () => {
    await fetch(`/api/${who}/job/${slug}/cv`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ markdown }),
    });
    setDirty(false);
  };

  const render = async () => {
    setRendering(true);
    if (dirty) await save();
    const r = await fetch(`/api/${who}/job/${slug}/pdf`, { method: "POST" }).then((x) => x.json());
    setFit(r.fit);
    setPdfKey((k) => k + 1);
    setRendering(false);
    if (r.pdf) setTab("pdf");
    if (r.badHeader) {
      setTurns((t) => [
        ...t,
        { role: "boulot", text: "That CV has no contact line, so I have not rendered it. The line under your name needs to be wrapped in **double asterisks**, otherwise the parser reads your contact details as the headline and drops both." },
      ]);
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text || busy || !ws.current) return;
    setTurns((t) => [...t, { role: "you", text }]);
    setInput("");
    setBusy(true);
    ws.current.send(JSON.stringify({ prompt: text, person: who }));
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
              {fit.fits ? `${fit.pages} page${fit.pages === 1 ? "" : "s"}` : `${fit.pages} pages, ${fit.overflowMm}mm over`}
            </span>
          )}
          {dirty && (
            <button className="ghost" onClick={save}>
              Save
            </button>
          )}
          <button onClick={render} disabled={rendering}>
            {rendering ? "Rendering…" : "Render PDF"}
          </button>
          <a className="ghost" href={`/api/${who}/job/${slug}/file/cv.pdf`} download={`${company} CV.pdf`}>
            Download
          </a>
        </div>
      </header>

      <div className="bench-body">
        <section className="pane">
          <div className="tabs">
            <button className={tab === "edit" ? "on" : ""} onClick={() => setTab("edit")}>
              Edit
            </button>
            <button className={tab === "pdf" ? "on" : ""} onClick={() => setTab("pdf")}>
              PDF
            </button>
          </div>

          {tab === "edit" ? (
            markdown === null ? (
              <p className="hint">Loading…</p>
            ) : (
              <textarea
                className="editor"
                value={markdown}
                spellCheck={false}
                onChange={(e) => {
                  setMarkdown(e.target.value);
                  setDirty(true);
                }}
              />
            )
          ) : (
            <iframe className="pdf" key={pdfKey} title="CV" src={`/api/${who}/job/${slug}/file/cv.pdf?v=${pdfKey}`} />
          )}

          {fit && !fit.fits && fit.trimTarget && (
            <p className="fitline">
              Cut about <strong>{fit.trimTarget.charactersToCut}</strong> characters from{" "}
              <strong>{fit.trimTarget.section}</strong>, the heaviest section. What spills off the end is
              usually not what to cut.
            </p>
          )}
        </section>

        <section className="pane chat">
          <div className="log" ref={log}>
            {turns.length === 0 && (
              <p className="hint">
                Ask for a change: “tighten the Zero Gravity bullets”, “rewrite the summary for this role”,
                “what is this CV missing against the job description?”
              </p>
            )}
            {turns.map((t, i) =>
              t.role === "activity" ? (
                <p className="activity" key={i}>
                  {t.label}
                </p>
              ) : (
                <p className={t.role === "you" ? "you" : "boulot"} key={i}>
                  {t.text}
                </p>
              ),
            )}
            {busy && <p className="activity pulse">Thinking</p>}
          </div>
          <div className="composer">
            <textarea
              rows={2}
              value={input}
              placeholder="Ask Boulot to change the CV…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
            />
            <button onClick={send} disabled={busy || !input.trim()}>
              Send
            </button>
          </div>
          {cost > 0 && <p className="cost">£{(cost * 0.79).toFixed(2)} this session</p>}
        </section>
      </div>
    </div>
  );
}
