import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHeader, rank, whatWorked, reachedInterview } from "../src/learning/works.js";

const CV = (headline: string, summary: string) => `# Alex Rivera

**${headline}**

alex@example.com | London

---

## Summary

${summary}

---

## Experience
`;

describe("parseHeader", () => {
  it("reads the bold headline and the summary paragraph", () => {
    const { headline, summary } = parseHeader(CV("Product engineer, AI-native", "I ship end to end."));
    expect(headline).toBe("Product engineer, AI-native");
    expect(summary).toBe("I ship end to end.");
  });

  it("returns nulls rather than guessing on a CV with neither", () => {
    const { headline, summary } = parseHeader("# Name\n\nplain text only\n");
    expect(headline).toBeNull();
    expect(summary).toBeNull();
  });
});

describe("rank", () => {
  it("groups near-identical wordings and quotes the one that reached interview", () => {
    const r = rank([
      { text: "Technical Product Lead | AI products end to end", slug: "a", reached: false },
      { text: "Technical Product Lead — AI products, end to end", slug: "b", reached: true },
      { text: "Operations leader for regulated teams", slug: "c", reached: false },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]!.usedIn).toEqual(["a", "b"]);
    expect(r[0]!.reached).toBe(1);
    // The quoted text is the version from the CV that got a reply.
    expect(r[0]!.text).toContain("—");
  });
});

describe("whatWorked", () => {
  it("counts only applications whose cv.md is actually on file", () => {
    const dir = mkdtempSync(join(tmpdir(), "works-"));
    mkdirSync(join(dir, "active", "with-cv"), { recursive: true });
    mkdirSync(join(dir, "archive", "no-cv"), { recursive: true });
    writeFileSync(join(dir, "active", "with-cv", "cv.md"), CV("Builder", "I build."));
    const w = whatWorked(dir, [
      { slug: "with-cv", company: "A", stage: "interviewing", substage: null, outcome: null, bucket: "active" },
      { slug: "no-cv", company: "B", stage: "interviewing", substage: null, outcome: null, bucket: "archive" },
    ]);
    expect(w.applications).toBe(2);
    expect(w.withCv).toBe(1);
    expect(w.reached).toBe(1);
    expect(w.headlines[0]!.text).toBe("Builder");
  });
});

describe("reachedInterview", () => {
  it("accepts the canonical stages and the substage wording", () => {
    expect(reachedInterview({ stage: "screening", substage: null })).toBe(true);
    expect(reachedInterview({ stage: "applied", substage: "in-office task day" })).toBe(true);
    expect(reachedInterview({ stage: "applied", substage: null })).toBe(false);
  });
});
