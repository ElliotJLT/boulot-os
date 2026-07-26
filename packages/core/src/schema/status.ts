import { z } from "zod";

/**
 * The application record. One `status.md` per company folder.
 *
 * The vault has 61 of these carrying 16 distinct `stage` values, because the
 * field has been doing three jobs at once. Those jobs are separated here so no
 * information is lost in normalisation:
 *
 *   stage     where you are in the funnel        (applied, interviewing, ...)
 *   substage  the human detail                   ("Round 2", "In-office task day")
 *   flags     orthogonal state                   (on hold, at risk, waiting)
 *   outcome   how it ended                       (rejected, ghosted, ...)
 *
 * Collapsing "interview - in-office task day" to `interviewing` loses the
 * interesting part, so the interesting part gets its own field rather than
 * being thrown away.
 */
export const Stage = z.enum([
  "lead",
  "drafting",
  "applied",
  "screening",
  "interviewing",
  "offer",
  "closed-won",
  "closed-lost",
]);
export type Stage = z.infer<typeof Stage>;

export const Outcome = z.enum([
  "rejected",
  "ghosted",
  "withdrawn",
  "offer_declined",
  "offer_accepted",
  "never_applied",
]);
export type Outcome = z.infer<typeof Outcome>;

/** Observed `stage:` values in the wild, mapped onto the controlled vocabulary. */
const STAGE_ALIASES: Record<string, { stage: Stage; outcome?: Outcome; flag?: keyof Flags }> = {
  applied: { stage: "applied" },
  applying: { stage: "drafting" },
  drafting: { stage: "drafting" },
  researching: { stage: "lead" },
  interested: { stage: "lead" },
  outreach: { stage: "lead" },
  "phone_screen": { stage: "screening" },
  screening: { stage: "screening" },
  interview: { stage: "interviewing" },
  "interview-2": { stage: "interviewing" },
  "final_round": { stage: "interviewing" },
  offer: { stage: "offer" },
  accepted: { stage: "closed-won", outcome: "offer_accepted" },
  rejected: { stage: "closed-lost", outcome: "rejected" },
  withdrawn: { stage: "closed-lost", outcome: "withdrawn" },
  expired: { stage: "closed-lost", outcome: "ghosted" },
  // Closed, but nobody has said how. Written when a card is dragged into the
  // Closed column: the board knows it ended, and only the user knows whether it
  // was a rejection, a withdrawal or silence. Archiving asks.
  closed: { stage: "closed-lost" },
  ghosted: { stage: "closed-lost", outcome: "ghosted" },
  // Orthogonal state wearing a stage's clothing. Stage is unknown from the
  // value alone, so it stays null and the caller infers from context.
  waiting: { stage: "applied", flag: "awaitingResponse" },
  paused: { stage: "applied", flag: "onHold" },
  "on hold": { stage: "applied", flag: "onHold" },
  "at-risk": { stage: "applied", flag: "atRisk" },
};

export interface Flags {
  onHold: boolean;
  atRisk: boolean;
  awaitingResponse: boolean;
}

/**
 * Normalise a raw `stage:` string.
 *
 * Returns the mapping plus any substage detail carried in the original value,
 * so `"interview - in-office task day"` becomes
 * `{stage: "interviewing", substage: "in-office task day"}` rather than losing
 * the half that tells you what is actually happening.
 */
export function normaliseStage(raw: string | undefined | null): {
  stage: Stage | null;
  substage: string | null;
  outcome: Outcome | null;
  flag: keyof Flags | null;
  matched: boolean;
} {
  const empty = { stage: null, substage: null, outcome: null, flag: null, matched: false };
  if (!raw) return empty;

  const value = raw.trim().toLowerCase();
  if (!value) return empty;

  const direct = STAGE_ALIASES[value];
  if (direct) {
    return {
      stage: direct.stage,
      substage: null,
      outcome: direct.outcome ?? null,
      flag: direct.flag ?? null,
      matched: true,
    };
  }

  // Compound values: "interview — in-office task day".
  //
  // The separator must carry whitespace (or be a dash/colon that is not part of
  // a word), otherwise a hyphenated substage gets torn apart: an earlier version
  // split on any hyphen and turned "in-office task day" into "in office task
  // day". Split once only, and keep the remainder verbatim.
  const compound = /^([^—–:|]+?)(?:\s*[—–:|]\s*|\s+-\s+)(.+)$/.exec(value);
  if (compound) {
    const [, head = "", detail = ""] = compound;
    const viaHead = STAGE_ALIASES[head.trim()];
    if (viaHead) {
      return {
        stage: viaHead.stage,
        substage: detail.trim() || null,
        outcome: viaHead.outcome ?? null,
        flag: viaHead.flag ?? null,
        matched: true,
      };
    }
  }

  // Unrecognised. Preserve it as substage rather than discarding it, and let
  // the caller decide (normally: route to a review queue).
  return { ...empty, substage: raw.trim() };
}

export const Application = z.object({
  slug: z.string().min(1),
  company: z.string().min(1),
  role: z.string().default(""),
  stage: Stage,
  substage: z.string().nullable().default(null),
  outcome: Outcome.nullable().default(null),
  flags: z
    .object({
      onHold: z.boolean().default(false),
      atRisk: z.boolean().default(false),
      awaitingResponse: z.boolean().default(false),
    })
    .default({ onHold: false, atRisk: false, awaitingResponse: false }),
  appliedDate: z.string().nullable().default(null),
  lastUpdated: z.string().nullable().default(null),
  nextActionDate: z.string().nullable().default(null),
  nextAction: z.string().nullable().default(null),
  /** `salary_range` merges here. `salary_target` does NOT: different meaning. */
  salary: z.string().nullable().default(null),
  targetSalary: z.string().nullable().default(null),
  /** `link` / `url` / `greenhouse_url` all merge here. */
  url: z.string().nullable().default(null),
  source: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  /**
   * Which folder it lives in. `active/` is the board, `archive/` is history.
   * Both are read: the archive is where the funnel's denominator comes from.
   */
  bucket: z.enum(["active", "archive"]).default("active"),
  /** Where this came from, and anything that could not be normalised. */
  path: z.string(),
  warnings: z.array(z.string()).default([]),
});
export type Application = z.infer<typeof Application>;
