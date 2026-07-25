import { z } from "zod";

/**
 * The CV data model.
 *
 * This is the source of truth for a tailored CV. `cv.md` and `cv.txt` are
 * generated *from* this, not parsed *into* it.
 *
 * Why: the previous design parsed LLM-authored markdown at render time. Measured
 * against the real vault, 23 of 55 tailored CVs (42%) silently lost a header
 * field, and 10 lost the headline *and* the entire contact block — producing a
 * PDF with a name and no way to reach the candidate, with a zero exit code.
 * The parser had nowhere to report to, so the failure was invisible.
 *
 * Making the producer emit a validated structure ends that class of bug: a
 * missing contact block is now a tool error the model must fix in-loop, not a
 * blank space on a page nobody checks.
 */

/** A single achievement line. */
export const Bullet = z.object({
  text: z.string().min(1),
  /**
   * Back-reference to a numbered bullet in `cv-master.md` (e.g. "zero-gravity:14").
   *
   * The rule across this system is "never fabricate experience — reword and
   * reorder only". That has always been prose in a rules file. Carrying the
   * provenance makes it checkable: the editor renders an unsourced bullet in
   * amber, so invented experience is visible rather than asserted.
   */
  sourceBulletId: z.string().optional(),
});
export type Bullet = z.infer<typeof Bullet>;

/**
 * A titled group of bullets nested under a role.
 *
 * Real CVs in the vault use `**Sub-header**` inside an experience entry to
 * separate e.g. "AI & Product" from "Operations" within one job.
 */
export const Subgroup = z.object({
  title: z.string().min(1),
  bullets: z.array(Bullet),
});
export type Subgroup = z.infer<typeof Subgroup>;

export const ExperienceEntry = z.object({
  org: z.string().min(1),
  role: z.string().min(1),
  /**
   * Printed verbatim, e.g. "2022 – Present", "Jan 2024 – Mar 2026".
   *
   * Deliberately an opaque string. The old Python renderer tried to normalise
   * these to `04/2022` and got it wrong; the real vault has no consistent
   * format, and inventing one would silently rewrite the candidate's history.
   * Structured start/end can be layered on later without breaking rendering.
   */
  dates: z.string().default(""),
  /** The line after the dates: "fintech, Series B, 40 people". */
  context: z.string().optional(),
  bullets: z.array(Bullet).default([]),
  subgroups: z.array(Subgroup).default([]),
});
export type ExperienceEntry = z.infer<typeof ExperienceEntry>;

export const EducationEntry = z.object({
  institution: z.string().min(1),
  course: z.string().min(1),
  dates: z.string().default(""),
  description: z.string().optional(),
});
export type EducationEntry = z.infer<typeof EducationEntry>;

/** `**Compliance & Risk:** ISO 27001, SRA/FCA, GDPR` */
export const SkillGroup = z.object({
  category: z.string().min(1),
  items: z.array(z.string().min(1)),
});
export type SkillGroup = z.infer<typeof SkillGroup>;

/** `English: Native | French: Intermediate` */
export const LanguageItem = z.object({
  language: z.string().min(1),
  level: z.string().min(1),
});
export type LanguageItem = z.infer<typeof LanguageItem>;

/**
 * Anything that doesn't fit the shapes above.
 *
 * `active/{company}/` is a freeform document workspace, and CVs in the vault
 * carry one-off sections ("Selected Projects", "Publications", "Board Roles").
 * Without an escape hatch the importer would have to drop them — which is the
 * exact failure being designed out. Preserve, don't discard.
 */
export const FreeformBlock = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("paragraph"), text: z.string() }),
  z.object({ kind: z.literal("bullets"), bullets: z.array(Bullet) }),
]);
export type FreeformBlock = z.infer<typeof FreeformBlock>;

export const Section = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("experience"),
    title: z.string().default("Experience"),
    entries: z.array(ExperienceEntry),
  }),
  z.object({
    kind: z.literal("education"),
    title: z.string().default("Education"),
    entries: z.array(EducationEntry),
  }),
  z.object({
    kind: z.literal("skills"),
    title: z.string().default("Skills"),
    groups: z.array(SkillGroup),
  }),
  z.object({
    kind: z.literal("languages"),
    title: z.string().default("Languages"),
    items: z.array(LanguageItem),
  }),
  z.object({
    kind: z.literal("freeform"),
    title: z.string().min(1),
    blocks: z.array(FreeformBlock),
  }),
]);
export type Section = z.infer<typeof Section>;

/**
 * Contact details.
 *
 * Every field is optional *except* that {@link CV} requires at least one
 * reachable channel — see the refinement below. A CV that renders without any
 * way to contact the candidate is the single worst failure this system had, so
 * it is the one thing the schema refuses to produce.
 */
export const Contact = z.object({
  email: z.string().optional(),
  phone: z.string().optional(),
  linkedin: z.string().optional(),
  github: z.string().optional(),
  website: z.string().optional(),
  location: z.string().optional(),
});
export type Contact = z.infer<typeof Contact>;

const REACHABLE = ["email", "phone", "linkedin", "website"] as const;

export const CV = z
  .object({
    name: z.string().min(1, "a CV must carry the candidate's name"),
    /** The `**Head of Operations | 10 years in regulated ops**` line. */
    headline: z.string().optional(),
    contact: Contact,
    summary: z.string().optional(),
    sections: z.array(Section).default([]),
    meta: z
      .object({
        targetCompany: z.string().optional(),
        targetRole: z.string().optional(),
        /** Which `cv-master.md` summary variant this was built from. */
        summaryVariant: z.string().optional(),
        generatedAt: z.string().optional(),
      })
      .optional(),
  })
  .refine((cv) => REACHABLE.some((k) => (cv.contact[k] ?? "").trim().length > 0), {
    path: ["contact"],
    message:
      "a CV needs at least one way to reach the candidate (email, phone, linkedin or website)",
  });
export type CV = z.infer<typeof CV>;
