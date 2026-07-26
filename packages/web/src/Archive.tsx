import { useEffect, useMemo, useState } from "react";

/**
 * The archive.
 *
 * Deliberately a plain list rather than a second board. Archived applications
 * are not work, they are evidence, and the only two things you ever do here are
 * find one again and put one back. Columns, flags and next actions would all be
 * lying about that.
 *
 * It is worth having a page at all rather than deleting: every number on the
 * Insights page divides by something that ended here.
 */

type App = {
  slug: string;
  company: string;
  role: string;
  stage: string;
  outcome: string | null;
  lastUpdated: string | null;
  appliedDate: string | null;
  bucket: string;
};

const LABEL: Record<string, string> = {
  offer_accepted: "Accepted",
  offer_declined: "Declined",
  withdrawn: "Withdrew",
  ghosted: "No reply",
  rejected: "Rejected",
  never_applied: "Never applied",
};

/**
 * How far it got, for the ones that never recorded how it ended.
 *
 * 21 of the 25 archived applications in the vault this was built against were
 * filed by dragging the folder, so their `stage:` still says "applied" or
 * "interview" and there is no outcome to show. Labelling all of them "Closed"
 * is true and tells you nothing.
 *
 * The stage they reached is real data and is the thing you would actually want:
 * an application that died after a screen is a different lesson from one that
 * died on submission. Inventing an outcome instead would put fiction into the
 * funnel, which is the one place in this app that has to stay honest.
 */
const REACHED: Record<string, string> = {
  lead: "Never applied",
  drafting: "Never sent",
  applied: "Applied",
  screening: "Screened",
  interviewing: "Interviewed",
  offer: "Offered",
};

const describe = (a: App): string =>
  LABEL[a.outcome ?? ""] ?? REACHED[a.stage] ?? "Closed";

export function Archive({
  who,
  onClose,
  embedded,
  onChanged,
}: {
  who: string;
  onClose?: () => void;
  /** Rendered inside Settings, which supplies its own header. */
  embedded?: boolean;
  onChanged: () => void;
}) {
  const [apps, setApps] = useState<App[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    fetch(`/api/${who}/board`)
      .then((r) => r.json())
      .then((b) => setApps((b.applications as App[]).filter((a) => a.bucket === "archive")))
      .catch(() => setApps([]));

  useEffect(() => {
    void load();
  }, [who]);

  const restore = async (slug: string) => {
    setBusy(slug);
    await fetch(`/api/${who}/job/${slug}/restore`, { method: "POST" });
    setBusy(null);
    await load();
    onChanged();
  };

  // Newest first. An archive sorted alphabetically is a filing cabinet; sorted
  // by date it is a history, and the recent end is the one you come back to.
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (apps ?? [])
      .filter((a) => !needle || `${a.company} ${a.role}`.toLowerCase().includes(needle))
      .sort((a, b) => (b.lastUpdated ?? b.appliedDate ?? "").localeCompare(a.lastUpdated ?? a.appliedDate ?? ""));
  }, [apps, q]);

  if (!apps) return <main className="empty">Reading your archive…</main>;

  const counts = new Map<string, number>();
  for (const a of apps) counts.set(describe(a), (counts.get(describe(a)) ?? 0) + 1);

  // Worth saying once, not on every row. Filing through the app records the
  // outcome, so this number only goes down.
  const unrecorded = apps.filter((a) => !a.outcome).length;

  return (
    <div className="archive">
      {!embedded && <header className="bench-top">
        <button className="back" onClick={onClose}>
          ← Board
        </button>
        <h2>Archive</h2>
        <span className="updated">{apps.length} filed</span>
      </header>}

      {apps.length === 0 ? (
        <p className="empty-note">
          Nothing filed yet. Applications land here when they end, and the numbers on Insights are
          built from them.
        </p>
      ) : (
        <>
          <div className="arch-summary">
            {[...counts.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => (
                <span key={k}>
                  <b>{n}</b> {k.toLowerCase()}
                </span>
              ))}
          </div>

          {unrecorded > 0 && (
            <p className="empty-note">
              {unrecorded} of these were filed by hand and never recorded how they ended, so they
              show the stage they reached instead. Archiving from the board asks for the outcome.
            </p>
          )}

          <input
            className="arch-search"
            placeholder="Find a company"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <ul className="arch-list">
            {shown.map((a) => (
              <li key={a.slug}>
                <div>
                  <strong>{a.company}</strong>
                  {a.role && <span className="role">{a.role}</span>}
                </div>
                <span className={a.outcome ? "arch-outcome" : "arch-outcome arch-inferred"}>{describe(a)}</span>
                <span className="arch-date">{a.lastUpdated ?? a.appliedDate ?? ""}</span>
                <button className="ghost" disabled={busy === a.slug} onClick={() => restore(a.slug)}>
                  {busy === a.slug ? "…" : "Restore"}
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="none">Nothing matches “{q}”.</li>}
          </ul>
        </>
      )}
    </div>
  );
}
