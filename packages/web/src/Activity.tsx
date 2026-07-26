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
  /*
   * Line-driven rather than block-driven.
   *
   * The first version treated a blank-line-separated block as one thing, which
   * works for chat output and fails on real documents: a heading followed
   * directly by its paragraph is a single block, so the whole thing rendered as
   * prose with a literal "##" at the front. Research files are written that way
   * throughout, so almost none of their structure survived.
   *
   * Tables still need the block view, because a table is defined by its second
   * line, so they are matched first and everything else walks line by line.
   */
  const out: ReactNode[] = [];
  const lines = text.trim().split("\n");

  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    out.push(<p key={`p${out.length}`}>{inline(para.join(" "))}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    out.push(
      <ul key={`u${out.length}`}>
        {list.map((l, i) => (
          <li key={i}>{inline(l)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  const flush = () => {
    flushList();
    flushPara();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // A table: this line has pipes and the next is the separator row.
    if (line.includes("|") && /^[\s|:-]+$/.test(lines[i + 1] ?? "") && (lines[i + 1] ?? "").includes("|")) {
      flush();
      const cells = (row: string) =>
        row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const head = cells(line);
      const body: string[][] = [];
      let j = i + 2;
      for (; j < lines.length && (lines[j] ?? "").includes("|"); j++) body.push(cells(lines[j] ?? ""));
      out.push(
        <table key={`t${out.length}`} className="md-table">
          <thead>
            <tr>{head.map((h, k) => <th key={k}>{inline(h)}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri}>{head.map((_, ci) => <td key={ci}>{inline(row[ci] ?? "")}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
      i = j - 1;
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const depth = (heading[1] ?? "#").length;
      const body = inline(heading[2] ?? "");
      out.push(
        depth === 1 ? <h1 key={`h${out.length}`}>{body}</h1>
        : depth === 2 ? <h2 key={`h${out.length}`}>{body}</h2>
        : <h3 key={`h${out.length}`}>{body}</h3>,
      );
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      list.push(bullet[1] ?? "");
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flushPara();
      list.push(numbered[1] ?? "");
      continue;
    }

    flushList();
    para.push(line);
  }
  flush();

  return <>{out}</>;
}

/** **bold**, *italic* and `code`, as elements. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  /*
   * Links included, because research is mostly citations.
   *
   * Without them a research document reads as prose interrupted every other
   * sentence by a raw URL in brackets, which is the form least useful to both
   * a reader and a clicker. Matched before emphasis so a URL containing an
   * asterisk cannot be mistaken for italics.
   */
  const re = /(\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const href = link?.[2] ?? "";
      // Only http(s). A rendered document should never be a way to invoke
      // javascript: or file: from something an agent wrote.
      out.push(
        /^https?:\/\//i.test(href) ? (
          <a key={key++} href={href} target="_blank" rel="noreferrer noopener">
            {link?.[1]}
          </a>
        ) : (
          <span key={key++}>{link?.[1]}</span>
        ),
      );
    } else if (tok.startsWith("**")) out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    else out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}


/**
 * The stages of building an application, as opposed to its tool calls.
 *
 * A build reads the same three files a dozen times because three reviewers each
 * read them independently, which is correct and reads as flailing. The list of
 * calls is still there for anyone who wants it; this is the version that says
 * where the work has got to.
 */
export type BuildStage =
  | "loading"
  | "mapping"
  | "drafting"
  | "reviewing"
  | "editing"
  | "rendering";

export const BUILD_STAGES: Array<{ key: BuildStage; label: string }> = [
  { key: "loading", label: "Loading your record" },
  { key: "mapping", label: "Mapping the job description" },
  { key: "drafting", label: "Writing the draft" },
  { key: "reviewing", label: "Three reviewers reading it" },
  { key: "editing", label: "Applying their edits" },
  { key: "rendering", label: "Rendering the page" },
];

/** Which stage a tool label belongs to. Order matters: later wins. */
export function buildStageOf(label: string): BuildStage | null {
  if (/Rendering the PDF/i.test(label)) return "rendering";
  if (/^Updating/i.test(label)) return "editing";
  if (/is scoring|is finding|is looking for/i.test(label)) return "reviewing";
  if (/^(Writing|Saved|Created)/i.test(label)) return "drafting";
  if (/career record|Running a skill|research on/i.test(label)) return "loading";
  if (/job description/i.test(label)) return "mapping";
  return null;
}

/**
 * The furthest stage reached, and everything before it.
 *
 * Progress only moves forward. A reviewer re-reading the job description after
 * the draft exists should not drag the rail back to "mapping", because the work
 * has not gone backwards.
 */
export function stagesReached(labels: string[]): Set<BuildStage> {
  const order = BUILD_STAGES.map((s) => s.key);
  let furthest = -1;
  for (const l of labels) {
    const stage = buildStageOf(l);
    if (!stage) continue;
    furthest = Math.max(furthest, order.indexOf(stage));
  }
  return new Set(order.slice(0, furthest + 1));
}

export function BuildProgress({ labels, running }: { labels: string[]; running: boolean }) {
  const reached = stagesReached(labels);
  if (!reached.size) return null;
  const keys = BUILD_STAGES.map((s) => s.key);
  const current = keys.filter((k) => reached.has(k)).at(-1);

  return (
    <ol className="rail">
      {BUILD_STAGES.map((s) => {
        const done = reached.has(s.key) && s.key !== current;
        const live = running && s.key === current;
        const doneNow = reached.has(s.key) && !running;
        return (
          <li key={s.key} className={live ? "rail-live" : done || doneNow ? "rail-done" : "rail-todo"}>
            <span className="rail-mark">{live ? <span className="dot" /> : done || doneNow ? "✓" : ""}</span>
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}
