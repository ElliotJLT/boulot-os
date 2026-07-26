import { figures, similarity, SAME_CLAIM } from "../learning/similarity.js";
import type { Master } from "../vault/master.js";
import type { CvLine } from "../learning/similarity.js";

/**
 * Consolidation. Boulot's version of dreaming.
 *
 * Anthropic's autoDream runs a four-phase pass over an agent's memory files
 * between sessions: orient, gather signal, consolidate, prune and index. It
 * merges overlapping entries, deletes contradicted facts, converts relative
 * dates to absolute, and rebuilds a lean index that points at topic files. The
 * same shape fits here almost exactly, because a vault of archived applications
 * is the same kind of input as a directory of session transcripts: a pile of
 * finished work nobody will ever read again, containing everything worth
 * knowing about the person who produced it.
 *
 * Two deliberate departures.
 *
 * The first is that this needs no model. Every phase below is string work, so
 * consolidation runs on a machine with no API credit at all. That is not a
 * limitation being worked around; for this corpus it is the honest
 * implementation, because the useful operations are all merge, count and
 * compare.
 *
 * The second is the safety rule, and it is the important one. Dreaming
 * consolidates an agent's memory of a user. This consolidates a person's record
 * of themselves, and that record becomes claims made to employers. A wrong fact
 * in an agent's memory is annoying; a wrong fact here is a fabrication with the
 * user's name on it. So this may only ever reconcile between sentences the user
 * actually wrote and sent. It merges, dates, counts and retires. It never
 * synthesises a claim, and where the record is ambiguous it asks rather than
 * deciding.
 */

/** Lines in the index before detail gets demoted to a topic file. */
export const INDEX_LINE_CAP = 200;

/**
 * How many of the most recent applications a claim must be absent from before
 * it counts as dropped. Three is enough to look deliberate rather than a
 * consequence of three unusually narrow job descriptions in a row.
 */
export const DROPPED_AFTER = 3;

/**
 * How often a claim must have been used before dropping it means anything.
 *
 * A line used twice and then not again is ordinary variation in tailoring. A
 * line used eight times and then never again is a decision. Without this floor
 * the list fills with the former and the latter cannot be seen.
 */
export const DROPPED_MIN_USES = 4;

export interface Claim {
  /** The fullest phrasing seen, which is the one that survived most tailoring. */
  text: string;
  /** Applications that used it, oldest first. */
  seenIn: string[];
  figures: string[];
  section: string;
  /** True when the master record already holds a version of this. */
  inMaster: boolean;
  /** Set when the master's version carries fewer figures than the sent one. */
  masterIsStale: { id: string; missing: string[] } | null;
}

export interface Question {
  kind: "relative-date" | "dropped" | "unused";
  detail: string;
  /** Why it matters, in one sentence. Never an instruction to change anything. */
  because: string;
}

export interface Consolidation {
  /** Path-relative filename to contents. Written as a set. */
  files: Record<string, string>;
  summary: {
    claims: number;
    withFigures: number;
    projects: number;
    questions: number;
    applications: number;
    /** Human sentence describing what this run changed. */
    changed: string;
  };
}

const PROJECT_SECTION = /^projects$/i;

/** Phase 2. Group every sent bullet into one claim per thing said. */
export function gather(lines: CvLine[]): Claim[] {
  const groups: Array<{ rep: CvLine; slugs: string[] }> = [];

  for (const line of lines) {
    const g = groups.find((x) => similarity(x.rep.text, line.text) >= SAME_CLAIM);
    if (g) {
      if (!g.slugs.includes(line.slug)) g.slugs.push(line.slug);
      if (line.text.length > g.rep.text.length) g.rep = line;
    } else {
      groups.push({ rep: line, slugs: [line.slug] });
    }
  }

  return groups.map((g) => ({
    text: g.rep.text,
    seenIn: g.slugs,
    figures: [...figures(g.rep.text)],
    section: g.rep.section,
    inMaster: false,
    masterIsStale: null,
  }));
}

