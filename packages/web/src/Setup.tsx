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
  const [step, setStep] = useState<"choose" | "existing" | "name" | "import">(
    health.needsSetup === "import" ? "import" : "choose",
  );
  const [path, setPath] = useState("");
  const [people, setPeople] = useState<string[] | null>(null);
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
      else if (ev.t === "error") {
        setBusy(false);
        /*
         * Agent failures here are almost always one thing: no Claude account
         * reachable on this machine. The raw SDK message says nothing a person
         * can act on, and this is the first ninety seconds of their experience.
         */
        const auth = /api key|authentic|unauthor|credit|401|403|not logged/i.test(ev.message);
        setError(
          auth
            ? "Boulot could not reach Claude. It needs either an ANTHROPIC_API_KEY set, or Claude Code signed in on this machine. You can skip this and write your record by hand instead."
            : ev.message,
        );
      }
      else if (ev.t === "result") {
        setBusy(false);
        doneRef.current(whoRef.current);
      }
    };
    return () => socket.close();
  }, []);

  /**
   * Point at a folder that already exists.
   *
   * The path that was missing entirely. Anyone with a vault already, which
   * includes every existing Boulot user, was being offered a fresh empty one
   * and no way to say otherwise short of an environment variable.
   */
  const useExisting = async (person?: string) => {
    const p = path.trim();
    if (!p || busy) return;
    setBusy(true);
    setError(null);
    const r = await fetch("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: p, person }),
    });
    const body = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(body.error ?? "Could not read that folder.");
    // More than one career in there. Ask once, then never again.
    if (body.needsPerson) return setPeople(body.needsPerson);
    onDone(body.person);
  };

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

  if (step === "choose") {
    return (
      <div className="setup">
        <h1>Boulot</h1>
        <p className="lede">
          Your career, in files you own. Everything stays on this computer.
        </p>
        <div className="choices">
          <button className="choice" onClick={() => setStep("existing")}>
            <b>I already have a Boulot folder</b>
            <span>Point at it and pick up where you left off.</span>
          </button>
          <button className="choice" onClick={() => setStep("name")}>
            <b>Start fresh</b>
            <span>Make one in <code>{health.vault}</code> and build it from your CV.</span>
          </button>
        </div>
      </div>
    );
  }

  if (step === "existing") {
    return (
      <div className="setup">
        <h1>Where is it?</h1>
        <p className="lede">
          The folder holding one directory per person, each with an <code>active</code> folder
          inside.
        </p>
        {people ? (
          <>
            <label>Found more than one. Which is yours?</label>
            <div className="choices">
              {people.map((w) => (
                <button key={w} className="choice" disabled={busy} onClick={() => void useExisting(w)}>
                  <b>{w}</b>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <label htmlFor="path">Path to the folder</label>
            <input
              id="path"
              autoFocus
              value={path}
              placeholder="~/Documents/Boulot"
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void useExisting()}
            />
            {error && <p className="setup-error">{error}</p>}
            <div className="setup-actions">
              <button className="primary" disabled={!path.trim() || busy} onClick={() => void useExisting()}>
                {busy ? "Looking…" : "Use this folder"}
              </button>
              <button className="linkish" onClick={() => { setError(null); setStep("choose"); }}>
                Back
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

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
