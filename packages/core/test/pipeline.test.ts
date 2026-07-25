import { describe, expect, it } from "vitest";
import { Application } from "../src/schema/status.js";
import { normaliseStage } from "../src/schema/status.js";
import { THRESHOLDS, daysBetween, flagsFor, nextActions, primaryFlag } from "../src/pipeline/flags.js";

const TODAY = new Date("2026-07-25T12:00:00Z");
const daysAgo = (n: number) =>
  new Date(TODAY.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const inDays = (n: number) =>
  new Date(TODAY.getTime() + n * 86_400_000).toISOString().slice(0, 10);

const app = (over: Partial<Application> = {}) =>
  Application.parse({ slug: "acme", company: "Acme", stage: "applied", path: "x", ...over });

describe("normaliseStage", () => {
  it.each([
    ["applied", "applied"],
    ["rejected", "closed-lost"],
    ["researching", "lead"],
    ["ACCEPTED", "closed-won"],
    ["interview", "interviewing"],
  ])("maps %s to %s", (raw, expected) => {
    expect(normaliseStage(raw).stage).toBe(expected);
  });

  it("splits a compound value and keeps the interesting half", () => {
    const r = normaliseStage("interview — in-office task day");
    expect(r.stage).toBe("interviewing");
    expect(r.substage).toBe("in-office task day");
  });

  it("maps interview-2 to interviewing", () => {
    expect(normaliseStage("interview-2").stage).toBe("interviewing");
  });

  it("carries the outcome for terminal stages", () => {
    expect(normaliseStage("withdrawn")).toMatchObject({
      stage: "closed-lost",
      outcome: "withdrawn",
    });
  });

  it("treats orthogonal state as a flag, not a stage", () => {
    expect(normaliseStage("on hold")).toMatchObject({ stage: "applied", flag: "onHold" });
    expect(normaliseStage("at-risk")).toMatchObject({ flag: "atRisk" });
  });

  // Dropping an unrecognised value is the failure this whole system is trying
  // to design out. Preserve it and let a human look.
  it("preserves an unrecognised value instead of discarding it", () => {
    const r = normaliseStage("waiting on referral from Dave");
    expect(r.matched).toBe(false);
    expect(r.substage).toBe("waiting on referral from Dave");
  });

  it("handles a missing stage without throwing", () => {
    expect(normaliseStage(undefined).stage).toBeNull();
    expect(normaliseStage("").stage).toBeNull();
  });
});

describe("flagsFor", () => {
  it("flags an overdue next action first", () => {
    const f = primaryFlag(app({ nextActionDate: daysAgo(3) }), TODAY);
    expect(f).toMatchObject({ kind: "OVERDUE", days: 3 });
  });

  it.each([
    [0, "DUE_TODAY"],
    [1, "DUE_TOMORROW"],
  ])("flags a next action %s days out as %s", (n, kind) => {
    expect(primaryFlag(app({ nextActionDate: inDays(n) }), TODAY)?.kind).toBe(kind);
  });

  it("does not flag a next action further out", () => {
    expect(primaryFlag(app({ nextActionDate: inDays(5) }), TODAY)).toBeNull();
  });

  // Boundary: the threshold is "more than", not "at least".
  it(`does not flag no-response at exactly ${THRESHOLDS.noResponseDays} days`, () => {
    const f = flagsFor(app({ lastUpdated: daysAgo(THRESHOLDS.noResponseDays) }), TODAY);
    expect(f.find((x) => x.kind === "NO_RESPONSE")).toBeUndefined();
  });

  it(`flags no-response at ${THRESHOLDS.noResponseDays + 1} days`, () => {
    const f = flagsFor(app({ lastUpdated: daysAgo(THRESHOLDS.noResponseDays + 1) }), TODAY);
    expect(f.find((x) => x.kind === "NO_RESPONSE")).toBeDefined();
  });

  it("only flags no-response for applications actually sent", () => {
    const f = flagsFor(app({ stage: "lead", lastUpdated: daysAgo(60) }), TODAY);
    expect(f.find((x) => x.kind === "NO_RESPONSE")).toBeUndefined();
  });

  // The distinction that makes STALE meaningful: drifting means nothing planned.
  it("does not call something stale when a next action is scheduled", () => {
    const f = flagsFor(
      app({ lastUpdated: daysAgo(90), nextActionDate: inDays(4) }),
      TODAY,
    );
    expect(f.find((x) => x.kind === "STALE")).toBeUndefined();
  });

  it("calls it stale when it is drifting with nothing planned", () => {
    const f = flagsFor(app({ lastUpdated: daysAgo(THRESHOLDS.staleDays + 1) }), TODAY);
    expect(f.find((x) => x.kind === "STALE")).toBeDefined();
  });

  it("collapses terminal stages to a single DEAD flag", () => {
    const f = flagsFor(app({ stage: "closed-lost", outcome: "rejected", lastUpdated: daysAgo(200) }), TODAY);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "DEAD", label: "rejected" });
  });

  it("returns nothing for a healthy application", () => {
    expect(flagsFor(app({ lastUpdated: daysAgo(2), nextActionDate: inDays(6) }), TODAY)).toEqual([]);
  });

  it("survives an unparseable date", () => {
    expect(() => flagsFor(app({ lastUpdated: "sometime last spring" }), TODAY)).not.toThrow();
  });
});

describe("daysBetween", () => {
  // Times of day must not shift the answer, or flags flicker through the day.
  it("ignores clock time", () => {
    expect(
      daysBetween(new Date("2026-07-20T23:59:00Z"), new Date("2026-07-21T00:01:00Z")),
    ).toBe(1);
  });
});

describe("nextActions", () => {
  it("returns at most three, worst first, excluding dead ones", () => {
    const apps = [
      app({ slug: "a", nextActionDate: daysAgo(1) }),
      app({ slug: "b", nextActionDate: daysAgo(30) }),
      app({ slug: "c", nextActionDate: inDays(0) }),
      app({ slug: "d", lastUpdated: daysAgo(99) }),
      app({ slug: "e", stage: "closed-lost", outcome: "rejected" }),
    ];
    const out = nextActions(apps, TODAY);
    expect(out).toHaveLength(3);
    expect(out[0]?.app.slug).toBe("b"); // most overdue
    expect(out.map((o) => o.app.slug)).not.toContain("e");
  });
});
