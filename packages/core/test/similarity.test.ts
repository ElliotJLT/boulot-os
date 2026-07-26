import { describe, expect, it } from "vitest";
import { SAME_CLAIM, figures, similarity } from "../src/learning/similarity.js";
import { extractLines } from "../src/vault/cv-lines.js";

/**
 * The pairs below are lifted verbatim from the vault this was built against.
 * Thresholds tuned on a corpus need the corpus in the tests, or the next person
 * to nudge SAME_CLAIM has no way to know what they broke.
 */
const MASTER_COPILOT =
  "Built AI Copilot (RAG orchestration): contextualised data from multiple tools via system message handling for non-technical teams. Early-stage architecture that became foundation for current AI product work";
const SENT_COPILOT =
  "Built AI Copilot (RAG orchestration) that pulled contextualised data from multiple tools for non-technical teams. Designed system message handling, defined safety constraints (no hallucinated outputs, cite sources, flag low-confidence)";
const SENT_CLEARBOOK =
  "**clearbook**: MCP server connecting to live UK regulatory data (SRA, FCA, Companies House). 11 tools for professional services discovery";

describe("similarity", () => {
  it("recognises a rewritten version of the same claim", () => {
    expect(similarity(MASTER_COPILOT, SENT_COPILOT)).toBeGreaterThan(SAME_CLAIM);
  });

  it("does not link two unrelated claims", () => {
    expect(similarity(MASTER_COPILOT, SENT_CLEARBOOK)).toBeLessThan(SAME_CLAIM);
  });

  it("is not fooled by length: a longer richer version still matches", () => {
    // Jaccard scores this pair below threshold because the sent version adds so
    // much. Overlap coefficient is why the module uses it.
    const short = "Built GTM machinery: CRM from scratch, pipeline tracking";
    const long =
      "Built GTM machinery from scratch: CRM, pipeline tracking, partner referral dashboards, agentic tooling for the commercial team powered by natural language to SQL";
    expect(similarity(short, long)).toBeGreaterThan(SAME_CLAIM);
  });

  it("scores empty input at zero rather than dividing by nothing", () => {
    expect(similarity("", "anything at all")).toBe(0);
    expect(similarity("the and of to", "the and of to")).toBe(0);
  });
});

describe("figures", () => {
  it("keeps results", () => {
    expect([...figures("Cut agent errors 69%, saved ~250 agent-hours")]).toEqual(["69%", "250"]);
    expect([...figures("Managed budgets of £200k and £35k")]).toEqual(["£200k", "£35k"]);
    expect([...figures("scaled across 30+ markets")]).toEqual(["30+"]);
  });

  it("drops prose numbers that carry no claim", () => {
    // Both of these produced false "the master is stale" proposals before the
    // rule existed.
    expect([...figures("Day 1 was a WhatsApp group")]).toEqual([]);
    expect([...figures("complexity scoring (1-5 by estate value)")]).toEqual([]);
  });

  it("drops years, which are dates rather than results", () => {
    expect([...figures("Joined in 2022 and left in 2026")]).toEqual([]);
  });

  it("does not leave punctuation stuck to a figure", () => {
    // "1," used to come back as its own figure.
    expect([...figures("reached 120k users, then 146 hospitals.")]).toEqual(["120k", "146"]);
  });
});

describe("extractLines", () => {
  const cv = [
    "# Elliot Little",
    "## Summary",
    "- A summary line long enough to pass the length filter but still a summary",
    "## Experience",
    "### Zero Gravity — Product Manager",
    "**Feb 2022 – Present** | EdTech AI",
    "- Built an evaluation pipeline against real past papers and official mark schemes",
    "- Ruby, JavaScript",
    "## Education",
    "- A degree from somewhere, described at reasonable length for the filter",
  ].join("\n");

  it("takes bullets from experience and attributes them to the role", () => {
    const lines = extractLines(cv, "intercom");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.section).toBe("Zero Gravity — Product Manager");
    expect(lines[0]?.slug).toBe("intercom");
  });

  it("skips summary and education, which are prose rather than claims", () => {
    const text = extractLines(cv, "x").map((l) => l.text).join(" ");
    expect(text).not.toContain("summary");
    expect(text).not.toContain("degree");
  });

  it("skips short fragments, which are skill lists", () => {
    expect(extractLines(cv, "x").map((l) => l.text)).not.toContain("Ruby, JavaScript");
  });
});
