import { useState } from "react";
import { Career } from "./Career.js";
import { Archive } from "./Archive.js";

/**
 * You, and what your search has done.
 *
 * These three sat inside Settings, next to which API key is set and where the
 * vault lives, and they are not that kind of thing. Settings is plumbing you
 * touch twice; this is the record you are actually trying to improve, and
 * burying it two clicks deep behind a cog was a statement about its importance
 * that nobody meant to make.
 *
 * Same shape as Settings on purpose. A list on the left and a pane on the
 * right is not an idea, which is what makes it the right one here.
 */

/*
 * Two sections, not three.
 *
 * Insights was a page of its own holding a funnel nobody clicked through to
 * see. It is the denominator for everything on the profile — a headline that
 * reached one interview means something different at a 3% reply rate than at
 * 30% — so it sits at the top of that page instead, and the door to it is gone.
 */
type Section = "profile" | "archive";

const SECTIONS: Array<{ key: Section; label: string; hint: string }> = [
  { key: "profile", label: "Profile", hint: "What you have done, and what it earned" },
  { key: "archive", label: "Archive", hint: "Applications that ended" },
];

export function Profile({
  who,
  archived,
  onClose,
  onChanged,
}: {
  who: string;
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
        <h2>Profile</h2>
      </header>

      <div className="settings-body">
        <nav className="settings-nav">
          {SECTIONS.map((s) => (
            <button key={s.key} className={section === s.key ? "on" : ""} onClick={() => setSection(s.key)}>
              <b>{s.label}</b>
              <span>{s.key === "archive" && archived ? `${archived} filed` : s.hint}</span>
            </button>
          ))}
        </nav>

        <section className="settings-pane">
          {section === "profile" && <Career who={who} embedded />}
          {section === "archive" && <Archive who={who} embedded onChanged={onChanged} />}
        </section>
      </div>
    </div>
  );
}
