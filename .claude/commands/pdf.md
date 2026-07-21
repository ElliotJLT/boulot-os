# /pdf

Generate a PDF CV from a tailored cv.md file.

## Usage

`/pdf USER {company}`

Example: `/pdf user vertice`

## Steps

1. Resolve the cv.md path: `USER/active/{company}/cv.md`
2. Confirm the file exists
3. Run the PDF generator (needs **nothing installed** — no npm, no weasyprint):

```bash
# Preferred — bare Node, no npm install:
node .claude/skills/cv-generator/scripts/generate-pdf.mjs {path-to-cv.md} {path-to-cv.pdf}

# If `node` isn't available:
python3 .claude/skills/cv-generator/scripts/generate-pdf.py {path-to-cv.md} {path-to-cv.pdf}
```

4. Confirm output file and size
5. Open the PDF: `open {path-to-cv.pdf}`

If the generator prints "PDF engine not found", the machine has no browser at
all — it opened the HTML instead. Tell the user to press **⌘P → Save as PDF**.
See the `cv-generator` skill for the full fallback flow.

## Also available: .docx

To generate a Word doc instead, use the docx generator. This one *does* need a
package: `cd .claude/skills/cv-generator/scripts && npm install` (installs `docx`), then:

```bash
cd .claude/skills/cv-generator/scripts && node generate-cv.mjs {path-to-cv.md} {path-to-cv.docx}
```

## Notes

- PDF renders via a browser the user already has (Chrome/Brave/Edge), headless — no download, no puppeteer, no weasyprint.
- DOCX uses docx-js (node) - Wozber-style Calibri layout - the only path that needs `npm install`.
- All paths parse the same markdown structure: `# Name`, `**Subtitle**`, `contact | line`, `## Sections`, `### Roles`
- If the cv.md doesn't exist yet, tell the user to run `/cv USER {company}` first
- If no arguments provided, ask for user and company