/**
 * Phase 3. Reconcile the claims against the master record.
 *
 * Marks what the master already holds, and where the sent version carries a
 * figure the kept version lacks. Nothing is rewritten here: this is the pass
 * that decides what is true, not the pass that formats it.
 */
export function reconcile(claims: Claim[], master: Master): Claim[] {
  const entries = master.roles.flatMap((r) => r.bullets);

  for (const c of claims) {
    let best: { id: string; text: string; score: number } | null = null;
    for (const e of entries) {
      const score = similarity(e.text, c.text);
      if (score >= SAME_CLAIM && (!best || score > best.score)) {
        best = { id: e.id, text: e.text, score };
      }
    }
    if (!best) continue;

    c.inMaster = true;
    const have = figures(best.text);
    const missing = c.figures.filter((f) => !have.has(f));
    if (missing.length) c.masterIsStale = { id: best.id, missing };
  }

  return claims;
}

/**
 * Phase 3, second half: what the record cannot settle on its own.
 *
 * Every item here is phrased as a question. Dreaming deletes contradicted facts
 * outright, which is right when the memory is the agent's own. It is wrong here:
 * code can see that a role says "Present", and cannot know whether the job
 * ended. Asserting either way would be inventing biography.
 */
export function questions(
  claims: Claim[],
  master: Master,
  order: string[],
): Question[] {
  const out: Question[] = [];

  // Relative dates. Phase 3 of dreaming converts these to absolute; here it can
  // only point at them, because the absolute value is a fact about the user's
  // life rather than about the file.
  for (const r of master.roles) {
    if (/present|current|ongoing|now\b/i.test(r.dates)) {
      out.push({
        kind: "relative-date",
        detail: `${r.org} is dated "${r.dates}"`,
        because: "A relative date goes out on every CV and silently becomes wrong the day it ends.",
      });
    }
  }

  /*
   * Claims you have stopped making.
   *
   * A line that ran through your early applications and is absent from the last
   * several is one you dropped on purpose, and it is exactly what dreaming
   * calls a stale memory. Derived purely from your own sending history, so it
   * carries no opinion about whether employers liked it.
   */
  const recent = order.slice(-DROPPED_AFTER);
  if (recent.length === DROPPED_AFTER) {
    const dropped = claims
      .filter((c) => c.seenIn.length >= DROPPED_MIN_USES)
      .filter((c) => !recent.some((slug) => c.seenIn.includes(slug)))
      .sort((a, b) => b.seenIn.length - a.seenIn.length);
    for (const c of dropped) {
      out.push({
        kind: "dropped",
        detail: c.text.length > 90 ? `${c.text.slice(0, 90)}…` : c.text,
        because: `Used ${c.seenIn.length} times, then not in your last ${DROPPED_AFTER} applications.`,
      });
    }
  }

  // Master entries tailoring has never once selected.
  const never = master.roles.flatMap((r) => r.bullets).filter((b) => !b.usedIn.length);
  if (never.length) {
    out.push({
      kind: "unused",
      detail: `${never.length} master entries have never been selected`,
      because: "Either they are written in language no job description asks for, or they are not relevant any more.",
    });
  }

  // Relative dates first: a wrong date goes out on every CV, which no dropped
  // phrasing does.
  const rank = { "relative-date": 0, unused: 1, dropped: 2 } as const;
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

const bullet = (c: Claim) => `- ${c.text}`;

/** Phase 4. Render the lean index and demote the detail to topic files. */
export function index(
  claims: Claim[],
  qs: Question[],
  meta: { person: string; applications: number; generated: string },
): Consolidation {
  const projects = claims.filter((c) => PROJECT_SECTION.test(c.section));
  const evidence = claims
    .filter((c) => !PROJECT_SECTION.test(c.section))
    .sort((a, b) => b.seenIn.length - a.seenIn.length || b.figures.length - a.figures.length);

  const withFigures = claims.filter((c) => c.figures.length > 0).length;
  const stale = claims.filter((c) => c.masterIsStale);

  /*
   * The index is what the agent reads before writing anything, so it holds the
   * claims you reach for most and points at the rest. Capped for the same
   * reason dreaming caps MEMORY.md: an index that grows without limit stops
   * being an index and becomes the thing it was supposed to summarise.
   */
  const head = [
    `# ${meta.person} — career memory`,
    "",
    `Rebuilt by Boulot on ${meta.generated} from ${meta.applications} applications.`,
    "Generated file. Edit `cv-master.md` instead; this is overwritten on every consolidation.",
    "",
    "## Strongest evidence",
    "",
    "Ordered by how often it has actually been used. Full set in `evidence.md`.",
    "",
  ];

  const body: string[] = [];
  for (const c of evidence) {
    if (head.length + body.length > INDEX_LINE_CAP - 30) break;
    const figs = c.figures.length ? ` _(${c.figures.join(", ")})_` : "";
    body.push(`- ${c.text}${figs} — used ${c.seenIn.length}×`);
  }

  const tail: string[] = ["", "## Projects", ""];
  if (projects.length) {
    for (const p of projects) tail.push(`- ${p.text} — used ${p.seenIn.length}×`);
  } else {
    tail.push("_None found in the CVs you have sent._");
  }

  if (qs.length) {
    tail.push("", "## Worth checking", "");
    tail.push("Things the record cannot settle on its own. Never assume the answer.", "");
    for (const q of qs.slice(0, 8)) tail.push(`- **${q.detail}** — ${q.because}`);
    if (qs.length > 8) tail.push(`- _(${qs.length - 8} more in \`questions.md\`)_`);
  }

  tail.push(
    "",
    "## Files",
    "",
    `- \`evidence.md\` — ${evidence.length} claims, ${withFigures} carrying a figure`,
    `- \`projects.md\` — ${projects.length}`,
    `- \`questions.md\` — ${qs.length}`,
  );

  const files: Record<string, string> = {
    "MEMORY.md": [...head, ...body, ...tail].join("\n") + "\n",
    "evidence.md": [
      `# Evidence`,
      "",
      "Every claim you have sent more than once, with the phrasing that survived.",
      "",
      ...evidence.flatMap((c) => [
        bullet(c),
        `  - used in: ${c.seenIn.join(", ")}`,
        ...(c.figures.length ? [`  - figures: ${c.figures.join(", ")}`] : []),
        ...(c.masterIsStale
          ? [`  - master entry \`${c.masterIsStale.id}\` is missing: ${c.masterIsStale.missing.join(", ")}`]
          : []),
        ...(c.inMaster ? [] : ["  - not in cv-master.md"]),
        "",
      ]),
    ].join("\n"),
    "projects.md": [
      `# Projects`,
      "",
      ...(projects.length
        ? projects.flatMap((p) => [bullet(p), `  - used in: ${p.seenIn.join(", ")}`, ""])
        : ["_None found._", ""]),
    ].join("\n"),
    "questions.md": [
      `# Worth checking`,
      "",
      "Derived from the record, unanswerable by it. Boulot never guesses these.",
      "",
      ...qs.flatMap((q) => [`- **${q.detail}**`, `  - ${q.because}`, ""]),
    ].join("\n"),
  };

  return {
    files,
    summary: {
      claims: claims.length,
      withFigures,
      projects: projects.length,
      questions: qs.length,
      applications: meta.applications,
      changed: [
        `${claims.length} claims`,
        stale.length ? `${stale.length} fresher than the master record` : null,
        qs.length ? `${qs.length} worth checking` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
  };
}

/** All four phases. `order` is application slugs oldest first. */
export function consolidate(
  master: Master,
  lines: CvLine[],
  order: string[],
  meta: { person: string; generated: string },
): Consolidation {
  const claims = reconcile(gather(lines), master).filter((c) => c.seenIn.length >= 2);
  return index(claims, questions(claims, master, order), {
    ...meta,
    applications: new Set(lines.map((l) => l.slug)).size,
  });
}
