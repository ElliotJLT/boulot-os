import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { Application, normaliseStage, type Flags } from "../schema/status.js";
import { normaliseSource } from "../learning/funnel.js";

/**
 * Read applications from a vault.
 *
 * Deliberately lenient. Every real vault has files that drifted from the
 * format, and the correct response is to surface them for review, never to
 * drop them. Anything that cannot be normalised lands in `warnings` and the
 * record still comes back.
 */

/** Minimal YAML frontmatter reader. Enough for flat key/value plus block scalars. */
export function parseFrontmatter(text: string): { data: Record<string, string>; body: string } {
  if (!text.startsWith("---")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: text };

  const raw = text.slice(text.indexOf("\n") + 1, end);
  const body = text.slice(end + 4).replace(/^\n/, "");
  const data: Record<string, string> = {};

  let currentKey: string | null = null;
  const blockLines: string[] = [];

  const flush = () => {
    if (currentKey && blockLines.length) data[currentKey] = blockLines.join("\n").trim();
    currentKey = null;
    blockLines.length = 0;
  };

  for (const line of raw.split("\n")) {
    // Continuation of a `key: |` block scalar.
    if (currentKey && (line.startsWith("  ") || line.trim() === "")) {
      blockLines.push(line.replace(/^ {2}/, ""));
      continue;
    }
    flush();

    const m = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key = "", value = ""] = m;
    if (value === "|" || value === ">") {
      currentKey = key;
    } else {
      data[key] = value.replace(/^["']|["']$/g, "").trim();
    }
  }
  flush();

  return { data, body };
}

/**
 * Read the first populated key.
 *
 * Treats the literal strings "null" and "none" as absent. They appear in real
 * files because a template placeholder got serialised rather than removed, and
 * rendering the word "null" on a card looks like a bug in the app rather than
 * a gap in the data.
 */
const pick = (d: Record<string, string>, ...keys: string[]): string | null => {
  for (const k of keys) {
    const v = d[k]?.trim();
    if (v && !/^(null|none|undefined)$/i.test(v)) return v;
  }
  return null;
};

/**
 * Present a company name.
 *
 * Folder slugs leak into the `company:` field often enough that the board was
 * showing "lloyds-banking-group" and "fitxr" next to properly written names.
 * Only reformat when the value still looks like a slug, so a deliberately
 * lowercase brand ("ema", "kota") that was actually typed that way survives
 * only if it carries no slug markers.
 */
export function displayCompany(raw: string, slug: string): string {
  // Slug-shaped means all lowercase. Matching the folder name is the common
  // case but not required: one real record carries company "lloyds-banking-
  // group" in a folder called "lloyds-innovation", and it should still render
  // as a company name.
  const slugShaped = raw === raw.toLowerCase() && (raw.includes("-") || raw === slug);
  if (!slugShaped) return raw;

  return raw
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Turn one status.md into an Application. Never throws. */
export function readApplication(
  path: string,
  fallbackSlug?: string,
  bucket: "active" | "archive" = "active",
): Application {
  const warnings: string[] = [];
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    warnings.push("could not read file");
  }

  const { data, body } = parseFrontmatter(text);
  if (Object.keys(data).length === 0 && text.trim()) {
    warnings.push("no frontmatter; fields inferred from filename and body");
  }

  const slug = fallbackSlug ?? basename(path.replace(/\/status\.md$/, ""));
  const norm = normaliseStage(pick(data, "stage"));

  if (!norm.matched && pick(data, "stage")) {
    warnings.push(`unrecognised stage "${pick(data, "stage")}" - preserved as substage`);
  }
  if (!norm.matched && !pick(data, "stage")) {
    warnings.push("no stage field");
  }

  const flags: Flags = { onHold: false, atRisk: false, awaitingResponse: false };
  if (norm.flag) flags[norm.flag] = true;

  // A company that fell out of frontmatter is recoverable from the folder name,
  // which is how these are created in the first place.
  const company =
    pick(data, "company") ??
    slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  if (!pick(data, "company")) warnings.push("company inferred from folder name");

  const parsed = Application.safeParse({
    slug,
    company: displayCompany(company, slug),
    role: pick(data, "role") ?? "",
    stage: norm.stage ?? "lead",
    substage: norm.substage,
    outcome: norm.outcome,
    flags,
    appliedDate: pick(data, "applied_date"),
    stageChanged: pick(data, "stage_changed"),
    lastUpdated: pick(data, "last_updated", "updated"),
    nextActionDate: pick(data, "next_action_date"),
    nextAction: pick(data, "next_action"),
    salary: pick(data, "salary", "salary_range"),
    targetSalary: pick(data, "salary_target"),
    url: pick(data, "url", "link", "greenhouse_url"),
    source: (() => {
      const s = normaliseSource(pick(data, "source"));
      return s === "unknown" ? null : s;
    })(),
    location: pick(data, "location"),
    notes: pick(data, "notes") ?? (body.trim() ? body.trim().slice(0, 500) : null),
    bucket,
    path,
    warnings,
  });

  if (parsed.success) return parsed.data;

  // Should be unreachable given the defaults above, but a vault reader that
  // throws on one odd file is useless. Degrade to a minimal record.
  return Application.parse({
    slug,
    company: slug,
    stage: "lead",
    bucket,
    path,
    warnings: [...warnings, `schema: ${parsed.error.issues[0]?.message ?? "invalid"}`],
  });
}

const dirs = (p: string): string[] => {
  if (!existsSync(p)) return [];
  return readdirSync(p)
    .filter((n) => !n.startsWith("."))
    .map((n) => join(p, n))
    .filter((f) => statSync(f).isDirectory());
};

export interface VaultRead {
  applications: Application[];
  /** Folders that look like applications but have no status.md. */
  skipped: string[];
}

/** Read `active/` and `archive/` under a person's folder. */
export function readVault(personDir: string): VaultRead {
  const applications: Application[] = [];
  const skipped: string[] = [];

  for (const bucket of ["active", "archive"] as const) {
    for (const dir of dirs(join(personDir, bucket))) {
      const status = join(dir, "status.md");
      if (existsSync(status)) applications.push(readApplication(status, undefined, bucket));
      else skipped.push(dir);
    }
  }

  return { applications, skipped };
}
