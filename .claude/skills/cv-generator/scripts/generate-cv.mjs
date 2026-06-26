#!/usr/bin/env node

/**
 * CV Generator — Reads a cv.md from the Boulot vault and generates a .docx
 * matching the Wozber-style clean single-column layout.
 *
 * Usage: node generate-cv.mjs <path-to-cv.md> [output-path.docx]
 */

import { readFileSync, writeFileSync } from "fs";
import { dirname, join, basename } from "path";

// Dynamic import for docx — installed locally in the skill's scripts dir
const docx = await import("docx");
const {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  TabStopPosition,
  TabStopType,
  Packer,
  SectionType,
  convertInchesToTwip,
  Table,
  TableRow,
  TableCell,
  WidthType,
  TableBorders,
} = docx;

// ─── Config ───────────────────────────────────────────────────────────────────
const FONT_BODY = "Calibri";
const FONT_HEADING = "Calibri";
const FONT_NAME = "Calibri";

const SIZE_NAME = 48; // 24pt (half-points)
const SIZE_SUBTITLE = 22; // 11pt
const SIZE_SECTION_HEADER = 22; // 11pt
const SIZE_BODY = 20; // 10pt
const SIZE_ROLE_TITLE = 22; // 11pt
const SIZE_COMPANY = 20; // 10pt
const SIZE_SUBHEADER = 20; // 10pt
const SIZE_CONTACT = 18; // 9pt

const COLOR_PRIMARY = "2D2D2D";
const COLOR_SECONDARY = "555555";
const COLOR_ACCENT = "333333";
const COLOR_LIGHT = "888888";

const MARGIN_TOP = convertInchesToTwip(0.6);
const MARGIN_BOTTOM = convertInchesToTwip(0.5);
const MARGIN_LEFT = convertInchesToTwip(0.7);
const MARGIN_RIGHT = convertInchesToTwip(0.7);

// ─── Parse Markdown ───────────────────────────────────────────────────────────

