import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CvLine } from "../learning/salvage.js";

/**
 * Every bullet you have ever actually sent.
 *
 * Reads the tailored CVs rather than the master, because they are the corpus
 * that has been edited under pressure and the master is the one that has not.
 * Sections are carried along so an accepted proposal knows where it belongs.
 *
 * Summary paragraphs are skipped deliberately. They are rewritten wholesale for
 * every application, they are prose rather than claims, and treating them as
 * bullets floods the output with near-duplicates of the same three sentences.
 */

/** Headings whose content is positional prose, not reusable evidence. */
const SKIP = /^(summary|profile|objective|about|education|interests|references)/i;

/**
 * The same section, spelled five ways.
 *
 * The real corpus carries "Open Source", "Open Source (github.com/ElliotJLT)",
 * "What I Build — github.com/ElliotJLT", "WHAT I BUILD (github.com/ElliotJLT)"
 * and "Side Projects" as headings over the same three projects. Left alone,
 * that is five destinations for one group of work and five chances to file the
 * same bullet in a different place.
 *
 * Only headings that are unambiguously this are folded. Employer headings vary
 * too, but the variation there is meaningful and is handled by matching on the
 * organisation instead.
 */
const PROJECTS = /^(open[- ]?source|side[- ]?projects?|projects?|what i build)\b/i;

function canonical(heading: string): string {
  const bare = heading.replace(/\s*[([—–-].*$/, "").trim();
  return PROJECTS.test(bare) ? "Projects" : heading;
}

export function extractLines(markdown: string, slug: string): CvLine[] {
  const lines: CvLine[] = [];
  let section = "";
  let skipping = false;

  for (const raw of markdown.split("\n")) {
    const h2 = /^##\s+(.*)$/.exec(raw);
    if (h2) {
      section = canonical((h2[1] ?? "").trim());
      skipping = SKIP.test(section);
      continue;
    }
    // Role headings are the sub-context within Experience.
    const h3 = /^###\s+(.*)$/.exec(raw);
    if (h3 && !skipping) {
      section = canonical((h3[1] ?? "").trim());
      continue;
    }

    if (skipping) continue;

    const bullet = /^\s*[-*]\s+(.*)$/.exec(raw);
    if (!bullet) continue;
    const text = (bullet[1] ?? "").trim();
    // Very short bullets are skill-list fragments, not claims.
    if (text.length < 40) continue;
    lines.push({ text, slug, section });
  }

  return lines;
}

/**
 * Read the tailored CVs from a person's folder.
 *
 * Archive first, then active: an archived application is finished, so its CV is
 * the final version rather than a draft in progress.
 */
export function readCvLines(personDir: string, buckets = ["archive", "active"]): CvLine[] {
  const out: CvLine[] = [];
  for (const bucket of buckets) {
    const dir = join(personDir, bucket);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const folder = join(dir, name);
      try {
        if (!statSync(folder).isDirectory()) continue;
      } catch {
        continue;
      }
      const cv = join(folder, "cv.md");
      if (!existsSync(cv)) continue;
      try {
        out.push(...extractLines(readFileSync(cv, "utf8"), name));
      } catch {
        /* unreadable, skip */
      }
    }
  }
  return out;
}
