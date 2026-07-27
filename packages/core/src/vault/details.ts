import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The block at the top of every CV, and the name on every file you send.
 *
 * These live in `profile.md` because that is where the agent reads them from,
 * but nobody should have to open a markdown file to correct a phone number, and
 * getting it wrong is expensive in a way most mistakes here are not: a CV with a
 * stale email is a CV nobody can reply to.
 *
 * Stored as prose rather than as a settings record, so the file stays readable
 * on its own and the app is not the only thing that can make sense of it.
 */

export interface Details {
  name: string;
  headline: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  location: string;
  /**
   * How a downloaded PDF is named.
   *
   * `{name}`, `{role}` and `{company}` are substituted. Kept as a pattern
   * rather than a fixed format because the right filename is the one the
   * recipient can find again, and different people file things differently.
   */
  filename: string;
  /*
   * What you will not take, written down before you are tempted.
   *
   * These exist because the expensive part of a bad application is not the
   * tokens, it is the evening. A role paying twenty thousand less than you can
   * accept, in a city you will not move to, at a company you have already
   * decided against, costs a research pass and an hour of reading before you
   * remember any of that. Written down once, they are checked before the work
   * starts rather than remembered afterwards.
   *
   * Free text rather than structured fields on purpose. "£90k, or £80k with
   * real equity" is a real constraint and no number picker can hold it, and the
   * thing reading these is a language model.
   */
  minSalary: string;
  /** Where you will and will not work: "London or remote, no relocation". */
  locationRules: string;
  avoid: string;
}

export const DEFAULT_FILENAME = "{name} - {role} (CV)";

const FIELDS: Array<[keyof Details, string]> = [
  ["name", "Name"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["linkedin", "LinkedIn"],
  ["github", "GitHub"],
  ["location", "Location"],
  ["headline", "Headline"],
  ["filename", "Filename"],
  ["minSalary", "Minimum salary"],
  ["locationRules", "Location rules"],
  ["avoid", "Will not apply to"],
];

const empty = (): Details => ({
  name: "",
  headline: "",
  email: "",
  phone: "",
  linkedin: "",
  github: "",
  location: "",
  filename: DEFAULT_FILENAME,
  minSalary: "",
  locationRules: "",
  avoid: "",
});

/**
 * The name, from wherever it is already written.
 *
 * Existing vaults have no "Name:" field, because the name has only ever been a
 * heading. The master record is checked first and usually fails: its heading is
 * "Master Experience Bank", which is the template's title rather than a person.
 * A CV that has actually been sent always opens with the real name, so that is
 * the fallback that works on a vault someone has been using for months.
 */
function findName(personDir: string): string {
  const headingOf = (path: string): string => {
    try {
      const h = /^#\s+(.+)$/m.exec(readFileSync(path, "utf8"))?.[1]?.trim() ?? "";
      // Filter the template's own titles and anything that reads as a document.
      return /master|experience bank|profile|^cv\b|curriculum/i.test(h) ? "" : h;
    } catch {
      return "";
    }
  };

  const master = join(personDir, "cv-master.md");
  if (existsSync(master)) {
    const found = headingOf(master);
    if (found) return found;
  }

  // The most recently written CV, because that is the name currently going out.
  const candidates: Array<{ path: string; at: number }> = [];
  for (const bucket of ["active", "archive"]) {
    const dir = join(personDir, bucket);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const cv = join(dir, name, "cv.md");
      try {
        if (existsSync(cv)) candidates.push({ path: cv, at: statSync(cv).mtimeMs });
      } catch {
        /* unreadable, skip */
      }
    }
  }
  for (const c of candidates.sort((a, b) => b.at - a.at)) {
    const found = headingOf(c.path);
    if (found) return found;
  }
  return "";
}

/** Read the contact block out of profile.md. */
export function readDetails(personDir: string): Details {
  const path = join(personDir, "profile.md");
  const out = empty();
  if (!existsSync(path)) return out;

  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return out;
  }

  for (const [key, label] of FIELDS) {
    // "- Email: someone@example.com", tolerant of the dash and the spacing.
    const m = new RegExp(`^\\s*[-*]?\\s*${label}\\s*:\\s*(.+)$`, "im").exec(text);
    const value = m?.[1]?.trim();
    if (value) out[key] = value;
  }
  /*
   * Find the name rather than demand it.
   *
   * Existing vaults have no "Name:" line, because the name was only ever the
   * "# Elliot Little" heading at the top of the master record. Asking someone
   * to retype something the vault already knows, to fix a filename that reads
   * "CV - Technical Product Lead", is the kind of setup step that makes a tool
   * feel like paperwork.
   */
  if (!out.name) out.name = findName(personDir);

  if (!out.filename) out.filename = DEFAULT_FILENAME;
  return out;
}

/**
 * Write the contact block back, in place.
 *
 * Rewrites the lines it owns and leaves everything else in the file untouched,
 * because profile.md carries a great deal more than contact details and none of
 * it belongs to this screen.
 */
export function writeDetails(personDir: string, next: Partial<Details>): Details {
  const path = join(personDir, "profile.md");
  let text = existsSync(path) ? readFileSync(path, "utf8") : "# Profile\n\n## Contact\n";

  for (const [key, label] of FIELDS) {
    const value = next[key];
    if (value === undefined) continue;
    const line = new RegExp(`^(\\s*[-*]?\\s*${label}\\s*:).*$`, "im");
    if (line.test(text)) {
      text = text.replace(line, `$1 ${value}`.trimEnd());
      continue;
    }
    // A field the file has never carried goes under Contact, or at the end.
    const contact = /^##\s*Contact\s*$/im.exec(text);
    if (contact) {
      const at = contact.index + contact[0].length;
      text = `${text.slice(0, at)}\n- ${label}: ${value}`.concat(text.slice(at));
    } else {
      text = `${text.trimEnd()}\n- ${label}: ${value}\n`;
    }
  }

  writeFileSync(path, text);
  return readDetails(personDir);
}

/**
 * The filename for a download.
 *
 * Sanitised rather than trusted: a role like "Product Manager / Applied AI"
 * carries a slash, and a slash in a filename is a directory nobody asked for.
 */
export function downloadName(
  details: Details,
  { role, company }: { role?: string | undefined; company?: string | undefined },
): string {
  const clean = (s: string) => s.replace(/[/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  const filled = (details.filename || DEFAULT_FILENAME)
    .replace(/\{name\}/gi, details.name || "CV")
    .replace(/\{role\}/gi, role || "")
    .replace(/\{company\}/gi, company || "");
  // A missing role leaves "Elliot Little -  (CV)", so tidy the seams.
  const tidy = clean(filled).replace(/\s*-\s*(?=\()/, " ").replace(/-\s*$/, "").trim();
  return `${tidy || "CV"}.pdf`;
}
