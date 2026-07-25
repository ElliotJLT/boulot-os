import { useEffect, useRef, useState } from "react";
import { collapse } from "./Activity.js";

/**
 * First run.
 *
 * This screen exists because the app used to render "No vault at
 * /Users/you/Boulot" and stop. Everyone arrives without a vault exactly once,
 * so that was simultaneously the most travelled path in the product and the
 * only one with no way forward.
 *
 * The shape is two steps and no forms. Nobody will hand-write a tagged
 * experience bank before they have seen the app do anything, and asking them to
 * is where people quit. Everyone already has a CV, so the first artefact is
 * built from a document they paste, and the most valuable thing this system
 * does happens in the first ninety seconds instead of being invisible.
 */

type Health = { vault: string; needsSetup: string | null; firstPerson: string | null };

export function Setup({ health, onDone }: { health: Health; onDone: (who: string) => void }) {
  const [step, setStep] = useState<"name" | "import">(
    health.needsSetup === "import" ? "import" : "name",
  );
  const [name, setName] = useState("");
  const [who, setWho] = useState(health.firstPerson ?? "");
  const [cv, setCv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<string[]>([]);

  const ws = useRef<WebSocket | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const whoRef = useRef(who);
  whoRef.current = who;

  useEffect(() => {
    const socket = new WebSocket(`ws://${location.host}/ws`);
    ws.current = socket;
    socket.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.t === "tool") setActivity((a) => [...a, ev.label]);
      else if (ev.t === "file") setActivity((a) => [...a, `Wrote ${ev.path.split("/").pop()}`]);
      else if (ev.t === "error") setError(ev.message);
      else if (ev.t === "result") {
        setBusy(false);
        doneRef.current(whoRef.current);
      }
    };
    return () => socket.close();
  }, []);

  const createVault = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    const r = await fetch("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    const body = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(body.error ?? "Could not create your folder.");
    setWho(body.person);
    setStep("import");
  };

  /**
   * Turn a pasted CV into the master record.
   *
   * The one place in onboarding worth spending a model call on, because the
   * output is the thing every later feature reads. Explicitly bounded to
   * extraction: a CV import that quietly improves your achievements has
   * fabricated your career on the first screen.
   */
  const importCv = () => {
    if (!cv.trim() || busy || !ws.current) return;
    setBusy(true);
    setError(null);
    setActivity([]);
    ws.current.send(
      JSON.stringify({
        person: who,
        prompt:
          `Build the master experience record from the CV below.\n\n` +
          `Write it to cv-master.md, replacing the starter template, in that file's ` +
          `existing format: one "### Company — Job title" heading per role, a bold ` +
          `dates line, then numbered entries each starting with a backtick-wrapped ` +
          `tag block like \`#ops #ai\`.\n\n` +
          `Rules, in order of importance:\n` +
          `1. Copy the substance of what is written. Do not improve, embellish, ` +
          `or add achievements, numbers or skills that are not in the text below. ` +
          `Rewording for consistency is fine; inventing is not.\n` +
          `2. Tag every entry so tailoring can select it later.\n` +
          `3. Keep every figure exactly as written.\n` +
          `4. Also fill in profile.md with the contact details you find.\n\n` +
          `Then say in one line how many roles and entries you found.\n\n` +
          `<cv>\n${cv.trim()}\n</cv>`,
      }),
    );
  };

  const skip = async () => {
    // A vault with only a template is still a working vault. Someone who wants
    // to type their own record should not be held on this screen.
    onDone(who);
  };

  if (step === "name") {
    return (
      <div className="setup">
        <h1>Boulot</h1>
        <p className="lede">
          Your career, in files you own. Everything stays on this computer, in{" "}
          <code>{health.vault}</code>.
        </p>
        <label htmlFor="who">What is your name?</label>
        <input
          id="who"
          autoFocus
          value={name}
          placeholder="Ada Lovelace"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void createVault()}
        />
        {error && <p className="setup-error">{error}</p>}
        <button className="primary" disabled={!name.trim() || busy} onClick={() => void createVault()}>
          {busy ? "Creating…" : "Create my folder"}
        </button>
      </div>
    );
  }

  return (
    <div className="setup">
      <h1>Paste your CV</h1>
      <p className="lede">
        Boulot reads it once and turns it into your record: every role, every achievement, tagged so
        it can pick the right ones per job. It copies what is there and never adds anything you did
        not write.
      </p>
      <textarea
        autoFocus
        value={cv}
        placeholder="Paste the text of your current CV here. Formatting does not matter."
        onChange={(e) => setCv(e.target.value)}
        rows={14}
      />
      {error && <p className="setup-error">{error}</p>}

      {busy ? (
        <div className="setup-activity">
          <span className="spin" />
          <div>
            {collapse(activity).slice(-4).map((a, i) => (
              <p key={i}>
                {a.text}
                {a.count > 1 && <em> ×{a.count}</em>}
              </p>
            ))}
            {activity.length === 0 && <p>Reading it…</p>}
          </div>
        </div>
      ) : (
        <div className="setup-actions">
          <button className="primary" disabled={!cv.trim()} onClick={importCv}>
            Build my record
          </button>
          <button className="linkish" onClick={() => void skip()}>
            I will write it myself
          </button>
        </div>
      )}
    </div>
  );
}
