/**
 * What your tailored CVs know that your master record does not.
 *
 * Every application is a round of writing. You rephrase a bullet for a specific
 * job, sharpen a number, add the detail that JD asked for, send it, and archive
 * the folder. The master record learns nothing from any of it. After twenty-five
 * applications the master is both stale (the new work never came back) and
 * bloated (entries nothing has selected in months).
 *
 * This finds the difference, and it does it with string comparison rather than a
 * model. That matters for a tool people run on their own key: the detection is
 * free and works with no credit at all. A model is only worth paying for at the
 * point of rewriting an accepted proposal into master-record prose.
 *
 * Two things come back, and the second one was the surprise:
 *
 *   new       a line with no counterpart in the master at all
 *   enriched  a line that matches a master entry but carries figures it lacks
 *
 * "Enriched" is the more valuable of the two. The master says "3 engineers" and
 * "shipped to beta in 1 month"; the CV that actually went out says "5 engineers
 * + designer" and "App Store in 45 days". Nobody would call that a missing
 * bullet, but it is the record decaying in place, and it is detectable for free
 * by comparing the numbers.
 *
 * Deliberately absent: any claim about what works. With four interviews in the
 * corpus, a system that ranked phrasings by conversion would be generating
 * confident noise. Counts of your own writing are facts and compound at n=1;
 * conclusions about employers need a sample this will never have.
 */

/** Words that carry no distinguishing signal in a CV bullet. */
const STOP = new Set([
  "a", "an", "and", "the", "of", "to", "in", "on", "for", "with", "at", "by", "from", "as",
  "that", "this", "it", "its", "into", "via", "per", "was", "were", "is", "are", "be", "been",
  "i", "my", "we", "our", "you", "your", "then", "than", "so", "but", "or", "not", "no",
  "all", "any", "more", "most", "other", "across", "through", "over", "under", "up", "out",
  "new", "first", "own", "real", "full", "team", "work", "role", "including", "using", "used",
]);

/**
 * Content tokens.
 *
 * Markdown, punctuation and stopwords go. Everything else is lowercased and
 * kept whole: "iso" and "27001" are both distinctive, and splitting them apart
 * loses less than trying to be clever about which is which.
 */
