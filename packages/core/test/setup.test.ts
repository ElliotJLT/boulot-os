import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVault, peopleIn, personSlug, vaultIsPopulated } from "../src/vault/setup.js";

let root = "";
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "boulot-setup-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("personSlug", () => {
  it("makes a name safe to use as a folder", () => {
    expect(personSlug("Elliot Little")).toBe("ELLIOT-LITTLE");
    expect(personSlug("Siobhán O'Brien")).toBe("SIOBHAN-O-BRIEN");
  });

  it("never produces a path traversal or an empty name", () => {
    expect(personSlug("../../etc/passwd")).toBe("ETC-PASSWD");
    expect(personSlug("   ")).toBe("ME");
    expect(personSlug("!!!")).toBe("ME");
  });
});

describe("createVault", () => {
  it("creates the folders and starter files", () => {
    const r = createVault(root, "Ada Lovelace");
    expect(existsSync(join(r.personDir, "active"))).toBe(true);
    expect(existsSync(join(r.personDir, "archive"))).toBe(true);
    expect(existsSync(join(r.personDir, "cv-master.md"))).toBe(true);
    expect(readFileSync(join(r.personDir, "profile.md"), "utf8")).toContain("Ada Lovelace");
    expect(r.existed).toBe(false);
  });

  it("never overwrites an existing master CV", () => {
    const r = createVault(root, "Ada");
    writeFileSync(join(r.personDir, "cv-master.md"), "# mine\n\n1. Something real that I actually did with a number 40%");
    const again = createVault(root, "Ada");
    expect(readFileSync(join(again.personDir, "cv-master.md"), "utf8")).toContain("# mine");
    expect(again.existed).toBe(true);
  });
});

describe("vaultIsPopulated", () => {
  it("is false for a freshly created vault, which is all placeholders", () => {
    expect(vaultIsPopulated(createVault(root, "Ada").personDir)).toBe(false);
  });

  it("is true once a real entry exists", () => {
    const { personDir } = createVault(root, "Ada");
    // Entries only count under an Experience heading, which is where readMaster
    // looks for them. A numbered line anywhere else in the file is prose.
    writeFileSync(join(personDir, "cv-master.md"),
      ["## Experience Bank", "", "### Acme — Engineer", "**2020 – 2024** | fintech", "",
       "1. `#ops` Cut deployment time from two hours to nine minutes across four teams", ""].join("\n"));
    expect(vaultIsPopulated(personDir)).toBe(true);
  });

  it("ignores a numbered line that is prose rather than an entry", () => {
    const { personDir } = createVault(root, "Ada");
    writeFileSync(join(personDir, "cv-master.md"),
      "# Master\n\n1. Put everything in here, including the things that feel minor to you\n");
    expect(vaultIsPopulated(personDir)).toBe(false);
  });

  it("does not count the template's own bracketed placeholder as content", () => {
    const { personDir } = createVault(root, "Ada");
    writeFileSync(join(personDir, "cv-master.md"),
      ["## Experience Bank", "", "### [Company] — [Job title]", "",
       "1. `#tag` [Something you did, and what changed because you did it. Include a number.]", ""].join("\n"));
    expect(vaultIsPopulated(personDir)).toBe(false);
  });
});

describe("peopleIn", () => {
  it("lists set-up people and ignores stray folders", () => {
    createVault(root, "Ada");
    expect(peopleIn(root)).toEqual(["ADA"]);
  });

  it("returns nothing for a vault root that does not exist", () => {
    expect(peopleIn(join(root, "nope"))).toEqual([]);
  });
});
