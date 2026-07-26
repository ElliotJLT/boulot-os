import { useState } from "react";
import { Details } from "./Details.js";

/**
 * The plumbing, and only the plumbing.
 *
 * This screen briefly held everything that was not an application: contact
 * details, billing, the vault path, and also the career record, the funnel and
 * the archive. The last three are not settings. They are the thing the whole
 * app exists to improve, and filing them behind a cog next to "where your files
 * are" said something about their importance that nobody meant to say.
 *
 * They have their own tab now. What is left here is what you touch twice and
 * then forget, which is what a settings screen should be.
 */

type Section = "details" | "account";

const SECTIONS: Array<{ key: Section; label: string; hint: string }> = [
  { key: "details", label: "Your details", hint: "Name, links, file names" },
  { key: "account", label: "Account", hint: "How Boulot is paid for" },
];

export function Settings({
  who,
  authMode,
  vault,
  onClose,
}: {
  who: string;
  authMode: string | null;
  vault: string;
  onClose: () => void;
}) {
  const [section, setSection] = useState<Section>("details");

  return (
    <div className="settings">
      <header className="bench-top">
        <button className="back" onClick={onClose} title="Back to the board" aria-label="Back to the board">
          ←
        </button>
        <h2>Settings</h2>
      </header>

      <div className="settings-body">
        <nav className="settings-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              className={section === s.key ? "on" : ""}
              onClick={() => setSection(s.key)}
            >
              <b>{s.label}</b>
              <span>{s.hint}</span>
            </button>
          ))}
        </nav>

        <section className="settings-pane">
          {section === "details" && <Details who={who} />}
          {section === "account" && (
            <div className="account">
              <h3>How Boulot is paid for</h3>
              <p>
                {authMode === "api-key"
                  ? "An Anthropic API key is set, so work is billed per token to that key and every run is capped."
                  : "No API key is set, so Boulot uses the Claude subscription signed in on this machine. Usage counts against that plan's limits rather than costing anything per run."}
              </p>
              <h3>Where your files are</h3>
              <p>
                <code>{vault}</code>
              </p>
              <p className="note">
                Plain markdown, on this computer. Nothing is uploaded anywhere. Open the folder and
                everything Boulot knows is readable without it.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
