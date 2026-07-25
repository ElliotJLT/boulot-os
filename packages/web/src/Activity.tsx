import type { ReactNode } from "react";

/**
 * Rendering what the agent is doing.
 *
 * The raw event stream is unreadable: seven consecutive "Searching your vault"
 * lines tell you nothing except that something is happening. Three things fix
 * it, and none of them are cosmetic:
 *
 *   1. consecutive identical actions collapse to one line with a count
 *   2. actions group into named phases, so there is a sense of progress
 *   3. the reply is rendered as markdown, because the model writes markdown
 */

export type Phase = "fetch" | "setup" | "research" | "review" | "write";

const PHASES: Array<{ key: Phase; label: string }> = [
  { key: "fetch", label: "Reading the job" },
  { key: "setup", label: "Setting up" },
  { key: "research", label: "Researching" },
  { key: "review", label: "Checking your history" },
  { key: "write", label: "Writing" },
];

/** Map a tool label onto a phase. */
export function phaseOf(label: string): Phase {
  if (/job posting/i.test(label)) return "fetch";
  if (/Searching the web|Reading [a-z0-9.-]+\.[a-z]{2,}/i.test(label)) return "research";
  if (/^(Writing|Saved|Created|Editing)/i.test(label)) return "write";
  // Reading vault files is checking history, not setup: status.md, cv-master,
  // a previous application's job.md.
  if (/date|Searching your vault|Reading .*(status|cv-master|job|research|prep)\.md/i.test(label))
    return "review";
  return "setup";
}

export function Phases({ active, seen }: { active: boolean; seen: Set<Phase> }) {
  const order = PHASES.filter((p) => seen.has(p.key));
  if (!order.length) return null;
  const lastKey = order.at(-1)?.key;
  return (
    <div className="phases">
      {order.map((p) => {
        const isCurrent = active && p.key === lastKey;
        return (
          <span key={p.key} className={`pill ${isCurrent ? "pill-live" : "pill-done"}`}>
            {isCurrent ? <span className="dot" /> : <span className="tick">✓</span>}
            {p.label}
          </span>
        );
      })}
    </div>
  );
}

/** Consecutive identical labels become one row with a count. */
export function collapse(labels: string[]): Array<{ text: string; count: number }> {
  const out: Array<{ text: string; count: number }> = [];
  for (const text of labels) {
    const last = out.at(-1);
    if (last && last.text === text) last.count += 1;
    else out.push({ text, count: 1 });
  }
  return out;
}

/**
 * Minimal markdown renderer.
 *
 * Deliberately not a dependency, and deliberately not dangerouslySetInnerHTML:
 * this text comes from a model that has just read an untrusted web page, so it
 * is rendered as React elements and can never become markup.
 */
export function Markdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split("\n");

        // Tables. The JD mapping table is the most important thing tailor-cv
        // produces, and without this it renders as an unreadable run of pipes.
        // Handled before lists because a table row also starts with a symbol.
        if (lines.length >= 2 && lines[0]?.includes("|") && /^[\s|:-]+$/.test(lines[1] ?? "")) {
          const cells = (row: string) =>
            row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
          const head = cells(lines[0] ?? "");
          const body = lines.slice(2).filter((l) => l.includes("|")).map(cells);
          return (
            <table key={bi} className="md-table">
              <thead>
                <tr>{head.map((h, i) => <th key={i}>{inline(h)}</th>)}</tr>
              </thead>
              <tbody>
                {body.map((row, ri) => (
                  <tr key={ri}>
                    {head.map((_, ci) => <td key={ci}>{inline(row[ci] ?? "")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }

        const isList = lines.every((l) => /^\s*[-*]\s+/.test(l));
        if (isList) {
          return (
            <ul key={bi}>
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*[-*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        const heading = /^(#{2,4})\s+(.*)$/.exec(block);
        if (heading) return <h4 key={bi}>{inline(heading[2] ?? "")}</h4>;
        return <p key={bi}>{inline(block)}</p>;
      })}
    </>
  );
}

/** **bold**, *italic* and `code`, as elements. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    else out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
