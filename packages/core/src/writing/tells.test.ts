import { describe, expect, it } from "vitest";
import { findTells } from "./tells.js";

/*
 * The fixture is the real thing.
 *
 * This is the answer that shipped and prompted the check: written by the app,
 * read by a person, and carrying the one construction the voice rules ban by
 * name. If the checker cannot catch this document it is not worth having.
 */
const REAL_ANSWER = `What are you proud of building?

The AI tutor I built at Zero Gravity: a Socratic maths and science coach that talks
students through past exam papers rather than handing them the answer. I owned it end
to end, architecture through to the App Store, working alongside three engineers rather
than as one myself.

The part I'm proudest of isn't the launch. It's the evaluation harness I built
afterwards, because a tutor that sounds confident and is wrong is worse than no tutor
at all.`;

describe("findTells", () => {
  it("catches the two-sentence antithesis that shipped", () => {
    const tells = findTells(REAL_ANSWER);
    const anti = tells.filter((t) => t.kind === "antithesis");
    expect(anti.length).toBeGreaterThan(0);
    expect(anti[0]!.quote).toContain("isn't the launch");
  });

  it("catches 'rather than' used twice, but not once", () => {
    expect(findTells(REAL_ANSWER).some((t) => t.kind === "repetition")).toBe(true);
    expect(findTells("I shipped it rather than talking about it.").some((t) => t.kind === "repetition")).toBe(
      false,
    );
  });

  it("catches the compact not-X-but-Y form", () => {
    const tells = findTells("It was not a clever idea, but months of grinding.");
    expect(tells.some((t) => t.kind === "antithesis")).toBe(true);
  });

  it("counts em-dashes and reports the total once", () => {
    const tells = findTells("One — two — three — four — five.");
    const dash = tells.filter((t) => t.kind === "em-dash");
    expect(dash).toHaveLength(1);
    expect(dash[0]!.fix).toContain("4 em-dashes");
  });

  it("leaves en-dash ranges alone", () => {
    expect(findTells("I was there 2022–2026, £70–90k.")).toHaveLength(0);
  });

  it("flags banned vocabulary once each, with the replacement", () => {
    const tells = findTells("We leveraged a robust and seamless process.");
    expect(tells.map((t) => t.quote.toLowerCase())).toEqual(
      expect.arrayContaining(["leveraged", "robust", "seamless"]),
    );
    expect(tells.find((t) => t.quote.toLowerCase() === "leveraged")!.fix).toBe('Use "use".');
  });

  it("ignores headings and quoted source material", () => {
    // The employer's own question may contain anything; it is not his prose.
    expect(findTells("# Not the launch, but the harness\n\n> We leverage robust synergy.")).toHaveLength(0);
  });

  it("is quiet on clean prose", () => {
    expect(
      findTells("I built the eval harness. It caught the model grading against its own mark scheme."),
    ).toHaveLength(0);
  });
});
