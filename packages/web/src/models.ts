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

/**
 * Who you are talking to, when you get to choose.
 *
 * Everywhere else in the app the model is a decision the product has already
 * made, and that is right: nobody opening a career tool wants to pick a model
 * before they can ask a question. The conversation is the exception. Asking
 * "what will they push on" and asking "shorten this line" are different jobs
 * with an order-of-magnitude of cost between them, and the person typing knows
 * which one they are doing.
 *
 * Named for the work rather than the model, because "Sonnet" is not a fact
 * about what you are about to get.
 */
export const AGENTS = [
  {
    key: "quick",
    label: "Quick",
    hint: "Edits, rewrites, small questions",
    model: "claude-sonnet-5",
  },
  {
    key: "thinker",
    label: "Deep",
    hint: "Strategy, hard questions, anything you will say out loud",
    model: "claude-opus-4-8",
  },
] as const;

export type AgentKey = (typeof AGENTS)[number]["key"];
