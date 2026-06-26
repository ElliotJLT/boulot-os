# /pdf

Generate a PDF CV from a tailored cv.md file.

## Usage

`/pdf USER {company}`

Example: `/pdf user vertice`

## Steps

1. Resolve the cv.md path: `USER/active/{company}/cv.md`
2. Confirm the file exists
3. Run the PDF generator:

```bash
python3 .claude/skills/cv-generator/scripts/generate-pdf.py {path-to-cv.md} {path-to-cv.pdf}
```

4. Confirm output file and size
5. Open the PDF: `open {path-to-cv.pdf}`

## Also available: .docx

To generate a Word doc instead, use the docx generator:

```bash
cd .claude/skills/cv-generator/scripts && node generate-cv.mjs {path-to-cv.md} {path-to-cv.docx}
```

## Notes

- PDF uses weasyprint (installed via brew) - clean single-column Helvetica layout
- DOCX uses docx-js (node) - Wozber-style Calibri layout
- Both parse the same markdown structure: `# Name`, `**Subtitle**`, `contact | line`, `## Sections`, `### Roles`
- If the cv.md doesn't exist yet, tell the user to run `/cv USER {company}` first
- If no arguments provided, ask for user and company
