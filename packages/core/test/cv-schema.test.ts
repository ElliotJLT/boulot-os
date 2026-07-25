import { describe, expect, it } from "vitest";
import { CV } from "../src/schema/cv.js";

const base = {
  name: "Jane Smith",
  headline: "Head of Operations",
  contact: { email: "jane@example.com", phone: "07700 900123" },
  sections: [],
};

describe("CV schema", () => {
  it("accepts a well-formed CV", () => {
    const parsed = CV.parse(base);
    expect(parsed.name).toBe("Jane Smith");
  });

  // The regression this whole model exists to prevent. 10 of 55 real tailored
  // CVs rendered a PDF with a name and no contact details, exit code 0.
  it("REFUSES a CV with no way to reach the candidate", () => {
    const result = CV.safeParse({ ...base, contact: { location: "London" } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/at least one way to reach/);
  });

  it("refuses an entirely empty contact block", () => {
    expect(CV.safeParse({ ...base, contact: {} }).success).toBe(false);
  });

  it("treats a whitespace-only email as unreachable", () => {
    expect(CV.safeParse({ ...base, contact: { email: "   " } }).success).toBe(false);
  });

  it.each(["email", "phone", "linkedin", "website"] as const)(
    "accepts %s alone as a reachable channel",
    (channel) => {
      expect(CV.safeParse({ ...base, contact: { [channel]: "x" } }).success).toBe(true);
    },
  );

  it("does not accept location or github alone as reachable", () => {
    expect(CV.safeParse({ ...base, contact: { github: "gh/jane" } }).success).toBe(false);
  });

  it("requires a name", () => {
    expect(CV.safeParse({ ...base, name: "" }).success).toBe(false);
  });

  it("preserves an unrecognised section rather than dropping it", () => {
    const cv = CV.parse({
      ...base,
      sections: [
        {
          kind: "freeform",
          title: "Selected Projects",
          blocks: [{ kind: "paragraph", text: "Built a thing." }],
        },
      ],
    });
    expect(cv.sections[0]).toMatchObject({ kind: "freeform", title: "Selected Projects" });
  });

  it("keeps dates as an opaque string instead of normalising them", () => {
    const cv = CV.parse({
      ...base,
      sections: [
        {
          kind: "experience",
          entries: [{ org: "Acme", role: "Head of Ops", dates: "2022 – Present" }],
        },
      ],
    });
    const section = cv.sections[0];
    expect(section?.kind).toBe("experience");
    if (section?.kind === "experience") {
      expect(section.entries[0]?.dates).toBe("2022 – Present");
      expect(section.title).toBe("Experience");
      expect(section.entries[0]?.bullets).toEqual([]);
    }
  });

  it("carries bullet provenance so unsourced claims are visible", () => {
    const cv = CV.parse({
      ...base,
      sections: [
        {
          kind: "experience",
          entries: [
            {
              org: "Acme",
              role: "Head of Ops",
              bullets: [
                { text: "Cut onboarding time 40%", sourceBulletId: "acme:12" },
                { text: "Invented this one" },
              ],
            },
          ],
        },
      ],
    });
    if (cv.sections[0]?.kind === "experience") {
      const bullets = cv.sections[0].entries[0]?.bullets ?? [];
      expect(bullets[0]?.sourceBulletId).toBe("acme:12");
      expect(bullets[1]?.sourceBulletId).toBeUndefined();
    }
  });
});