function parseCVMarkdown(md) {
  const lines = md.split("\n");
  const cv = {
    name: "",
    subtitle: "",
    contact: "",
    sections: [],
  };

  let i = 0;

  // Skip frontmatter if present
  if (lines[i] && lines[i].trim() === "---") {
    i++;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    i++;
  }

  // Skip blank lines
  while (i < lines.length && lines[i].trim() === "") i++;

  // # Name
  if (lines[i] && lines[i].startsWith("# ")) {
    cv.name = lines[i].replace(/^# /, "").trim();
    i++;
  }

  // Skip blank lines
  while (i < lines.length && lines[i].trim() === "") i++;

  // **Subtitle**
  if (lines[i] && lines[i].startsWith("**") && lines[i].endsWith("**")) {
    cv.subtitle = lines[i].replace(/^\*\*/, "").replace(/\*\*$/, "").trim();
    i++;
  }

  // Skip blank lines
  while (i < lines.length && lines[i].trim() === "") i++;

  // Contact line (pipe-separated)
  if (lines[i] && lines[i].includes("|") && lines[i].includes("@")) {
    cv.contact = lines[i].trim();
    i++;
  }

  // Now parse sections (## headers)
  let currentSection = null;

  while (i < lines.length) {
    const line = lines[i];

    // Skip horizontal rules
    if (line.trim() === "---") {
      i++;
      continue;
    }

    // ## Section header
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

    // ### Role entry (Experience section)
    if (line.startsWith("### ")) {
      const roleText = line.replace(/^### /, "").trim();
      // Parse "Company — Title" or just the raw text
      let company = "";
      let title = roleText;
      if (roleText.includes(" — ")) {
        const parts = roleText.split(" — ");
        company = parts[0].trim();
        title = parts.slice(1).join(" — ").trim();
      }

      const entry = {
        type: "role",
        company,
        title: roleText,
        dates: "",
        subtitle: "",
        subheaders: [],
        bullets: [],
        paragraphs: [],
      };

      i++;

      // Next line(s): **dates** | subtitle
      while (i < lines.length && lines[i].trim() === "") i++;

      if (i < lines.length && lines[i].startsWith("**")) {
        const dateLine = lines[i].replace(/\*\*/g, "").trim();
        // Check if there's a | separator for subtitle info
        if (dateLine.includes("|")) {
          const parts = dateLine.split("|");
          entry.dates = parts[0].trim();
          entry.subtitle = parts.slice(1).join("|").trim();
        } else {
          entry.dates = dateLine;
        }
        i++;
      }

      // Next line might be a non-bold subtitle (e.g. "Enterprise partners: ...")
      while (i < lines.length && lines[i].trim() === "") i++;
      if (
        i < lines.length &&
        !lines[i].startsWith("#") &&
        !lines[i].startsWith("**") &&
        !lines[i].startsWith("-") &&
        !lines[i].startsWith("---") &&
        lines[i].trim() !== ""
      ) {
        // Check if it's a standalone context line (not bold)
        if (!lines[i].startsWith("*")) {
          entry.subtitle += (entry.subtitle ? "\n" : "") + lines[i].trim();
          i++;
        }
      }

      // Parse role content: sub-headers (**bold text**), bullets, paragraphs
      let currentSubheader = null;

      while (i < lines.length) {
        const l = lines[i];

        // Stop at next role, section, or horizontal rule followed by section
        if (l.startsWith("### ") || l.startsWith("## ")) break;
        if (l.trim() === "---") {
          // Peek ahead — if next non-blank line is ## or ###, stop
          let peek = i + 1;
          while (peek < lines.length && lines[peek].trim() === "") peek++;
          if (
            peek >= lines.length ||
            lines[peek].startsWith("## ") ||
            lines[peek].startsWith("### ")
          ) {
            break;
          }
          i++;
          continue;
        }

        // Sub-header: **Bold Text** on its own line (not a bullet, not a skill line with colon)
        if (
          l.startsWith("**") &&
          l.endsWith("**") &&
          !l.includes(":")
        ) {
          currentSubheader = l.replace(/^\*\*/, "").replace(/\*\*$/, "").trim();
          entry.subheaders.push({
            title: currentSubheader,
            bullets: [],
            paragraphs: [],
          });
          i++;
          continue;
        }

        // Bullet point
        if (l.startsWith("- ")) {
          const bulletText = l.replace(/^- /, "").trim();
          if (currentSubheader && entry.subheaders.length > 0) {
            entry.subheaders[entry.subheaders.length - 1].bullets.push(bulletText);
          } else {
            entry.bullets.push(bulletText);
          }
          i++;
          continue;
        }

        // Paragraph text (non-empty, non-special)
        if (l.trim() !== "") {
          const paraText = l.trim();
          if (currentSubheader && entry.subheaders.length > 0) {
            entry.subheaders[entry.subheaders.length - 1].paragraphs.push(paraText);
          } else {
            entry.paragraphs.push(paraText);
          }
          i++;
          continue;
        }

        i++;
      }

      currentSection.entries.push(entry);
      continue;
    }

    // Regular content (for sections like Summary, Education, Skills, Languages)
    if (line.trim() !== "") {
      currentSection.content.push(line);
    }
    i++;
  }

  return cv;
}

// ─── Build Document ───────────────────────────────────────────────────────────

function spacedCaps(text) {
  return text.toUpperCase().split("").join(" ");
}

function sectionHeader(text) {
  return new Paragraph({
    spacing: { before: 300, after: 80 },
    border: {
      bottom: {
        style: BorderStyle.DOT_DOT_DASH,
        size: 1,
        color: "CCCCCC",
        space: 4,
      },
    },
    children: [
      new TextRun({
        text: spacedCaps(text),
        font: FONT_HEADING,
        size: SIZE_SECTION_HEADER,
        bold: true,
        color: COLOR_PRIMARY,
        characterSpacing: 60,
      }),
    ],
  });
}

function parseInlineBold(text) {
  // Parse **bold** segments within text and return TextRun array
  const runs = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(
        new TextRun({
          text: text.slice(lastIndex, match.index),
          font: FONT_BODY,
          size: SIZE_BODY,
          color: COLOR_PRIMARY,
        })
      );
    }
    runs.push(
      new TextRun({
        text: match[1],
        font: FONT_BODY,
        size: SIZE_BODY,
        bold: true,
        color: COLOR_PRIMARY,
      })
    );
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    runs.push(
      new TextRun({
        text: text.slice(lastIndex),
        font: FONT_BODY,
        size: SIZE_BODY,
        color: COLOR_PRIMARY,
      })
    );
  }

  return runs;
}

function bulletParagraph(text) {
  return new Paragraph({
    spacing: { before: 40, after: 40 },
    indent: { left: convertInchesToTwip(0.25), hanging: convertInchesToTwip(0.2) },
    children: [
      new TextRun({
        text: "•  ",
        font: FONT_BODY,
        size: SIZE_BODY,
        color: COLOR_SECONDARY,
      }),
      ...parseInlineBold(text),
    ],
  });
}

function bodyParagraph(text, options = {}) {
  return new Paragraph({
    spacing: { before: options.spaceBefore || 40, after: options.spaceAfter || 40 },
    children: parseInlineBold(text),
  });
}

function buildHeader(cv) {
  const contactParts = cv.contact.split("|").map((s) => s.trim());

  const paragraphs = [];

  // Name line with contact info using tab stops
  // We'll do name on one line, subtitle on next, then contact separately
  paragraphs.push(
    new Paragraph({
      spacing: { after: 0 },
      children: [
        new TextRun({
          text: cv.name,
          font: FONT_NAME,
          size: SIZE_NAME,
          bold: true,
          color: COLOR_PRIMARY,
        }),
      ],
    })
  );

  if (cv.subtitle) {
    paragraphs.push(
      new Paragraph({
        spacing: { before: 20, after: 60 },
        children: [
          new TextRun({
            text: cv.subtitle,
            font: FONT_BODY,
            size: SIZE_SUBTITLE,
            color: COLOR_SECONDARY,
          }),
        ],
      })
    );
  }

  // Contact as single line, pipe-separated
  if (contactParts.length > 0) {
    paragraphs.push(
      new Paragraph({
        spacing: { before: 0, after: 200 },
        children: contactParts.flatMap((part, idx) => {
          const runs = [
            new TextRun({
              text: part,
              font: FONT_BODY,
              size: SIZE_CONTACT,
              color: COLOR_SECONDARY,
            }),
          ];
          if (idx < contactParts.length - 1) {
            runs.push(
              new TextRun({
                text: "  |  ",
                font: FONT_BODY,
                size: SIZE_CONTACT,
                color: COLOR_LIGHT,
              })
            );
          }
          return runs;
        }),
      })
    );
  }

  return paragraphs;
}

