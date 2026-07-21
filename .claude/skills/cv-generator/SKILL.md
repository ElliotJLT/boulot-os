---
name: cv-pdf
description: |
  Generates a Wozber-identical PDF CV from a tailored cv.md file.
  One command: cv.md → PDF. No DOCX intermediate. No Wozber needed.
  Works for any user folder in the vault.
allowed-tools: |
  bash: run CV generation script, install npm dependencies
  file: read, write
---

# CV PDF Generator

<purpose>
Generate professional PDFs from tailored cv.md files in the Boulot vault.
Replaces Wozber entirely — same ATS-friendly layout, zero manual steps.
</purpose>

## When To Activate

<triggers>
- User says "/pdf" followed by user and company name
- User asks to "generate the PDF", "build the CV", "export the CV"
- User asks to "make the PDF" or "create the CV file"
- After a /cv tailoring run, when the user wants the final output
- Examples: "/pdf user granola", "generate the Granola CV PDF"
</triggers>

## Instructions

### Step 1: Identify the CV

Parse the user's request to determine:
- **User**: the user folder name (case-insensitive)
- **Company**: the company name matching a folder in `USER/active/{company}/`

The CV markdown file should exist at:
```
{vault-root}/USER/active/{company}/cv.md
{vault-root}/USER/active/{company}/cv.md
```

If no cv.md exists, inform the user and offer to run /cv to create one.

### Step 2: Generate the PDF (zero installs)

The generator needs **nothing installed** — no `npm install`, no puppeteer, no
weasyprint. It writes the HTML itself and renders the PDF with a browser the
user already has (Chrome, Brave, Edge…). Prefer Node; fall back to Python:

```bash
# Preferred — runs on bare Node, no npm install:
cd <skill-path>/scripts && node generate-pdf.mjs "<path-to-cv.md>" "<output-path.pdf>"

# If `node` isn't available, use Python (stdlib only):
cd <skill-path>/scripts && python3 generate-pdf.py "<path-to-cv.md>" "<output-path.pdf>"
```

**If neither `node` nor `python3` exists** (a bare machine), don't send the user
off to install a runtime. Instead:
1. Read the `cv.md` and write the styled HTML yourself into
   `<output-dir>/cv.html`, using the exact CSS template already in
   `generate-pdf.mjs` (copy the `<style>` block and the header/section markup so
   the layout matches Wozber).
2. Run the renderer directly: `bash <skill-path>/scripts/render-pdf.sh "<cv.html>" "<output.pdf>"`.

**About `render-pdf.sh`:** it finds an installed browser and prints the PDF
headlessly — no download. If the machine has *no* browser at all, it opens the
HTML and exits with code `2`; tell the user to press **⌘P → Save as PDF**. The
happy path (any normal machine) always produces a real PDF with no setup.

**Output filename format:** `{Name} - {Company} - {Role}.pdf`
- Name from the first `# ` line in cv.md
- Company from the folder name (title-cased)
- Role from the subtitle or job context

Place the output in the same directory as the cv.md:
```
USER/active/{company}/{Name} - {Company} - {Role}.pdf
```

### Step 4: Open for Review

```bash
open "<output-path.pdf>"
```

Tell the user the file location and size.

## Format Spec (Wozber Match)

The PDF matches Wozber's ATS-friendly template:
- **Font**: Rubik (Google Fonts)
- **Header**: Name + subtitle left, contact with green icons right
- **Section headers**: S P A C E D  C A P S with dotted underline
- **Experience**: Role title bold left, dates right, company below lighter
- **Education**: Course name bold left, dates right, institution below
- **Skills**: 2-column grid
- **Languages**: 4-column grid (name, level pairs)
- **Margins**: 18mm sides, 18mm top, 14mm bottom

## CV Markdown Format

The generator expects this structure in cv.md:

```markdown
# Full Name

**Subtitle | Tagline**

contact | email | linkedin | location

---

## Summary

Summary text...

---

## Experience

### Company — Role Title
**Dates** | Context line

**Sub-header**

- Bullet point
- Bullet point

---

## Education

### Course Name — Institution
**Dates**
Description text

---

## Skills

**Category:** skill, skill, skill

---

## Languages

English: Native | French: Intermediate
```

## NEVER

- Fabricate CV content — only generate from existing cv.md
- Change the cv.md content during generation
- Generate without a cv.md existing first

## ALWAYS

- Confirm output file was created and its size
- Open the file for review after generation
- Place the PDF in the same folder as the cv.md
