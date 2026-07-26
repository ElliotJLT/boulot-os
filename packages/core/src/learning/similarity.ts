/**
 * Comparing things people wrote about themselves.
 *
 * Two CVs describing the same achievement almost never share a sentence. They
 * share a claim, rephrased for a different job, usually with a sharper number
 * the second time. Everything that reads a vault has to answer "are these the
 * same thing", so the answer lives in one place with its thresholds pinned by
 * tests against the real corpus.
 *
 * This started life as a review queue that proposed edits to the master record.
 * That was the wrong product and the queue is gone; what survived is the part
 * that was actually doing the work, now consumed by the consolidation pass.
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
 * claims. Tuned against the real corpus, not guessed: see the tests,
 * which pins both a known pair and a known non-pair.
 */
export const SAME_CLAIM = 0.5;

/** One bullet from one CV that was actually sent. */
export interface CvLine {
  text: string;
  /** Application it came from. */
  slug: string;
  /** Section heading it sat under, so an entry knows where it belongs. */
  section: string;
}
