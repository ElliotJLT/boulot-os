import { describe, expect, it } from "vitest";
import { activityGrid, levelFor, momentum } from "./activity.js";

const TODAY = new Date(2026, 7, 3); // 3 August 2026, local
const app = (slug: string, appliedDate: string | null) => ({ slug, appliedDate });

describe("levelFor", () => {
  it("has one empty state and four shades", () => {
    expect([0, 1, 2, 3, 5, 7].map(levelFor)).toEqual([0, 1, 1, 2, 3, 4]);
  });
});

describe("activityGrid", () => {
  it("ends on today and runs the full width", () => {
    const g = activityGrid([], 10, TODAY);
    expect(g).toHaveLength(10);
    expect(g.at(-1)!.date).toBe("2026-08-03");
    expect(g[0]!.date).toBe("2026-07-25");
  });

  it("counts applications onto the day they went out", () => {
    const g = activityGrid([app("a", "2026-08-01"), app("b", "2026-08-01"), app("c", "2026-08-03")], 10, TODAY);
    expect(g.find((d) => d.date === "2026-08-01")!.count).toBe(2);
    expect(g.find((d) => d.date === "2026-08-03")!.count).toBe(1);
  });

  /*
   * The gaps are the point.
   *
   * A map keyed only by days that had applications would close the empty ones
   * up, and a grid with no empty days cannot show a fortnight off.
   */
  it("keeps empty days rather than skipping them", () => {
    const g = activityGrid([app("a", "2026-08-03")], 5, TODAY);
    expect(g.filter((d) => d.count === 0)).toHaveLength(4);
    expect(g.map((d) => d.date)).toEqual([
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
  });

  it("ignores applications with no date, and anything outside the window", () => {
    const g = activityGrid([app("a", null), app("b", ""), app("c", "2020-01-01")], 10, TODAY);
    expect(g.reduce((n, d) => n + d.count, 0)).toBe(0);
  });

  // A full ISO instant must not land on the wrong side of midnight.
  it("takes the day from a timestamp without parsing it", () => {
    const g = activityGrid([app("a", "2026-08-02T23:30:00Z")], 5, TODAY);
    expect(g.find((d) => d.date === "2026-08-02")!.count).toBe(1);
  });
});

describe("momentum", () => {
  const grid = (counts: number[]) =>
    activityGrid(
      counts.flatMap((n, i) => {
        const d = new Date(2026, 7, 3 - (counts.length - 1 - i));
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return Array.from({ length: n }, (_, k) => app(`${i}-${k}`, iso));
      }),
      counts.length,
      TODAY,
    );

  it("reports today, the week and the best day", () => {
    const m = momentum(grid([9, 0, 1, 2, 0, 3, 4]));
    expect(m.today).toBe(4);
    expect(m.week).toBe(19);
    expect(m.best).toBe(9);
  });

  it("counts a streak back from today", () => {
    expect(momentum(grid([0, 1, 2, 3])).streak).toBe(3);
  });

  /*
   * A day that has barely started is not a broken streak. Yesterday is.
   */
  it("does not break the streak just because today is still empty", () => {
    expect(momentum(grid([1, 2, 3, 0])).streak).toBe(3);
  });

  it("does break it when yesterday was empty", () => {
    expect(momentum(grid([5, 5, 0, 2])).streak).toBe(1);
  });
});