export function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[`*_]/g, "")
      .replace(/[^a-z0-9%£$.+-]+/g, " ")
      .split(/\s+/)
      .map((t) => t.replace(/^[.+-]+|[.+-]+$/g, ""))
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

/**
 * The figures in a line.
 *
 * Numbers are the most distinctive thing a CV bullet contains and the thing
 * most likely to have moved since the master was written. Percentages, money,
 * counts and standards numbers all qualify; bare years do not, because a date
 * changing is not the record improving.
 */
export function figures(text: string): Set<string> {
  const out = new Set<string>();
  const re = /(?:£|\$)?\d[\d,.]*\s*(?:%|k\b|m\b|bn\b|x\b|\+)?/gi;
  for (const m of text.toLowerCase().matchAll(re)) {
    const raw = m[0].trim().replace(/\s+/g, "").replace(/[.,]+$/, "");
    if (!raw) continue;
    // A bare four-digit year is a date, not a result.
    if (/^(19|20)\d{2}$/.test(raw)) continue;
    /*
     * A bare one- or two-digit number carries no claim. Run over the real
     * corpus, half the "enriched" proposals were triggered by prose like "Day 1
     * was a WhatsApp group" and "complexity scoring (1-5 by estate value)". A
     * figure earns its place by carrying a unit (%, £, k, +) or by being large
     * enough that nobody writes it incidentally.
     */
    const marked = /[%£$+]|k$|m$|bn$|x$/.test(raw);
    if (!marked && raw.replace(/\D/g, "").length < 3) continue;
    out.add(raw);
  }
  return out;
}

/**
 * How much two lines say the same thing, from 0 to 1.
 *
 * Overlap coefficient rather than Jaccard, on purpose. A tailored bullet is
 * usually a longer, richer version of a master entry, and Jaccard punishes that
 * extra material as though it were disagreement. Dividing by the shorter side
 * asks the question actually being asked: is the smaller of these two contained
 * in the larger?
 */
export function similarity(a: string, b: string): number {
  const ta = tokenise(a);
  const tb = tokenise(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.min(ta.size, tb.size);
}

/**
 * Above this, two lines are versions of each other rather than different
 * claims. Tuned against the real corpus, not guessed: see salvage.test.ts,
 * which pins both a known pair and a known non-pair.
 */
export const SAME_CLAIM = 0.5;

/**
 * How many CVs a line must appear in before it is worth proposing.
 *
 * Set to two after running the corpus produced 75 "new" proposals, which is a
 * pile rather than a suggestion. A line written once may be genuinely
 * job-specific; a line you reached for twice is part of how you describe
 * yourself, and its absence from the master record is the actual defect.
 *
 * This is a fact about the user's own writing, not an inference about
 * employers, which is the line this module does not cross.
 */
export const MIN_APPEARANCES = 2;

export interface MasterLine {
  id: string;
  text: string;
}

export interface CvLine {
  text: string;
  /** Application it came from. */
  slug: string;
  /** Section heading it sat under, for placing an accepted proposal. */
  section: string;
}

export interface Proposal {
  kind: "new" | "enriched";
  /** The best-written version seen, which is the longest one. */
  text: string;
  /** Applications this line appeared in, most recent first. */
  seenIn: string[];
  /** The master entry it belongs to, for `enriched`. */
  closest: { id: string; text: string; score: number } | null;
  /** Figures the CV carries and the master entry does not. */
  newFigures: string[];
  section: string;
}

/**
 * Compare what you sent against what you keep.
 *
 * Proposals are grouped: the same line appears across many applications, and
 * twelve rows saying the same thing is a chore rather than a suggestion. The
 * group is ordered by how many CVs used it, which is a fact about your own
 * writing and the closest honest proxy for "this matters to me".
 */
export function salvage(master: MasterLine[], lines: CvLine[]): Proposal[] {
  const groups: Array<{ rep: CvLine; texts: string[]; slugs: string[] }> = [];

  for (const line of lines) {
    const group = groups.find((g) => similarity(g.rep.text, line.text) >= SAME_CLAIM);
    if (group) {
      if (!group.slugs.includes(line.slug)) group.slugs.push(line.slug);
      group.texts.push(line.text);
      // Keep the fullest phrasing as the representative: it is the one that
      // survived the most tailoring and carries the most detail.
      if (line.text.length > group.rep.text.length) group.rep = line;
    } else {
      groups.push({ rep: line, texts: [line.text], slugs: [line.slug] });
    }
  }

  const proposals: Proposal[] = [];

  for (const g of groups) {
    let closest: Proposal["closest"] = null;
    for (const m of master) {
      const score = similarity(m.text, g.rep.text);
      if (score >= SAME_CLAIM && (!closest || score > closest.score)) {
        closest = { id: m.id, text: m.text, score };
      }
    }

    if (!closest) {
      proposals.push({
        kind: "new",
        text: g.rep.text,
        seenIn: g.slugs,
        closest: null,
        newFigures: [...figures(g.rep.text)],
        section: g.rep.section,
      });
      continue;
    }

    // Matched. Only interesting if the sent version knows something the kept
    // version does not, which in practice means it carries a figure the master
    // is missing.
    const have = figures(closest.text);
    const missing = [...figures(g.rep.text)].filter((f) => !have.has(f));
    if (missing.length) {
      proposals.push({
        kind: "enriched",
        text: g.rep.text,
        seenIn: g.slugs,
        closest,
        newFigures: missing,
        section: g.rep.section,
      });
    }
  }

  return proposals
    .filter((p) => p.seenIn.length >= MIN_APPEARANCES)
    .sort((a, b) => b.seenIn.length - a.seenIn.length || b.text.length - a.text.length);
}
