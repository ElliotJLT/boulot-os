import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The master CV, read as a record rather than a document.
 *
 * It is not a CV. It is the log of everything you have done, and a tailored CV
 * is a query against it. That distinction matters for how it should be shown:
 * a document invites you to read it top to bottom, a log invites you to notice
 * what is stale, what is untagged, and what never gets used.
 *
 * Three things are worth surfacing per entry and none of them are the text:
 *
 *   tags      how it gets selected
 *   usage     which applications actually used it
 *   evidence  whether it carries a number
 *
 * An entry that has never been used in eighteen applications is either badly
 * written or genuinely irrelevant, and either way you want to know.
 */

export interface MasterBullet {
  id: string;
  /** Position within its role, as written. */
  index: number;
  text: string;
  tags: string[];
  /** Whether the line carries a figure. Bullets without one convert worse. */
  hasNumber: boolean;
  /** Slugs of applications whose cv.md contains this bullet. */
  usedIn: string[];
}

export interface MasterRole {
  org: string;
  title: string;
  dates: string;
  context: string;
  bullets: MasterBullet[];
  /** Detail kept for interview prep that never prints on a CV. */
  deeperDetail: number;
}

export interface Master {
  path: string;
  /** Last write to the file, which is the honest "last updated". */
  updated: string | null;
  summaryVariants: string[];
  roles: MasterRole[];
  skills: Array<{ category: string; items: string[] }>;
  totals: { bullets: number; tagged: number; withNumbers: number; used: number };
  allTags: Array<{ tag: string; count: number }>;
}

const NUMBERISH = /\d|%|£|\$|\bhalf\b|\bdoubled?\b|\btripled?\b/i;

/** A short, distinctive fragment to look for in tailored CVs. */
function fingerprint(text: string): string {
  return text
    .replace(/`[^`]*`/g, "")
    .replace(/[*_]/g, "")
    .split(/\s+/)
    .slice(0, 8)
    .join(" ")
    .toLowerCase();
}

export function readMaster(personDir: string): Master | null {
  const path = join(personDir, "cv-master.md");
  if (!existsSync(path)) return null;

  const raw = readFileSync(path, "utf8");
  const updated = statSync(path).mtime.toISOString().slice(0, 10);
  const lines = raw.split("\n");

  const roles: MasterRole[] = [];
  const summaryVariants: string[] = [];
  const skills: Array<{ category: string; items: string[] }> = [];

  let section = "";
  let role: MasterRole | null = null;
  let inDeeper = false;

  for (const line of lines) {
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      section = (h2[1] ?? "").toLowerCase();
      role = null;
      inDeeper = false;
      continue;
    }

    // Named summary variants live under "## Summary Variants" as h3s.
    if (section.includes("summary variant")) {
      const h3 = /^###\s+(.*)$/.exec(line);
      if (h3) summaryVariants.push((h3[1] ?? "").trim());
      continue;
    }

    if (section.includes("skills")) {
      const h3 = /^###\s+(.*)$/.exec(line);
      if (h3) skills.push({ category: (h3[1] ?? "").trim(), items: [] });
      else if (skills.length && line.trim() && !line.startsWith("#")) {
        const items = line
          .replace(/`[^`]*`/g, "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        skills.at(-1)?.items.push(...items);
      }
      continue;
    }

    if (!section.includes("experience")) continue;

    const h3 = /^###\s+(.*)$/.exec(line);
    if (h3) {
      const title = (h3[1] ?? "").trim();
      const [org = title, rest = ""] = title.split(/\s+[—–-]\s+/);
      role = { org: org.trim(), title: rest.trim() || org.trim(), dates: "", context: "", bullets: [], deeperDetail: 0 };
      roles.push(role);
      inDeeper = false;
      continue;
    }

    if (!role) continue;

    const h4 = /^####\s+(.*)$/.exec(line);
    if (h4) {
      inDeeper = /deeper|detail|interview/i.test(h4[1] ?? "");
      continue;
    }

    // **Dates** | context
    const meta = /^\*\*(.+?)\*\*\s*\|?\s*(.*)$/.exec(line.trim());
    if (meta && !role.dates) {
      role.dates = (meta[1] ?? "").trim();
      role.context = (meta[2] ?? "").trim();
      continue;
    }

    if (inDeeper) {
      if (/^[-*]\s+/.test(line.trim())) role.deeperDetail += 1;
      continue;
    }

    // Numbered, tag-prefixed bullets: `1. \`#ops #ai\` text`
    const b = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (!b) continue;
    let body = (b[2] ?? "").trim();
    const tags: string[] = [];
    const tagBlock = /^`([^`]*)`\s*/.exec(body);
    if (tagBlock) {
      for (const t of (tagBlock[1] ?? "").split(/\s+/)) if (t.startsWith("#")) tags.push(t.slice(1));
      body = body.slice(tagBlock[0].length).trim();
    }
    role.bullets.push({
      id: `${role.org.toLowerCase().replace(/\W+/g, "-")}:${b[1]}`,
      index: Number(b[1]),
      text: body,
      tags,
      hasNumber: NUMBERISH.test(body),
      usedIn: [],
    });
  }

  // Which tailored CVs actually contain each bullet.
  const cvs: Array<{ slug: string; text: string }> = [];
  for (const bucket of ["active", "archive"]) {
    const dir = join(personDir, bucket);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const cv = join(dir, name, "cv.md");
      if (existsSync(cv)) {
        try {
          cvs.push({ slug: name, text: readFileSync(cv, "utf8").toLowerCase() });
        } catch {
          /* unreadable, skip */
        }
      }
    }
  }
  for (const r of roles) {
    for (const bullet of r.bullets) {
      const fp = fingerprint(bullet.text);
      if (fp.length < 12) continue;
      bullet.usedIn = cvs.filter((c) => c.text.includes(fp)).map((c) => c.slug);
    }
  }

  const all = roles.flatMap((r) => r.bullets);
  const tagCounts = new Map<string, number>();
  for (const b of all) for (const t of b.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);

  return {
    path,
    updated,
    summaryVariants,
    roles,
    skills,
    totals: {
      bullets: all.length,
      tagged: all.filter((b) => b.tags.length).length,
      withNumbers: all.filter((b) => b.hasNumber).length,
      used: all.filter((b) => b.usedIn.length).length,
    },
    allTags: [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count),
  };
}
