#!/usr/bin/env node

/**
 * CV PDF Generator — Produces Wozber-identical PDFs from cv.md
 *
 * Usage: node generate-pdf.mjs <path-to-cv.md> [output-path.pdf]
 *
 * Flow: cv.md → parse → HTML/CSS → Puppeteer → PDF
 * Matches Wozber "ATS-friendly" template: split header with green icons,
 * spaced-caps section headers with dotted underline, 2-col skills grid,
 * role title + company separated, education structured.
 */

import { readFileSync, writeFileSync } from "fs";
import puppeteer from "puppeteer";

// ─── Parse Markdown ───────────────────────────────────────────────────

function parseCVMarkdown(md) {
  const lines = md.split("\n");
  const cv = { name: "", subtitle: "", contactParts: [], sections: [] };
  let i = 0;

  // Skip frontmatter
  if (lines[i] && lines[i].trim() === "---") {
    i++;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    i++;
  }
  while (i < lines.length && lines[i].trim() === "") i++;

  // # Name
  if (lines[i] && lines[i].startsWith("# ")) {
    cv.name = lines[i].replace(/^# /, "").trim();
    i++;
  }
  while (i < lines.length && lines[i].trim() === "") i++;

  // **Subtitle**
  if (lines[i] && lines[i].startsWith("**") && lines[i].endsWith("**")) {
    cv.subtitle = lines[i].replace(/^\*\*/, "").replace(/\*\*$/, "").trim();
    i++;
  }
  while (i < lines.length && lines[i].trim() === "") i++;

  // Contact line (pipe-separated)
  if (
    lines[i] &&
    lines[i].includes("|") &&
    (lines[i].includes("@") || lines[i].includes("linkedin"))
  ) {
    cv.contactParts = lines[i].split("|").map((s) => s.trim());
    i++;
  }

  // Parse sections
  let currentSection = null;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "---") {
      i++;
      continue;
    }

    if (line.startsWith("## ")) {
      currentSection = {
        title: line.replace(/^## /, "").trim(),
        entries: [],
        content: [],
      };
      cv.sections.push(currentSection);
      i++;
      continue;
    }

    if (!currentSection) {
      i++;
      continue;
    }

    // ### Entry header (Experience, Education with ### format, Projects)
    if (line.startsWith("### ")) {
      const text = line.replace(/^### /, "").trim();
      let company = "";
      let roleTitle = text;

      if (text.includes(" — ")) {
        const parts = text.split(" — ");
        company = parts[0].trim();
        roleTitle = parts.slice(1).join(" — ").trim();
      }

      const entry = {
        type: "role",
        company,
        roleTitle,
        fullTitle: text,
        dates: "",
        subtitle: "",
        contextLines: [],
        subheaders: [],
        bullets: [],
        paragraphs: [],
      };

      i++;
      while (i < lines.length && lines[i].trim() === "") i++;

      // **dates** | context
      if (i < lines.length && lines[i].startsWith("**")) {
        const dateLine = lines[i].replace(/\*\*/g, "").trim();
        if (dateLine.includes("|")) {
          const parts = dateLine.split("|");
          entry.dates = parts[0].trim();
          entry.subtitle = parts.slice(1).join("|").trim();
        } else {
          entry.dates = dateLine;
        }
        i++;
      }

      // Context lines (non-bold, non-bullet, non-header)
      while (i < lines.length && lines[i].trim() === "") i++;
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !lines[i].startsWith("#") &&
        !lines[i].startsWith("**") &&
        !lines[i].startsWith("- ") &&
        lines[i].trim() !== "---"
      ) {
        entry.contextLines.push(lines[i].trim());
        i++;
      }

      // Parse role body: subheaders, bullets, paragraphs
      let currentSubheader = null;

      while (i < lines.length) {
        const l = lines[i];
        if (l.startsWith("### ") || l.startsWith("## ")) break;
        if (l.trim() === "---") {
          let peek = i + 1;
          while (peek < lines.length && lines[peek].trim() === "") peek++;
          if (
            peek >= lines.length ||
            lines[peek].startsWith("## ") ||
            lines[peek].startsWith("### ")
          )
            break;
          i++;
          continue;
        }

        // Sub-header: **Bold Text** on its own line (no colon)
        if (l.startsWith("**") && l.endsWith("**") && !l.includes(":")) {
          currentSubheader = l.replace(/^\*\*/, "").replace(/\*\*$/, "").trim();
          entry.subheaders.push({
            title: currentSubheader,
            bullets: [],
            paragraphs: [],
          });
          i++;
          continue;
        }

        if (l.startsWith("- ")) {
          const t = l.replace(/^- /, "").trim();
          if (currentSubheader && entry.subheaders.length > 0) {
            entry.subheaders[entry.subheaders.length - 1].bullets.push(t);
          } else {
            entry.bullets.push(t);
          }
          i++;
          continue;
        }

        if (l.trim() !== "") {
          if (currentSubheader && entry.subheaders.length > 0) {
            entry.subheaders[entry.subheaders.length - 1].paragraphs.push(
              l.trim()
            );
          } else {
            entry.paragraphs.push(l.trim());
          }
          i++;
          continue;
        }

        i++;
      }

      currentSection.entries.push(entry);
      continue;
    }

    // Regular content line
    if (line.trim() !== "") {
      currentSection.content.push(line);
    }
    i++;
  }

  // Post-process: parse education/projects content lines into structured entries
  for (const section of cv.sections) {
    const t = section.title.toLowerCase();
    if (
      (t.includes("education") || t.includes("qualifications")) &&
      section.entries.length === 0 &&
      section.content.length > 0
    ) {
      section.entries = parseEducationContent(section.content);
      section.content = [];
    }
  }

  return cv;
}

