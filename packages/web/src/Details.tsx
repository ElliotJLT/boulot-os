import { useEffect, useState } from "react";

/**
 * Your name, your links, and what a download is called.
 *
 * These already lived in profile.md, where they were correct and unreachable:
 * fixing a phone number meant opening a markdown file and knowing which line
 * mattered. They are also the highest-consequence fields in the vault, because
 * a CV with a stale email is a CV nobody can reply to, and unlike a weak bullet
 * nothing about it looks wrong.
 *
 * Saved the moment you stop typing, like everything else here.
 */

type Details = {
  name: string;
  headline: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  location: string;
  filename: string;
  minSalary: string;
  locationRules: string;
  avoid: string;
};

const FIELDS: Array<{ key: keyof Details; label: string; hint?: string; placeholder: string }> = [
  { key: "name", label: "Name", placeholder: "Ada Lovelace", hint: "Appears at the top of every CV" },
  {
    key: "headline",
    label: "Headline",
    placeholder: "Product Engineer | Full-stack, AI-native",
    hint: "The line under your name. Tailoring rewrites it per role",
  },
  { key: "email", label: "Email", placeholder: "you@example.com" },
  { key: "phone", label: "Phone", placeholder: "(+44) 7700 900123" },
  { key: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/in/you" },
  { key: "github", label: "GitHub", placeholder: "github.com/you" },
  { key: "location", label: "Location", placeholder: "London, UK" },
];

export function Details({ who }: { who: string }) {
  const [d, setD] = useState<Details | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/${who}/details`)
      .then((r) => r.json())
      .then(setD)
      .catch(() => setD(null));
  }, [who]);

  useEffect(() => {
    if (!dirty || !d) return;
    const t = setTimeout(() => {
      void fetch(`/api/${who}/details`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(d),
      })
        .then(() => {
          setDirty(false);
          setSaved(true);
          setTimeout(() => setSaved(false), 1600);
        })
        .catch(() => {});
    }, 700);
    return () => clearTimeout(t);
  }, [d, dirty, who]);

  if (!d) return <p className="empty-note">No profile yet.</p>;

  const set = (k: keyof Details, v: string) => {
    setD({ ...d, [k]: v });
    setDirty(true);
  };

  /* Shown live, because a filename pattern is unreadable until you see it filled in. */
  const preview = (d.filename || "{name} - {role} (CV)")
    .replace(/\{name\}/gi, d.name || "Your Name")
    .replace(/\{role\}/gi, "Product Engineer")
    .replace(/\{company\}/gi, "Lawhive")
    .replace(/[/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (
    <div className="details">
      <h3>
        Your details
        {dirty ? <span className="saving"> Saving…</span> : saved ? <span className="saving"> Saved</span> : null}
      </h3>
      <p className="lede">
        The block at the top of every CV. Written straight into <code>profile.md</code>, so the file
        stays readable without this screen.
      </p>

      <div className="detail-grid">
        {FIELDS.map((f) => (
          <label key={f.key}>
            <span>{f.label}</span>
            <input
              value={d[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => set(f.key, e.target.value)}
            />
            {f.hint && <em>{f.hint}</em>}
          </label>
        ))}
      </div>

      {/*
        What you will not take, written down before you are tempted.
        
        The expensive part of a bad application is not the tokens, it is the
        evening. Written here once, these are checked before the research pass
        rather than remembered after it.
        
        Free text rather than pickers, because "£90k, or £80k with real equity"
        is a real constraint that no number field can hold, and the thing
        reading it is a language model.
      */}
      <h3 className="second">Deal-breakers</h3>
      <p className="lede">
        Checked before any work starts on a new role. Anything that breaks one of these gets
        flagged rather than researched. Leave blank to skip.
      </p>
      <div className="detail-grid">
        <label>
          <span>Minimum salary</span>
          <input
            value={d.minSalary ?? ""}
            placeholder="£90,000, or £80,000 with real equity"
            onChange={(e) => set("minSalary", e.target.value)}
          />
          <em>In your words. It is read, not parsed.</em>
        </label>
        <label>
          <span>Location rules</span>
          <input
            value={d.locationRules ?? ""}
            placeholder="London or fully remote. No relocation, no 5 days in office"
            onChange={(e) => set("locationRules", e.target.value)}
          />
        </label>
        <label className="wide">
          <span>Will not apply to</span>
          <input
            value={d.avoid ?? ""}
            placeholder="Companies, sectors or role types you have already ruled out"
            onChange={(e) => set("avoid", e.target.value)}
          />
          <em>Named companies, whole sectors, or shapes of role. Whatever you would regret.</em>
        </label>
      </div>

      <h3 className="second">Downloaded file name</h3>
      <p className="lede">
        What the PDF is called when you save it. <code>{"{name}"}</code>, <code>{"{role}"}</code> and{" "}
        <code>{"{company}"}</code> are filled in per application.
      </p>
      <div className="detail-grid">
        <label className="wide">
          <span>Pattern</span>
          <input
            value={d.filename ?? ""}
            placeholder="{name} - {role} (CV)"
            onChange={(e) => set("filename", e.target.value)}
          />
          <em>
            Saves as <b>{preview}.pdf</b>
          </em>
        </label>
      </div>
    </div>
  );
}