function buildExperienceSection(section) {
  const paragraphs = [sectionHeader(section.title)];

  for (const entry of section.entries) {
    // Role title + date on same line
    const titleRuns = [
      new TextRun({
        text: entry.title,
        font: FONT_BODY,
        size: SIZE_ROLE_TITLE,
        bold: true,
        color: COLOR_PRIMARY,
      }),
    ];

    if (entry.dates) {
      titleRuns.push(
        new TextRun({
          text: "\t" + entry.dates,
          font: FONT_BODY,
          size: SIZE_BODY,
          color: COLOR_SECONDARY,
        })
      );
    }

    paragraphs.push(
      new Paragraph({
        spacing: { before: 240, after: 0 },
        tabStops: [
          {
            type: TabStopType.RIGHT,
            position: TabStopPosition.MAX,
          },
        ],
        children: titleRuns,
      })
    );

    // Company subtitle line
    if (entry.subtitle) {
      const subLines = entry.subtitle.split("\n");
      for (const subLine of subLines) {
        paragraphs.push(
          new Paragraph({
            spacing: { before: 20, after: 40 },
            children: [
              new TextRun({
                text: subLine,
                font: FONT_BODY,
                size: SIZE_COMPANY,
                color: COLOR_SECONDARY,
                italics: false,
              }),
            ],
          })
        );
      }
    }

    // Top-level bullets (if any)
    for (const bullet of entry.bullets) {
      paragraphs.push(bulletParagraph(bullet));
    }

    // Top-level paragraphs (if any)
    for (const para of entry.paragraphs) {
      paragraphs.push(bodyParagraph(para));
    }

    // Sub-headers with their bullets
    for (const sub of entry.subheaders) {
      paragraphs.push(
        new Paragraph({
          spacing: { before: 160, after: 60 },
          children: [
            new TextRun({
              text: sub.title,
              font: FONT_BODY,
              size: SIZE_SUBHEADER,
              bold: true,
              color: COLOR_ACCENT,
            }),
          ],
        })
      );

      for (const para of sub.paragraphs) {
        paragraphs.push(bodyParagraph(para));
      }

      for (const bullet of sub.bullets) {
        paragraphs.push(bulletParagraph(bullet));
      }
    }
  }

  return paragraphs;
}

function buildContentSection(section) {
  const paragraphs = [sectionHeader(section.title)];

  for (const line of section.content) {
    // Bold-prefixed lines like **Title:** content (skills section)
    if (line.startsWith("**") && line.includes(":")) {
      paragraphs.push(
        new Paragraph({
          spacing: { before: 60, after: 40 },
          children: parseInlineBold(line),
        })
      );
    } else if (line.startsWith("- ")) {
      paragraphs.push(bulletParagraph(line.replace(/^- /, "")));
    } else {
      paragraphs.push(bodyParagraph(line));
    }
  }

  return paragraphs;
}

function buildDocument(cv) {
  const allParagraphs = [];

  // Header
  allParagraphs.push(...buildHeader(cv));

  // Sections
  for (const section of cv.sections) {
    if (
      section.title.toLowerCase() === "experience" &&
      section.entries.length > 0
    ) {
      allParagraphs.push(...buildExperienceSection(section));
    } else {
      allParagraphs.push(...buildContentSection(section));
    }
  }

  return new Document({
    styles: {
      default: {
        document: {
          run: {
            font: FONT_BODY,
            size: SIZE_BODY,
            color: COLOR_PRIMARY,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: MARGIN_TOP,
              bottom: MARGIN_BOTTOM,
              left: MARGIN_LEFT,
              right: MARGIN_RIGHT,
            },
          },
        },
        children: allParagraphs,
      },
    ],
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("Usage: node generate-cv.mjs <cv.md> [output.docx]");
  process.exit(1);
}

const inputPath = args[0];
const outputPath =
  args[1] || inputPath.replace(/\.md$/, ".docx");

console.log(`Reading: ${inputPath}`);
const markdown = readFileSync(inputPath, "utf-8");

console.log("Parsing CV markdown...");
const cv = parseCVMarkdown(markdown);
console.log(`  Name: ${cv.name}`);
console.log(`  Subtitle: ${cv.subtitle}`);
console.log(`  Sections: ${cv.sections.map((s) => s.title).join(", ")}`);

console.log("Generating DOCX...");
const doc = buildDocument(cv);

const buffer = await Packer.toBuffer(doc);
writeFileSync(outputPath, buffer);
console.log(`Written: ${outputPath}`);
console.log(`Size: ${(buffer.length / 1024).toFixed(1)}KB`);
