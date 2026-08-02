/**
 * The tells that can be found by machine.
 *
 * The plugin has told the agent for months not to write "it's not X, it's Y",
 * and an application answer came out reading "The part I'm proudest of isn't
 * the launch. It's the evaluation harness I built afterwards." The rule was
 * correct, written down, and skipped, because a rule in a file is a hope and
 * this document goes to an employer.
 *
 * So the greppable subset gets checked the way page overflow gets checked:
 * measured after the fact, reported plainly, no model involved. Same doctrine
 * as the fit report and the ATS text layer. A number nobody computed is a
 * number nobody can argue with.
 *
 * Deliberately narrow. Only patterns with near-zero false positives are in
 * here, because a checker that cries wolf gets ignored and then the real ones
 * go past too. The fuzzy tells — beat-per-line cadence, a closing aphorism,
 * uniform paragraph length — are left to the prose instructions and to the
 * person reading it. Better to catch four things reliably than eight badly.
 */

export interface Tell {
  kind: "antithesis" | "em-dash" | "repetition" | "vocabulary";
  /** The offending text, quoted so it can be found in the document. */
  quote: string;
  /** What to do about it, in the imperative. */
  fix: string;
}

/**
 * Words the voice rules replace outright.
 *
 * Kept in sync with `plugin/skills/writing-voice/SKILL.md`. Matched on word
 * boundaries so "delve" does not fire on "delved into" being absent, and
 * "realm" does not match "realms of" differently from "realm".
 */
const BANNED: Array<[RegExp, string]> = [
  [/\bleverag(e|es|ed|ing)\b/gi, "use"],
  [/\brobust\b/gi, "reliable"],
  [/\bseamless(ly)?\b/gi, "smooth"],
  [/\butilis(e|es|ed|ing)\b|\butiliz(e|es|ed|ing)\b/gi, "use"],
  [/\bdelv(e|es|ed|ing)\b/gi, "explore"],
  [/\bspearhead(s|ed|ing)?\b/gi, "led"],
  [/\btestament to\b/gi, "shows"],
  [/\bfoster(s|ed|ing)?\b/gi, "build"],
  [/\bcrucial\b/gi, "say why it matters"],
  [/\bpivotal\b/gi, "say what changed"],
  [/\bcomprehensive\b/gi, "say what it covers"],
  [/\bholistic\b/gi, "cut it"],
  [/\bmultifaceted\b/gi, "cut it"],
  [/\bcutting[- ]edge\b/gi, "name the thing"],
  [/\bunderscor(e|es|ed|ing)\b/gi, "shows"],
  [/\btapestry\b|\bsynergy\b|\bparadigm\b/gi, "cut it"],
];

/**
 * "Not X, it's Y", including split across a full stop.
 *
 * The two-sentence form is the one that actually shows up and the one a
 * single-sentence regex misses: "The part I'm proudest of isn't the launch.
 * It's the evaluation harness." So the window crosses sentence boundaries,
 * bounded tightly enough that an unrelated "it's" two paragraphs later cannot
 * pair with a negation.
 */
const ANTITHESIS =
  /\b(?:is|are|was|were)\s*n[o']t\b[^.!?\n]{0,80}[.!?]?\s*\b(?:it|that|they)(?:'s|s| is| was)\b/gi;

/** "not X but Y", the compact form. */
const NOT_BUT = /\bnot\s+(?:the\s+|a\s+|an\s+)?[^,.\n]{2,40},?\s+but\s+(?:the\s+|a\s+|an\s+)?/gi;

/** Prose em-dashes. Ranges use en-dashes and are left alone. */
const EM_DASH = /—/g;

function quoteAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${
    end < text.length ? "…" : ""
  }`;
}

/**
 * Everything findable, in the order it appears.
 *
 * `limit` on repetition is 1 for "rather than": one is a construction, two is
 * a tic, and the voice rules already name it as one Elliot has complained
 * about by name.
 */
export function findTells(markdown: string): Tell[] {
  // Headings and quoted source material are not the candidate's prose.
  const prose = markdown
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#") && !l.trimStart().startsWith(">"))
    .join("\n");

  const tells: Tell[] = [];

  for (const re of [ANTITHESIS, NOT_BUT]) {
    re.lastIndex = 0;
    for (const m of prose.matchAll(re)) {
      tells.push({
        kind: "antithesis",
        quote: quoteAround(prose, m.index ?? 0, m[0].length),
        fix: "State the positive directly. Cut the negated half.",
      });
    }
  }

  EM_DASH.lastIndex = 0;
  const dashes = [...prose.matchAll(EM_DASH)];
  if (dashes.length) {
    tells.push({
      kind: "em-dash",
      quote: quoteAround(prose, dashes[0]!.index ?? 0, 1),
      fix:
        dashes.length === 1
          ? "Replace with a full stop, comma, colon or brackets."
          : `${dashes.length} em-dashes. Replace each with a full stop, comma, colon or brackets.`,
    });
  }

  // \s+ not a literal space: real documents wrap, and "rather\nthan" is the
  // same tic. The first version of this missed it in the document that
  // prompted the whole check.
  const rather = [...prose.matchAll(/\brather\s+than\b/gi)];
  if (rather.length > 1) {
    tells.push({
      kind: "repetition",
      quote: `"rather than" ${rather.length} times`,
      fix: "Keep one at most. Rewrite the others.",
    });
  }

  for (const [re, replacement] of BANNED) {
    re.lastIndex = 0;
    const first = re.exec(prose);
    if (first) {
      tells.push({
        kind: "vocabulary",
        quote: first[0],
        fix: `Use "${replacement}".`,
      });
    }
  }

  return tells;
}
