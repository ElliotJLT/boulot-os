import { useState } from "react";
import { Career } from "./Career.js";
import { Insights } from "./Insights.js";
import { Archive } from "./Archive.js";

/**
 * Everything that is not an application.
 *
 * The board's nav had grown to four items that had nothing to do with each
 * other: what plan you are on, a funnel, a list of finished applications, and
 * your career record. None of them is a thing you do while applying for a job,
 * and all four sat permanently across the top of the page you use to apply for
 * jobs.
 *
 * They live here instead, in the shape every settings screen has had for twenty
 * years: a list on the left, a pane on the right. There is nothing to learn,
 * which is the point.
 */

type Section = "profile" | "insights" | "archive" | "account";

const SECTIONS: Array<{ key: Section; label: string; hint: string }> = [
  { key: "profile", label: "Profile", hint: "Everything you have done" },
  { key: "insights", label: "Insights", hint: "What the search is doing" },
  { key: "archive", label: "Archive", hint: "Applications that ended" },
  { key: "account", label: "Account", hint: "How Boulot is paid for" },
];

export function Settings({
  who,
  authMode,
  vault,
  archived,
  onClose,
  onChanged,
}: {
  who: string;
  authMode: string | null;
  vault: string;
  archived: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [section, setSection] = useState<Section>("profile");

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
              <span>{s.key === "archive" && archived ? `${archived} filed` : s.hint}</span>
            </button>
          ))}
        </nav>

        <section className="settings-pane">
          {/*
            The existing screens, unchanged, minus their own back buttons. They
            were built as full pages and work as panes without alteration, which
            is the whole argument for not reinventing the layout.
          */}
          {section === "profile" && <Career who={who} embedded />}
          {section === "insights" && <Insights who={who} embedded />}
          {section === "archive" && <Archive who={who} embedded onChanged={onChanged} />}
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
