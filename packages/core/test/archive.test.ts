import { describe, expect, it } from "vitest";
import { Application } from "../src/schema/status.js";
import { GHOST_DAYS, archivable, archiveCandidates } from "../src/pipeline/archive.js";
import { nextActions } from "../src/pipeline/flags.js";
import { updateFrontmatter } from "../src/vault/write.js";

const TODAY = new Date("2026-07-25T12:00:00Z");
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const inDays = (n: number) => new Date(TODAY.getTime() + n * 86_400_000).toISOString().slice(0, 10);

const app = (over: Partial<Application> = {}) =>
  Application.parse({ slug: "acme", company: "Acme", stage: "applied", path: "x", ...over });

describe("archivable", () => {
  it("proposes closed applications, carrying their outcome", () => {
    const c = archivable(app({ stage: "closed-lost", outcome: "rejected" }), TODAY);
    expect(c).toMatchObject({ slug: "acme", outcome: "rejected", reason: "rejected" });
  });

  it("infers an outcome when a closed application never recorded one", () => {
    expect(archivable(app({ stage: "closed-won" }), TODAY)?.outcome).toBe("offer_accepted");
    expect(archivable(app({ stage: "closed-lost" }), TODAY)?.outcome).toBe("rejected");
  });

  it("proposes long silence as ghosted", () => {
    const c = archivable(app({ lastUpdated: daysAgo(GHOST_DAYS + 1) }), TODAY);
    expect(c?.outcome).toBe("ghosted");
    expect(c?.reason).toBe(`no reply in ${GHOST_DAYS + 1} days`);
  });

  it("leaves silence alone on the threshold day", () => {
    expect(archivable(app({ lastUpdated: daysAgo(GHOST_DAYS) }), TODAY)).toBeNull();
  });

  it("never proposes an application with a planned next action, however old", () => {
    const live = app({ lastUpdated: daysAgo(200), nextActionDate: inDays(3) });
    expect(archivable(live, TODAY)).toBeNull();
  });

  it("only counts silence against applications actually sent", () => {
    expect(archivable(app({ stage: "lead", lastUpdated: daysAgo(400) }), TODAY)).toBeNull();
    expect(archivable(app({ stage: "interviewing", lastUpdated: daysAgo(400) }), TODAY)).toBeNull();
  });

  it("falls back to the applied date when nothing has been updated", () => {
    expect(archivable(app({ appliedDate: daysAgo(90) }), TODAY)?.outcome).toBe("ghosted");
  });

  it("ignores anything already archived", () => {
    expect(archivable(app({ stage: "closed-lost", bucket: "archive" }), TODAY)).toBeNull();
    expect(archiveCandidates([app({ stage: "closed-lost", bucket: "archive" })], TODAY)).toEqual([]);
  });

  it("survives an unparseable date rather than throwing", () => {
    expect(archivable(app({ lastUpdated: "sometime last spring" }), TODAY)).toBeNull();
  });
});

describe("updateFrontmatter", () => {
  const file = ["---", "company: Acme", "stage: applied", "notes: |", "  line one", "  line two", "---", "", "# Body"].join("\n");

  it("rewrites a key in place, leaving order and body untouched", () => {
    const out = updateFrontmatter(file, { stage: "rejected" });
    expect(out).toContain("company: Acme\nstage: rejected\n");
    expect(out).toContain("# Body");
    expect(out.indexOf("company")).toBeLessThan(out.indexOf("stage"));
  });

  it("does not treat block-scalar continuation lines as keys", () => {
    // "line one" contains no colon, but a naive line loop still walks it.
    const out = updateFrontmatter(file, { stage: "rejected" });
    expect(out).toContain("notes: |\n  line one\n  line two");
  });

  it("appends keys that were missing", () => {
    expect(updateFrontmatter(file, { outcome: "ghosted" })).toContain("outcome: ghosted");
  });

  it("removes a key on null", () => {
    expect(updateFrontmatter(file, { stage: null })).not.toContain("stage:");
  });

  it("creates frontmatter for a file that has none", () => {
    const out = updateFrontmatter("# Just a heading\n", { stage: "applied" });
    expect(out.startsWith("---\nstage: applied\n---\n")).toBe(true);
    expect(out).toContain("# Just a heading");
  });

  it("quotes values that would not survive as bare scalars", () => {
    expect(updateFrontmatter(file, { notes: "12:30 with Sam" })).toContain('notes: "12:30 with Sam"');
  });
});

describe("the to-do list and the archive", () => {
  it("an archived application still computes as overdue", () => {
    // Not a bug in flagsFor: nothing will ever update an archived file, so its
    // next-action date recedes forever. It is a bug to show it, which is why the
    // board filters by bucket before asking for next actions.
    const dead = app({ bucket: "archive", nextActionDate: daysAgo(155) });
    expect(nextActions([dead], TODAY)).toHaveLength(1);
    expect(nextActions([dead].filter((a) => a.bucket === "active"), TODAY)).toHaveLength(0);
  });

  it("does not let old archived items crowd out live ones", () => {
    const apps = [
      app({ slug: "old", bucket: "archive", nextActionDate: daysAgo(155) }),
      app({ slug: "older", bucket: "archive", nextActionDate: daysAgo(125) }),
      app({ slug: "oldest", bucket: "archive", nextActionDate: daysAgo(112) }),
      app({ slug: "live", bucket: "active", nextActionDate: daysAgo(2) }),
    ];
    const shown = nextActions(apps.filter((a) => a.bucket === "active"), TODAY);
    expect(shown.map((x) => x.app.slug)).toEqual(["live"]);
  });
});
