/**
 * Which model does which piece of work.
 *
 * One file, because the alternative is the decision being made four times in
 * four components by whoever was editing them last.
 *
 * The split is about judgement, not importance. Reading a job advert and
 * turning it into structured fields is extraction: there is a right answer and
 * a cheaper model finds it. Choosing which six of thirty-three achievements
 * argue best for a specific role, and how to phrase them without sounding like
 * a machine, is the one genuine judgement call in the product, and it is the
 * thing the whole app exists to do well.
 *
 * Anything not listed here keeps the default, so work nobody has assessed is
 * never quietly downgraded.
 */
export const MODELS = {
  /** Reading a posting, extracting the facts, researching the company. */
  intake: "claude-sonnet-5",
  /** Writing the CV. The judgement call, and worth the best model. */
  tailor: "claude-opus-4-8",
  /** Cover letters and application answers: voice matters, invention does not. */
  writing: "claude-sonnet-5",
  /** Small changes to something already written. */
  tweak: "claude-sonnet-5",
  /** Turning a pasted CV into the master record on first run. */
  import: "claude-sonnet-5",
} as const;
