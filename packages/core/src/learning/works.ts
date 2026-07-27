import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { similarity } from "./similarity.js";

/**
 * What has actually worked, read from the CVs that actually went out.
 *
 * The vault holds two kinds of truth and only one of them was being used. The
 * master record says what the person has done; the sent CVs plus their
 * outcomes say what happened when it was said a particular way. Bullets
 * already flow back through the similarity match, but the two most-tailored
 * things on any CV — the headline and the summary — were written fresh every
 * time and then forgotten, which means the system kept rewriting its most
 * important sentence with no memory of which versions had ever earned a reply.
 *
 * This reads every application that has a `cv.md`, takes the headline and the
 * summary from it, groups near-identical ones, and scores each group by what
 * happened to the applications it appeared on. No model involved: the parse is
 * three regexes and the grouping is the same overlap coefficient the bullet
 * match already uses. Deterministic, so the numbers shown to the person and
 * the numbers fed to the agent can never disagree.
 *
 * Honesty rule: only applications with a CV on file count. An application
 * whose CV was never saved proves nothing about any wording, so it appears in
 * `total` (the person should know the record is incomplete) but nowhere else.
 */

/** The fields of an application this module needs. Matches `Application`. */
export interface AppLike {
  slug: string;
  company: string | null;
  stage: string | null;
  substage: string | null;
  outcome: string | null;
  bucket: "active" | "archive";
}

/**
 * One test for "they replied", shared with the server.
 *
 * This predicate existed inline in the /master endpoint; a second copy here
 * would drift, and this file exists because two sources of truth drift.
 */
export function reachedInterview(a: Pick<AppLike, "stage" | "substage">): boolean {
  return (
    ["screening", "interviewing", "offer", "closed-won"].includes(a.stage ?? "") ||
    /interview|screen|final|task day/i.test(a.substage ?? "")
  );
}

export interface SentCv {
  slug: string;
  company: string;
  reached: boolean;
  headline: string | null;
  summary: string | null;
}

/**
 * Headline and summary, from a tailored cv.md.
 *
 * The renderer enforces this shape already (a headline missing its `**` is a
 * loud warning at render time), so the parse can be strict: the headline is
 * the first bold-only line, the summary is the first paragraph under a
 * Summary heading.
 */
export function parseHeader(md: string): { headline: string | null; summary: string | null } {
  const headline = /^\*\*(.+)\*\*\s*$/m.exec(md)?.[1]?.trim() ?? null;
  const m = /^##\s+summary\s*$/im.exec(md);
  let summary: string | null = null;
  if (m) {
    const after = md.slice(m.index + m[0].length);
    summary =
      after
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .find((p) => p && !p.startsWith("#") && !p.startsWith("---")) ?? null;
  }
  return { headline, summary };
}

/** Every application that actually has a CV on file, with its outcome. */
export function collectSent(personDir: string, apps: AppLike[]): SentCv[] {
  const out: SentCv[] = [];
  for (const a of apps) {
    const path = join(personDir, a.bucket, a.slug, "cv.md");
    if (!existsSync(path)) continue;
    let md = "";
    try {
      md = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const { headline, summary } = parseHeader(md);
    out.push({
      slug: a.slug,
      company: a.company ?? a.slug,
      reached: reachedInterview(a),
      headline,
      summary,
    });
  }
  return out;
}

export interface Ranked {
  /** The wording itself, quoted from a CV that reached interview when one did. */
  text: string;
  /** Which applications carried this wording (or a near-identical one). */
  usedIn: string[];
  reached: number;
}

/**
 * Group near-identical wordings and score the groups.
 *
 * Tailoring rewrites the headline a little every time, so exact-match grouping
 * would report thirty groups of one and learn nothing. The same overlap
 * coefficient that matches bullets back to the master groups "Technical
 * Product Lead | AI products" with "Technical Product Lead — AI product
 * builder" while keeping genuinely different positioning apart.
 *
 * The quoted text comes from a CV that reached an interview when the group has
 * one, because "this is the version that worked" is the whole point of showing
 * it.
 */
export function rank(
  items: Array<{ text: string; slug: string; reached: boolean }>,
  /*
   * Higher than the bullet threshold on purpose. SAME_CLAIM (0.5) is tuned for
   * long bullets, where half the tokens overlapping means the same claim.
   * Headlines are six words and most of them are role titles: "Product
   * engineer, full-stack with AI agents" and "Product engineer for regulated
   * systems" share product/engineer/AI and hit 0.5 while being entirely
   * different positionings. Grouping those together would credit one wording
   * with the other's interview.
   */
  threshold = 0.7,
): Ranked[] {
  const groups: Array<{ texts: Array<{ text: string; reached: boolean }>; usedIn: string[]; reached: number }> = [];
  for (const item of items) {
    const home = groups.find((g) => g.texts.some((t) => similarity(t.text, item.text) >= threshold));
    if (home) {
      home.texts.push({ text: item.text, reached: item.reached });
      home.usedIn.push(item.slug);
      if (item.reached) home.reached += 1;
    } else {
      groups.push({
        texts: [{ text: item.text, reached: item.reached }],
        usedIn: [item.slug],
        reached: item.reached ? 1 : 0,
      });
    }
  }
  return groups
    .map((g) => ({
      text: (g.texts.find((t) => t.reached) ?? g.texts[0]!).text,
      usedIn: g.usedIn,
      reached: g.reached,
    }))
    .sort((a, b) => b.reached - a.reached || b.usedIn.length - a.usedIn.length);
}

export interface Works {
  /** All applications, including ones with no CV saved: the honest total. */
  applications: number;
  /** Applications whose cv.md is actually in the vault. Every number below is out of this. */
  withCv: number;
  /** Of those, how many reached a screen or interview. */
  reached: number;
  headlines: Ranked[];
  summaries: Ranked[];
}

export function whatWorked(personDir: string, apps: AppLike[]): Works {
  const sent = collectSent(personDir, apps);
  const of = (key: "headline" | "summary") =>
    rank(
      sent.flatMap((s) => {
        const text = s[key];
        return text ? [{ text, slug: s.slug, reached: s.reached }] : [];
      }),
    );
  return {
    applications: apps.length,
    withCv: sent.length,
    reached: sent.filter((s) => s.reached).length,
    headlines: of("headline"),
    summaries: of("summary"),
  };
}