function parseEducationContent(lines) {
  const entries = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith("**")) {
      if (current) entries.push(current);

      const stripped = line.replace(/\*\*/g, "");
      let title = stripped;
      let dates = "";
      let institution = "";

      if (stripped.includes("|")) {
        const parts = stripped.split("|").map((s) => s.trim());
        title = parts[0];
        const rest = parts.slice(1).join(" | ");

        // Try to extract dates (e.g., "Sep 2025 – Dec 2025", "2019")
        const dateMatch = rest.match(
          /(?:[A-Za-z]+\s+)?\d{4}\s*[–\-]\s*(?:[A-Za-z]+\s+)?\d{4}|(?:[A-Za-z]+\s+)?\d{4}\s*[–\-]\s*Present|\b\d{4}\b/
        );
        if (dateMatch) {
          dates = dateMatch[0].trim();
          institution = rest
            .replace(dateMatch[0], "")
            .replace(/^\s*[|,]\s*/, "")
            .replace(/\s*[|,]\s*$/, "")
            .trim();
        } else {
          institution = rest;
        }
      }

      current = {
        type: "education",
        title,
        roleTitle: title,
        company: institution,
        dates,
        institution,
        subtitle: "",
        contextLines: [],
        subheaders: [],
        bullets: [],
        paragraphs: [],
        description: [],
      };
    } else if (current && line.trim() !== "") {
      current.description.push(line.trim());
    }
  }

  if (current) entries.push(current);
  return entries;
}

// ─── Company URLs ─────────────────────────────────────────────────────

// Optional: map a company or school name to its website, and its logo is looked
// up automatically for the PDF. Leave this empty to skip it — CVs still generate
// fine without it. Add your own, e.g. "acme corp": "https://acme.com".
const COMPANY_URLS = {};

function getCompanyUrl(name) {
  const lower = name.toLowerCase().trim();
  for (const [key, url] of Object.entries(COMPANY_URLS)) {
    if (lower.includes(key) || key.includes(lower)) return url;
  }
  return null;
}

