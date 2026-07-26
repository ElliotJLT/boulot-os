import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readMaster } from "./master.js";

/**
 * Creating a vault.
 *
 * The app used to render "No vault at /Users/you/Boulot" and stop, which is a
 * dead end wearing the clothes of an error message. Everyone arrives without a
 * vault exactly once, so that path is the most travelled one in the product and
 * it was the only one with no way forward.
 *
 * What is built here is deliberately the skeleton and nothing else. The vault is
 * worth having when it holds the user's actual career, and the only source for
 * that is a CV they already own. Asking someone to hand-write a tagged
 * experience bank before they have seen the app do anything is where people
 * quit, so the structure is created in milliseconds and filled in afterwards
 * from a document they paste.
 */

export interface SetupResult {
  personDir: string;
  created: string[];
  /** True when a vault was already there and nothing was overwritten. */
  existed: boolean;
}

/** Folders every vault has. */
const FOLDERS = ["active", "archive", "stories", "references"] as const;

/**
 * A person's folder name.
 *
 * Kept conservative rather than clever: this becomes a path, and a name with a
 * slash or a colon in it is a bug waiting for someone called O'Brien.
 */
export function personSlug(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
  return cleaned || "ME";
}

function starterMaster(name: string): string {
  return `# Master Experience Bank

Everything you have ever done, in one place. You never send this file. When you
apply for a specific job, Boulot pulls the relevant entries from here and
arranges them into a tailored CV.

Two rules make it work. Put everything in, including things that feel minor,
because Boulot cannot select an entry that does not exist. And know that Boulot
only ever rewords and reorders what is here, never inventing experience, so this
file is the source of truth.

Tag entries with hashtags for the skill area, like \`#ops #ai #regulated\`. Tags
are how tailoring filters for the entries that match a given job.

---

## Summary Variants

### Default

(Two or three sentences describing ${name}. Boulot adapts the closest one per application.)

---

## Experience Bank

### [Company] — [Job title]
**[Start – End]** | [industry, stage, size, anything relevant]

1. \`#tag #tag\` [Something you did, and what changed because you did it. Include a number.]
2. \`#tag\` [Another one.]
`;
}

function starterProfile(name: string): string {
  return `# Profile

Who Boulot is working for. Loaded on every run, so keep it accurate.

## Contact
- Name: ${name}
- Email:
- Phone:
- LinkedIn:
- Location:

## What I am looking for

(Job titles, sectors, company stage, anything you would rule out.)

## Constraints

(Salary floor, notice period, remote or on-site, visa status.)
`;
}

/**
 * Create a vault skeleton for one person.
 *
 * Never overwrites. Someone who runs setup twice, or who points the app at a
 * vault they already have, must not lose a master CV to a starter template.
 */
export function createVault(vaultRoot: string, name: string): SetupResult {
  const slug = personSlug(name);
  const personDir = join(vaultRoot, slug);
  const existed = existsSync(join(personDir, "cv-master.md"));
  const created: string[] = [];

  mkdirSync(personDir, { recursive: true });
  for (const f of FOLDERS) {
    const dir = join(personDir, f);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      // Keep empty folders present for anyone browsing the vault in Finder.
      writeFileSync(join(dir, ".gitkeep"), "");
      created.push(`${f}/`);
    }
  }

  const files: Array<[string, string]> = [
    ["cv-master.md", starterMaster(name)],
    ["profile.md", starterProfile(name)],
  ];
  for (const [file, contents] of files) {
    const path = join(personDir, file);
    if (existsSync(path)) continue;
    writeFileSync(path, contents);
    created.push(file);
  }

  return { personDir, created, existed };
}

/**
 * Whether a vault has anything worth reading.
 *
 * A folder full of headings and placeholders is structurally a vault and
 * practically an empty one, so "has a master CV with at least one numbered
 * entry" is the test rather than "the file exists". It decides whether the app
 * opens on the board or on the import step.
 */
export function vaultIsPopulated(personDir: string): boolean {
  /*
   * Uses the real parser rather than a regex over the file.
   *
   * The first version scanned for a numbered line with enough text on it, which
   * matched the starter template's own instructions ("1. Put everything in,
   * including things that feel minor") and reported every brand new vault as
   * already populated. It also missed that a placeholder entry carries a tag
   * block before its brackets, so `(?!\[)` never fired.
   *
   * readMaster already knows that entries live under Experience and that a tag
   * block is not part of the text. Two parsers for one format is how they drift.
   */
  const master = readMaster(personDir);
  if (!master) return false;
  return master.roles
    .flatMap((r) => r.bullets)
    .some((b) => {
      const text = b.text.trim();
      // "[Something you did, and what changed…]" is the template talking.
      if (text.startsWith("[")) return false;
      return text.length > 30;
    });
}

/** People already set up in this vault. */
export function peopleIn(vaultRoot: string): string[] {
  if (!existsSync(vaultRoot)) return [];
  try {
    return readdirSync(vaultRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .filter((d) => existsSync(join(vaultRoot, d.name, "active")))
      .map((d) => d.name);
  } catch {
    return [];
  }
}
