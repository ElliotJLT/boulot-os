import { describe, expect, it } from "vitest";
import { updateFrontmatter } from "./write.js";

/*
 * Frontmatter with no closing delimiter.
 *
 * A real status.md was written without one. Every stage change against it
 * reported success and changed nothing, so the card would not move between
 * columns and nothing anywhere said why.
 */
describe("unterminated frontmatter", () => {
  const broken = `---
company: Nous
role: Product Builder
stage: lead
applied_date:
`;

  it("still applies the patch", () => {
    const out = updateFrontmatter(broken, { stage: "applied" });
    expect(out).toContain("stage: applied");
    expect(out).not.toContain("stage: lead");
  });

  it("closes the block so the next edit is a normal one", () => {
    const once = updateFrontmatter(broken, { stage: "applied" });
    expect(once.match(/^---$/gm)).toHaveLength(2);
    expect(updateFrontmatter(once, { stage: "interviewing" })).toContain("stage: interviewing");
  });

  it("keeps the other keys and their order", () => {
    const out = updateFrontmatter(broken, { stage: "applied" });
    expect(out.indexOf("company: Nous")).toBeLessThan(out.indexOf("role: Product Builder"));
    expect(out).toContain("applied_date:");
  });

  it("does not swallow body text as frontmatter", () => {
    const out = updateFrontmatter(`---\ncompany: Nous\n\nSome notes here.\n`, { stage: "applied" });
    expect(out).toContain("stage: applied");
    expect(out.split("---")[2]).toContain("Some notes here.");
  });
});