// ─── Contact Icons ────────────────────────────────────────────────────

function classifyContact(part) {
  if (part.match(/^[\d\s\+\-\(\)]+$/) || part.match(/^0\d{3,}/) || part.match(/\(\+\d/))
    return "phone";
  if (part.includes("@")) return "email";
  if (part.includes("linkedin")) return "linkedin";
  if (part.includes("github")) return "github";
  return "location";
}

function contactIcon(type) {
  const c = "#444";
  const w = "2";
  const base = `width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
  switch (type) {
    case "phone":
      return `<svg ${base}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`;
    case "email":
      return `<svg ${base}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>`;
    case "linkedin":
      return `<svg ${base}><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle></svg>`;
    case "github":
      return `<svg ${base}><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>`;
    case "location":
      return `<svg ${base}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>`;
    default:
      return "";
  }
}

// ─── Render helpers ───────────────────────────────────────────────────

function esc(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/--/g, "–");
}

function renderInline(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

// ─── Build HTML ───────────────────────────────────────────────────────

function buildHTML(cv) {
  // Contact
  const contactHTML = cv.contactParts
    .map((part) => {
      const type = classifyContact(part);
      let display = esc(part);
      if (type === "email") {
        display = `<a href="mailto:${esc(part)}" style="color: inherit; text-decoration: none;">${esc(part)}</a>`;
      } else if (type === "linkedin") {
        const url = part.startsWith("http") ? part : `https://${part}`;
        display = `<a href="${esc(url)}" style="color: inherit; text-decoration: none;">${esc(part)}</a>`;
      } else if (type === "github") {
        const url = part.startsWith("http") ? part : `https://${part}`;
        display = `<a href="${esc(url)}" style="color: inherit; text-decoration: none;">${esc(part)}</a>`;
      }
      return `<div class="contact-item">${contactIcon(type)} <span>${display}</span></div>`;
    })
    .join("\n");

  // Sections
  let sectionsHTML = "";

  for (const section of cv.sections) {
    const sectionTitle = section.title.toUpperCase();

    const t = section.title.toLowerCase();

    if (
      (t === "experience" || t === "work experience" || t === "professional experience") &&
      section.entries.length > 0
    ) {
      sectionsHTML += buildExperienceSection(sectionTitle, section);
    } else if (t.includes("education") || t.includes("qualifications")) {
      sectionsHTML += buildEducationSection(sectionTitle, section);
    } else if (t === "skills" || t === "technical skills") {
      sectionsHTML += buildSkillsSection(sectionTitle, section);
    } else if (t === "languages") {
      sectionsHTML += buildLanguagesSection(sectionTitle, section);
    } else if (t === "projects") {
      sectionsHTML += buildProjectsSection(sectionTitle, section);
    } else {
      sectionsHTML += buildGenericSection(sectionTitle, section);
    }
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Inter', 'Calibri', 'Helvetica Neue', Arial, sans-serif;
    color: #2d2d2d;
    font-size: 9.5pt;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  .page {
    width: 210mm;
    padding: 2mm 20mm 6mm 20mm;
  }

  /* ── Header ─────────────────────────────── */

  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24pt;
    padding-bottom: 0;
  }
  .header-left { flex: 1; padding-right: 40pt; }
  .header-right { text-align: right; padding-top: 4pt; }

  .name {
    font-family: 'Inter', 'Calibri', 'Helvetica Neue', Arial, sans-serif;
    font-size: 26pt;
    font-weight: 700;
    color: #1a1a1a;
    letter-spacing: 0.3pt;
    line-height: 1.15;
  }
  .subtitle-line {
    font-size: 10pt;
    font-weight: 400;
    color: #666;
    margin-top: 7pt;
    line-height: 1.4;
  }
  .contact-item {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 7pt;
    font-size: 8.5pt;
    color: #555;
    margin-bottom: 4pt;
  }
  .contact-item svg { flex-shrink: 0; }

  /* ── Sections ───────────────────────────── */

  .section { margin-top: 0; }

  .section-header {
    font-size: 9.5pt;
    font-weight: 700;
    color: #1a1a1a;
    letter-spacing: 0.8pt;
    padding-bottom: 0;
    margin-bottom: 0;
  }
  .section-header-wrap {
    margin-top: 22pt;
    margin-bottom: 12pt;
    break-after: avoid;
  }
  .section-dotted-line {
    border: none;
    border-top: none;
    margin-top: 5pt;
    margin-bottom: 0;
    height: 0;
    background-image: radial-gradient(circle, #ccc 0.8px, transparent 0.8px);
    background-size: 5px 3px;
    background-repeat: repeat-x;
    min-height: 3px;
  }

  /* ── Roles ──────────────────────────────── */

  .role {
    margin-bottom: 14pt;
  }
  .role:first-child { margin-top: 2pt; }

  .role-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 2pt;
    break-after: avoid;
    break-inside: avoid;
  }
  .role-title {
    font-size: 10pt;
    font-weight: 700;
    color: #1a1a1a;
  }
  .role-dates {
    font-size: 9pt;
    font-weight: 400;
    color: #999;
    white-space: nowrap;
    margin-left: 12pt;
  }
  .role-company {
    font-size: 9pt;
    color: #777;
    margin-bottom: 3pt;
    break-before: avoid;
  }
  .role-subtitle {
    font-size: 9pt;
    color: #555;
    margin-bottom: 5pt;
  }
  .role-context {
    font-size: 9pt;
    color: #555;
    margin-bottom: 5pt;
    line-height: 1.45;
  }

  .subheader {
    font-size: 9.5pt;
    font-weight: 600;
    color: #2d2d2d;
    margin-top: 8pt;
    margin-bottom: 3pt;
    break-after: avoid;
  }

  /* ── Body text & bullets ────────────────── */

  .body-text {
    font-size: 9.5pt;
    color: #2d2d2d;
    margin-bottom: 4pt;
    line-height: 1.45;
  }

  ul.bullets {
    list-style: none;
    padding-left: 0;
    margin-bottom: 4pt;
  }
  ul.bullets li {
    font-size: 9.5pt;
    color: #2d2d2d;
    margin-bottom: 4pt;
    line-height: 1.45;
    padding-left: 16pt;
    position: relative;
  }
  ul.bullets li::before {
    content: "•";
    position: absolute;
    left: 4pt;
    color: #666;
    font-size: 10pt;
    line-height: 1.35;
  }

  /* ── Education ──────────────────────────── */

  .edu-entry {
    margin-bottom: 8pt;
    break-inside: avoid;
  }
  .edu-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 1pt;
  }
  .edu-title {
    font-size: 10pt;
    font-weight: 700;
    color: #1a1a1a;
  }
  .edu-dates {
    font-size: 9pt;
    color: #888;
    white-space: nowrap;
    margin-left: 12pt;
  }
  .edu-institution {
    font-size: 9pt;
    color: #555;
    margin-bottom: 2pt;
  }
  .edu-description {
    font-size: 9pt;
    color: #2d2d2d;
    line-height: 1.4;
    margin-bottom: 2pt;
  }

  /* ── Skills grid ────────────────────────── */

  .skills-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6pt 24pt;
  }
  .skill-item {
    font-size: 9pt;
    color: #2d2d2d;
    line-height: 1.4;
  }
  .skill-item strong { font-weight: 600; }

  /* ── Languages ──────────────────────────── */

  .languages-grid {
    display: grid;
    grid-template-columns: auto auto auto auto;
    gap: 4pt 32pt;
    align-items: baseline;
  }
  .lang-name {
    font-size: 9.5pt;
    font-weight: 400;
    color: #2d2d2d;
  }
  .lang-level {
    font-size: 9.5pt;
    color: #555;
  }

  /* ── Projects ───────────────────────────── */

  .project-entry {
    margin-bottom: 6pt;
  }
  .project-entry p {
    font-size: 9pt;
    color: #2d2d2d;
    line-height: 1.4;
  }

  /* ── Print / page breaks ────────────────── */

  @media print {
    body { margin: 0; }
  }

  .page-number {
    position: fixed;
    bottom: 10mm;
    right: 18mm;
    font-size: 8pt;
    color: #aaa;
  }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="header-left">
      <div class="name">${esc(cv.name)}</div>
      <div class="subtitle-line">${esc(cv.subtitle)}</div>
    </div>
    <div class="header-right">
      ${contactHTML}
    </div>
  </div>

  ${sectionsHTML}

