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
  /*
   * A next-action date raises nothing at all any more.
   *
   * The intake wrote "today + 7" onto every application and nothing ever
   * updated it, so a week later every card went overdue and stayed there. One
   * board carried seventeen at once, the worst reading 164 days. These assert
   * the silence, because the old behaviour had tests too and they all passed
   * while the feature was useless.
   */
  it.each([[-3], [0], [1], [5]])("raises nothing for a next action %s days out", (n) => {
    const f = flagsFor(app({ nextActionDate: n < 0 ? daysAgo(-n) : inDays(n) }), TODAY);
    expect(f.find((x) => ["OVERDUE", "DUE_TODAY", "DUE_TOMORROW"].includes(x.kind))).toBeUndefined();
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

  /*
   * Stale is about drift, and a phantom date does not stop drift.
   *
   * This used to be suppressed by any next-action date, which the intake put
   * on everything, so the flag that means something was hidden behind the one
   * that did not.
   */
  it("still calls it stale when a next action is scheduled but nothing has moved", () => {
    const f = flagsFor(app({ lastUpdated: daysAgo(90), nextActionDate: inDays(4) }), TODAY);
    expect(f.find((x) => x.kind === "STALE")).toBeDefined();
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
    // Ranked on real signals now: silence since applying, and drift. A
    // next-action date no longer decides anything, so these carry dates that
    // differ only in how long nothing has happened.
    const apps = [
      app({ slug: "a", lastUpdated: daysAgo(THRESHOLDS.noResponseDays + 2) }),
      app({ slug: "b", lastUpdated: daysAgo(120) }),
      app({ slug: "c", lastUpdated: daysAgo(THRESHOLDS.noResponseDays + 5) }),
      app({ slug: "d", lastUpdated: daysAgo(99) }),
      app({ slug: "e", stage: "closed-lost", outcome: "rejected" }),
    ];
    const out = nextActions(apps, TODAY);
    expect(out).toHaveLength(3);
    expect(out[0]?.app.slug).toBe("b"); // longest silence
    expect(out.map((o) => o.app.slug)).not.toContain("e");
  });
});
