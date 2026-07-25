import { describe, expect, it } from "vitest";
import { DROPPED_AFTER, DROPPED_MIN_USES, consolidate, gather, questions, reconcile } from "../src/memory/consolidate.js";
import type { Master } from "../src/vault/master.js";

const bullet = (id: string, text: string, usedIn: string[] = []) => ({
  id, index: 1, text, tags: [], hasNumber: /\d/.test(text), usedIn, reachedInterview: 0, rejected: 0,
});
const master = (over: Partial<Master> = {}): Master => ({
  path: "x", updated: "2026-07-25", summaryVariants: [], skills: [],
  totals: { bullets: 0, tagged: 0, withNumbers: 0, used: 0 }, allTags: [], attention: [], proven: [],
  roles: [{ org: "Zero Gravity", title: "PM", dates: "Feb 2022 – Jan 2026", context: "", deeperDetail: 0, bullets: [] }],
  ...over,
});
const line = (text: string, slug: string, section = "Zero Gravity") => ({ text, slug, section });

describe("gather", () => {
  it("collapses rewordings into one claim and keeps the fullest", () => {
    const claims = gather([
      line("Built an evaluation pipeline against real past papers and mark schemes", "a"),
      line("Built an evaluation pipeline against real past papers and official mark schemes, 0% hallucination", "b"),
    ]);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.text).toContain("0% hallucination");
    expect(claims[0]?.seenIn).toEqual(["a", "b"]);
  });

  it("counts an application once no matter how often it repeats itself", () => {
    const t = "Built an evaluation pipeline against real past papers and official mark schemes";
    expect(gather([line(t, "a"), line(t, "a")])[0]?.seenIn).toEqual(["a"]);
  });
});

describe("reconcile", () => {
  const kept = "Built an evaluation pipeline against past papers and mark schemes";
  const m = master({
    roles: [{ org: "Zero Gravity", title: "PM", dates: "Feb 2022 – Jan 2026", context: "", deeperDetail: 0,
      bullets: [bullet("zg:1", kept)] }],
  });

  it("marks a claim the master already holds", () => {
    const [c] = reconcile(gather([line(kept, "a"), line(kept, "b")]), m);
    expect(c?.inMaster).toBe(true);
    expect(c?.masterIsStale).toBeNull();
  });

  it("flags the master as stale when the sent version carries a figure it lacks", () => {
    const richer = `${kept}, cutting hallucination to 0% at 99% accuracy`;
    const [c] = reconcile(gather([line(richer, "a"), line(richer, "b")]), m);
    expect(c?.masterIsStale?.id).toBe("zg:1");
    expect(c?.masterIsStale?.missing).toEqual(["0%", "99%"]);
  });

  it("leaves an unrelated claim unmatched", () => {
    const other = "Delivered ISO 27001 and 9001 in under six months as sole data protection officer";
    expect(reconcile(gather([line(other, "a"), line(other, "b")]), m)[0]?.inMaster).toBe(false);
  });
});

describe("questions", () => {
  it("asks about a relative date rather than resolving it", () => {
    const m = master({ roles: [{ org: "Zero Gravity", title: "PM", dates: "Feb 2022 – Present", context: "", deeperDetail: 0, bullets: [] }] });
    const q = questions([], m, []);
    expect(q[0]?.kind).toBe("relative-date");
    // It states the situation. It never asserts the job has ended.
    expect(q[0]?.detail).toContain("Present");
    expect(q[0]?.because).not.toMatch(/you (have )?left/i);
  });

  it("puts the date question above dropped phrasings", () => {
    const m = master({
      roles: [{ org: "Zero Gravity", title: "PM", dates: "Feb 2022 – Present", context: "", deeperDetail: 0,
        bullets: [bullet("zg:1", "never selected anywhere")] }],
    });
    const claims = gather(Array.from({ length: 6 }, (_, i) => line("Ran the operations team across thirty markets end to end", `old${i}`)));
    const q = questions(claims, m, ["old0", "new1", "new2", "new3"]);
    expect(q[0]?.kind).toBe("relative-date");
  });

  it("only calls a claim dropped once it was a habit", () => {
    const rare = gather([line("A phrasing used only twice in total here", "a"), line("A phrasing used only twice in total here", "b")]);
    expect(questions(rare, master(), ["a", "x", "y", "z"]).filter((q) => q.kind === "dropped")).toEqual([]);

    const habit = gather(
      Array.from({ length: DROPPED_MIN_USES }, (_, i) => line("A phrasing that ran through many applications", `old${i}`)),
    );
    const order = ["old0", "x", "y", "z"];
    expect(questions(habit, master(), order).some((q) => q.kind === "dropped")).toBe(true);
  });

  it("says nothing about drops before there is enough history", () => {
    const habit = gather(Array.from({ length: 6 }, (_, i) => line("A phrasing that ran through many applications", `old${i}`)));
    expect(questions(habit, master(), ["only", "two"]).filter((q) => q.kind === "dropped")).toEqual([]);
    expect(DROPPED_AFTER).toBe(3);
  });
});

describe("consolidate", () => {
  const lines = [
    line("Built an evaluation pipeline against past papers, 0% hallucination", "a"),
    line("Built an evaluation pipeline against past papers, 0% hallucination", "b"),
    line("clearbook: an MCP server over live UK regulatory data with eleven tools", "a", "Projects"),
    line("clearbook: an MCP server over live UK regulatory data with eleven tools", "b", "Projects"),
    line("A one-off phrasing written for exactly one application only", "a"),
  ];

  it("writes an index plus topic files", () => {
    const { files } = consolidate(master(), lines, ["a", "b"], { person: "E", generated: "2026-07-25" });
    expect(Object.keys(files).sort()).toEqual(["MEMORY.md", "evidence.md", "projects.md", "questions.md"]);
  });

  it("routes projects away from evidence", () => {
    const { files } = consolidate(master(), lines, ["a", "b"], { person: "E", generated: "2026-07-25" });
    expect(files["projects.md"]).toContain("clearbook");
    expect(files["evidence.md"]).not.toContain("clearbook");
  });

  it("drops claims written only once, which are job-specific rather than true of you", () => {
    const { files, summary } = consolidate(master(), lines, ["a", "b"], { person: "E", generated: "2026-07-25" });
    expect(files["MEMORY.md"]).not.toContain("one-off phrasing");
    expect(summary.claims).toBe(2);
  });

  it("marks itself generated so nobody hand-edits it", () => {
    const { files } = consolidate(master(), lines, ["a", "b"], { person: "E", generated: "2026-07-25" });
    expect(files["MEMORY.md"]).toContain("Generated file");
    expect(files["MEMORY.md"]).toContain("overwritten on every consolidation");
  });
});