</div>
</body>
</html>`;
}

// ─── Section Builders ─────────────────────────────────────────────────

function buildExperienceSection(sectionTitle, section) {
  let entriesHTML = "";

  for (const entry of section.entries) {
    // Use separated company + role title (Wozber style)
    const displayTitle = entry.company ? entry.roleTitle : entry.fullTitle;

    let html = `<div class="role">
      <div class="role-header">
        <div class="role-title">${esc(displayTitle)}</div>
        <div class="role-dates">${esc(entry.dates)}</div>
      </div>`;

    if (entry.company) {
      const companyUrl = getCompanyUrl(entry.company);
      if (companyUrl) {
        html += `<div class="role-company"><a href="${companyUrl}" style="color: inherit; text-decoration: none;">${esc(entry.company)}</a> <span style="font-size: 6.5pt; color: #bbb; font-weight: 400; position: relative; top: -1pt;">↗</span></div>`;
      } else {
        html += `<div class="role-company">${esc(entry.company)}</div>`;
      }
    }
    if (entry.subtitle) {
      html += `<div class="role-subtitle">${esc(entry.subtitle)}</div>`;
    }
    for (const ctx of entry.contextLines) {
      html += `<div class="role-context">${esc(ctx)}</div>`;
    }

    // Top-level paragraphs
    for (const para of entry.paragraphs) {
      html += `<p class="body-text">${renderInline(para)}</p>`;
    }

    // Top-level bullets
    if (entry.bullets.length > 0) {
      html += `<ul class="bullets">`;
      for (const b of entry.bullets) {
        html += `<li>${renderInline(b)}</li>`;
      }
      html += `</ul>`;
    }

    // Sub-headers with their content
    for (const sub of entry.subheaders) {
      html += `<div class="subheader">${esc(sub.title)}</div>`;
      for (const para of sub.paragraphs) {
        html += `<p class="body-text">${renderInline(para)}</p>`;
      }
      if (sub.bullets.length > 0) {
        html += `<ul class="bullets">`;
        for (const b of sub.bullets) {
          html += `<li>${renderInline(b)}</li>`;
        }
        html += `</ul>`;
      }
    }

    html += `</div>`;
    entriesHTML += html;
  }

  return `<div class="section">
    <div class="section-header-wrap"><div class="section-header">${sectionTitle}</div><hr class="section-dotted-line"></div>
    ${entriesHTML}
  </div>`;
}

function buildEducationSection(sectionTitle, section) {
  let entriesHTML = "";

  // Education entries from ### parsing or from content parsing
  for (const entry of section.entries) {
    // For ### parsed entries: company = course name (before —), roleTitle = institution (after —)
    // For education, the course name should be the display title, institution below
    const displayTitle = entry.company
      ? entry.company  // course name (first part before —)
      : entry.title || entry.fullTitle || entry.roleTitle;
    const institution = entry.company
      ? entry.roleTitle  // institution (second part after —)
      : entry.institution || "";

    entriesHTML += `<div class="edu-entry">
      <div class="edu-header">
        <div class="edu-title">${esc(displayTitle)}</div>
        ${entry.dates ? `<div class="edu-dates">${esc(entry.dates)}</div>` : ""}
      </div>`;

    if (institution) {
      const eduUrl = getCompanyUrl(institution);
      if (eduUrl) {
        entriesHTML += `<div class="edu-institution"><a href="${eduUrl}" style="color: inherit; text-decoration: none;">${esc(institution)}</a> <span style="font-size: 6.5pt; color: #bbb; font-weight: 400; position: relative; top: -1pt;">↗</span></div>`;
      } else {
        entriesHTML += `<div class="edu-institution">${esc(institution)}</div>`;
      }
    }
    if (entry.subtitle) {
      const subUrl = getCompanyUrl(entry.subtitle);
      if (subUrl) {
        entriesHTML += `<div class="edu-institution"><a href="${subUrl}" style="color: inherit; text-decoration: none;">${esc(entry.subtitle)}</a> <span style="font-size: 6.5pt; color: #bbb; font-weight: 400; position: relative; top: -1pt;">↗</span></div>`;
      } else {
        entriesHTML += `<div class="edu-institution">${esc(entry.subtitle)}</div>`;
      }
    }

    // Description lines (from content parsing)
    if (entry.description && entry.description.length > 0) {
      for (const d of entry.description) {
        entriesHTML += `<div class="edu-description">${renderInline(d)}</div>`;
      }
    }

    // Paragraphs (from ### parsing)
    for (const para of entry.paragraphs) {
      entriesHTML += `<div class="edu-description">${renderInline(para)}</div>`;
    }

    // Context lines
    for (const ctx of entry.contextLines) {
      entriesHTML += `<div class="edu-description">${renderInline(ctx)}</div>`;
    }

    entriesHTML += `</div>`;
  }

  // Any remaining content lines
  for (const line of section.content) {
    entriesHTML += `<p class="body-text">${renderInline(line)}</p>`;
  }

  return `<div class="section">
    <div class="section-header-wrap"><div class="section-header">${sectionTitle}</div><hr class="section-dotted-line"></div>
    ${entriesHTML}
  </div>`;
}

function buildSkillsSection(sectionTitle, section) {
  let itemsHTML = "";
  for (const line of section.content) {
    itemsHTML += `<div class="skill-item">${renderInline(line)}</div>`;
  }

  return `<div class="section">
    <div class="section-header-wrap"><div class="section-header">${sectionTitle}</div><hr class="section-dotted-line"></div>
    <div class="skills-grid">${itemsHTML}</div>
  </div>`;
}

function buildLanguagesSection(sectionTitle, section) {
  let langHTML = '<div class="languages-grid">';

  for (const line of section.content) {
    const parts = line.split("|").map((s) => s.trim());
    for (const part of parts) {
      const colonIdx = part.indexOf(":");
      if (colonIdx > -1) {
        const lang = part.substring(0, colonIdx).trim();
        const level = part.substring(colonIdx + 1).trim();
        langHTML += `<span class="lang-name">${esc(lang)}</span><span class="lang-level">${esc(level)}</span>`;
      } else {
        // No colon — try "Language (Level)" format
        const parenMatch = part.match(/^(.+?)\s*\((.+?)\)$/);
        if (parenMatch) {
          langHTML += `<span class="lang-name">${esc(parenMatch[1])}</span><span class="lang-level">${esc(parenMatch[2])}</span>`;
        } else {
          langHTML += `<span class="lang-name">${esc(part)}</span><span class="lang-level"></span>`;
        }
      }
    }
  }

  langHTML += "</div>";

  return `<div class="section">
    <div class="section-header-wrap"><div class="section-header">${sectionTitle}</div><hr class="section-dotted-line"></div>
    ${langHTML}
  </div>`;
}

function buildProjectsSection(sectionTitle, section) {
  let contentHTML = "";

  // Projects in content lines: **name** (url) — description
  for (const line of section.content) {
    contentHTML += `<div class="project-entry"><p>${renderInline(line)}</p></div>`;
  }

  // Projects as entries (### format)
  for (const entry of section.entries) {
    contentHTML += `<div class="project-entry">`;
    contentHTML += `<p><strong>${esc(entry.fullTitle)}</strong></p>`;
    for (const para of entry.paragraphs) {
      contentHTML += `<p class="body-text">${renderInline(para)}</p>`;
    }
    for (const b of entry.bullets) {
      contentHTML += `<p class="body-text">• ${renderInline(b)}</p>`;
    }
    contentHTML += `</div>`;
  }

  return `<div class="section">
    <div class="section-header-wrap"><div class="section-header">${sectionTitle}</div><hr class="section-dotted-line"></div>
    ${contentHTML}
  </div>`;
}

function buildGenericSection(sectionTitle, section) {
  let contentHTML = "";

  for (const line of section.content) {
    if (line.startsWith("- ")) {
      contentHTML += `<ul class="bullets"><li>${renderInline(line.replace(/^- /, ""))}</li></ul>`;
    } else {
      contentHTML += `<p class="body-text">${renderInline(line)}</p>`;
    }
  }

  // If this generic section has entries (from ### parsing)
  for (const entry of section.entries) {
    contentHTML += `<div class="role">
      <div class="role-header">
        <div class="role-title">${esc(entry.fullTitle)}</div>
        ${entry.dates ? `<div class="role-dates">${esc(entry.dates)}</div>` : ""}
      </div>`;
    for (const para of entry.paragraphs) {
      contentHTML += `<p class="body-text">${renderInline(para)}</p>`;
    }
    if (entry.bullets.length > 0) {
      contentHTML += `<ul class="bullets">`;
      for (const b of entry.bullets) {
        contentHTML += `<li>${renderInline(b)}</li>`;
      }
      contentHTML += `</ul>`;
    }
    contentHTML += `</div>`;
  }

  return `<div class="section">
    <div class="section-header-wrap"><div class="section-header">${sectionTitle}</div><hr class="section-dotted-line"></div>
    ${contentHTML}
  </div>`;
}

// ─── Main ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("Usage: node generate-pdf.mjs <cv.md> [output.pdf]");
  process.exit(1);
}

const inputPath = args[0];
const outputPath = args[1] || inputPath.replace(/\.md$/, ".pdf");

console.log(`Reading: ${inputPath}`);
const markdown = readFileSync(inputPath, "utf-8");

console.log("Parsing CV markdown...");
const cv = parseCVMarkdown(markdown);
console.log(`  Name: ${cv.name}`);
console.log(`  Subtitle: ${cv.subtitle}`);
console.log(
  `  Sections: ${cv.sections.map((s) => `${s.title} (${s.entries.length} entries, ${s.content.length} content)`).join(", ")}`
);

console.log("Building HTML...");
const html = buildHTML(cv);

// Save HTML for debugging
const htmlPath = outputPath.replace(/\.pdf$/, ".html");
writeFileSync(htmlPath, html);
console.log(`  HTML: ${htmlPath}`);

console.log("Launching browser...");
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();

await page.setContent(html, { waitUntil: "networkidle0" });

// Wait for fonts to load before generating PDF
await page.evaluate(() => document.fonts.ready);
await new Promise(r => setTimeout(r, 1000));

console.log("Generating PDF...");
await page.pdf({
  path: outputPath,
  format: "A4",
  printBackground: true,
  margin: { top: "18mm", bottom: "12mm", left: 0, right: 0 },
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="width: 100%; text-align: right; font-size: 8pt; color: #aaa; padding-right: 20mm; font-family: 'Inter', 'Calibri', Arial, sans-serif;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
});

await browser.close();

const stats = readFileSync(outputPath);
console.log(`Written: ${outputPath} (${(stats.length / 1024).toFixed(1)}KB)`);
