#!/usr/bin/env python3
"""
CV PDF Generator - Wozber style. Reads cv.md, generates professional PDF.

Usage: python3 generate-pdf.py <path-to-cv.md> [output-path.pdf]
"""

import sys
import re
import subprocess
import tempfile
import os


def md_to_html(md):
    """Convert CV markdown to Wozber-styled HTML."""
    lines = md.strip().split("\n")
    i = 0

    # Skip frontmatter
    if lines[i].strip() == "---":
        i += 1
        while i < len(lines) and lines[i].strip() != "---":
            i += 1
        i += 1

    while i < len(lines) and lines[i].strip() == "":
        i += 1

    name = ""
    subtitle = ""
    contact_parts = []

    # # Name
    if i < len(lines) and lines[i].startswith("# "):
        name = lines[i][2:].strip()
        i += 1

    while i < len(lines) and lines[i].strip() == "":
        i += 1

    # **Subtitle**
    if i < len(lines) and lines[i].startswith("**") and lines[i].endswith("**"):
        subtitle = lines[i][2:-2].strip()
        i += 1

    while i < len(lines) and lines[i].strip() == "":
        i += 1

    # Contact line (pipe-separated)
    if i < len(lines) and "|" in lines[i] and "@" in lines[i]:
        contact_parts = [p.strip() for p in lines[i].strip().split("|")]
        i += 1

    # Build header - two column layout like Wozber
    html_parts = []
    html_parts.append('<div class="header">')
    html_parts.append('<div class="header-left">')
    html_parts.append(f'<h1>{name.upper()}</h1>')
    if subtitle:
        html_parts.append(f'<div class="subtitle">{subtitle}</div>')
    html_parts.append('</div>')
    html_parts.append('<div class="header-right">')

    # Map contact parts to icons
    icons = {"phone": "&#9742;", "email": "&#9993;", "linkedin": "&#10148;", "location": "&#9679;"}
    for part in contact_parts:
        if "@" in part:
            icon = icons["email"]
        elif "linkedin" in part:
            icon = icons["linkedin"]
        elif any(c.isdigit() for c in part) and len(part) < 20:
            icon = icons["phone"]
        else:
            icon = icons["location"]
        html_parts.append(f'<div class="contact-line"><span class="contact-icon">{icon}</span> {part}</div>')

    html_parts.append('</div>')
    html_parts.append('</div>')

    # Track sections for skills special handling
    current_section_title = ""
    skills_items = []
    in_skills = False
    languages_items = []
    in_languages = False

    # Parse remaining content
    while i < len(lines):
        line = lines[i]

        if line.strip() == "---":
            i += 1
            continue

        # ## Section
        if line.startswith("## "):
            # Flush skills if we were collecting them
            if in_skills and skills_items:
                html_parts.append('<div class="skills-grid">')
                for sk in skills_items:
                    html_parts.append(f'<div class="skills-cell">{format_inline(sk)}</div>')
                html_parts.append('</div>')
                skills_items = []
                in_skills = False

            if in_languages and languages_items:
                html_parts.append('<div class="languages-row">')
                for lang in languages_items:
                    parts = lang.split(":")
                    if len(parts) == 2:
                        html_parts.append(f'<div class="lang-item"><span class="lang-name">{parts[0].strip()}</span><span class="lang-level">{parts[1].strip()}</span></div>')
                html_parts.append('</div>')
                languages_items = []
                in_languages = False

            title = line[3:].strip()
            current_section_title = title.lower()
            html_parts.append(f'<div class="section-header">{title.upper()}</div>')

            if current_section_title == "skills":
                in_skills = True
            elif current_section_title == "languages":
                in_languages = True

            i += 1
            continue

        # ### Role / Education entry
        if line.startswith("### "):
            role_text = line[4:].strip()
            # Split on " - " to get company and title
            if " - " in role_text:
                parts = role_text.split(" - ", 1)
                company = parts[0].strip()
                title = parts[1].strip()
            else:
                company = ""
                title = role_text

            i += 1

            # Dates line
            while i < len(lines) and lines[i].strip() == "":
                i += 1

            dates = ""
            role_subtitle_line = ""
            context_line = ""

            if i < len(lines) and lines[i].startswith("**"):
                date_content = lines[i].replace("**", "").strip()
                if "|" in date_content:
                    date_parts = date_content.split("|", 1)
                    dates = date_parts[0].strip()
                    role_subtitle_line = date_parts[1].strip()
                else:
                    dates = date_content
                i += 1

            # Context line - only short metadata lines like "Enterprise partners: ..."
            # Not full paragraphs (those should render as regular body text)
            while i < len(lines) and lines[i].strip() == "":
                i += 1
            if (i < len(lines) and not lines[i].startswith("#") and not lines[i].startswith("**")
                    and not lines[i].startswith("-") and not lines[i].startswith("---")
                    and lines[i].strip() and not lines[i].startswith("*")
                    and len(lines[i].strip()) < 120):
                context_line = lines[i].strip()
                i += 1

            # Format dates for display (convert "Apr 2022 - Present" to "04/2022 - Present")
            formatted_dates = format_dates(dates)

            html_parts.append(f'<div class="role-header"><span class="role-title">{title}</span><span class="role-date">{formatted_dates}</span></div>')
            if company:
                html_parts.append(f'<div class="role-company">{company}</div>')
            if role_subtitle_line:
                html_parts.append(f'<div class="role-context">{role_subtitle_line}</div>')
            if context_line:
                html_parts.append(f'<div class="role-context">{context_line}</div>')

            continue

        # **Bold subheader** (within experience)
        if line.startswith("**") and line.endswith("**") and ":" not in line:
            header = line[2:-2].strip()
            html_parts.append(f'<div class="subheader">{header}</div>')
            i += 1
            continue

        # Bullet
        if line.startswith("- "):
            text = line[2:].strip()
            html_parts.append(f'<div class="bullet">{format_inline(text)}</div>')
            i += 1
            continue

        # Skills line (**Label:** content) or Languages line
        if in_skills and line.startswith("**") and ":" in line:
            # Strip the bold markers and keep as-is
            clean = re.sub(r'\*\*(.+?)\*\*', r'\1', line)
            skills_items.append(line)
            i += 1
            continue

        if in_languages and line.strip():
            # Parse "English: Native | French: Intermediate"
            if "|" in line:
                lang_parts = [p.strip() for p in line.split("|")]
                for lp in lang_parts:
                    languages_items.append(lp)
            elif ":" in line:
                languages_items.append(line.strip())
            i += 1
            continue

        # Regular paragraph
        if line.strip():
            html_parts.append(f'<p>{format_inline(line.strip())}</p>')

        i += 1

    # Flush any remaining skills/languages
    if in_skills and skills_items:
        html_parts.append('<div class="skills-grid">')
        for sk in skills_items:
            html_parts.append(f'<div class="skills-cell">{format_inline(sk)}</div>')
        html_parts.append('</div>')

    if in_languages and languages_items:
        html_parts.append('<div class="languages-row">')
        for lang in languages_items:
            parts = lang.split(":")
            if len(parts) == 2:
                html_parts.append(f'<div class="lang-item"><span class="lang-name">{parts[0].strip()}</span><span class="lang-level">{parts[1].strip()}</span></div>')
        html_parts.append('</div>')

    return "\n".join(html_parts)


def format_dates(dates):
    """Convert 'Apr 2022 - Present' to '04/2022 - Present'."""
    months = {
        "Jan": "01", "Feb": "02", "Mar": "03", "Apr": "04",
        "May": "05", "Jun": "06", "Jul": "07", "Aug": "08",
        "Sep": "09", "Oct": "10", "Nov": "11", "Dec": "12"
    }
    result = dates
    for name, num in months.items():
        result = re.sub(rf'\b{name}\s+(\d{{4}})', rf'{num}/\1', result)
    return result


def format_inline(text):
    """Convert **bold** markdown to <strong> tags."""
    return re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)


CSS = """
@page {
    size: A4;
    margin: 1.5cm 2.2cm 1.5cm 2.2cm;
    @bottom-right {
        content: counter(page) " / " counter(pages);
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 8pt;
        color: #999999;
    }
}

body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 9.5pt;
    color: #2D2D2D;
    line-height: 1.45;
    margin: 0;
    padding: 0;
}

/* ---- Header ---- */
.header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 10pt;
}

.header-left {
    flex: 1;
}

.header-right {
    text-align: right;
    padding-top: 4pt;
}

h1 {
    font-size: 24pt;
    font-weight: 700;
    margin: 0 0 4pt 0;
    color: #2D2D2D;
    letter-spacing: 1pt;
}

.subtitle {
    font-size: 11pt;
    color: #666666;
    margin-bottom: 2pt;
    font-weight: 400;
}

.contact-line {
    font-size: 9pt;
    color: #555555;
    margin-bottom: 3pt;
    white-space: nowrap;
}

.contact-icon {
    color: #999999;
    margin-right: 4pt;
    font-size: 8pt;
}

/* ---- Section Headers ---- */
.section-header {
    font-size: 10pt;
    font-weight: 700;
    color: #2D2D2D;
    letter-spacing: 0pt;
    border-bottom: 1pt dotted #CCCCCC;
    padding-bottom: 3pt;
    margin-top: 12pt;
    margin-bottom: 6pt;
}

/* ---- Roles ---- */
.role-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-top: 8pt;
    margin-bottom: 1pt;
}

.role-title {
    font-size: 10pt;
    font-weight: 700;
    color: #2D2D2D;
}

.role-date {
    font-size: 9pt;
    color: #666666;
    white-space: nowrap;
    text-align: right;
}

.role-company {
    font-size: 9pt;
    color: #666666;
    margin-bottom: 2pt;
}

.role-context {
    font-size: 9.5pt;
    color: #2D2D2D;
    margin-bottom: 4pt;
    line-height: 1.45;
}

/* ---- Subheaders ---- */
.subheader {
    font-size: 9.5pt;
    font-weight: 600;
    color: #333333;
    margin-top: 8pt;
    margin-bottom: 3pt;
}

/* ---- Bullets ---- */
.bullet {
    margin-bottom: 4pt;
    line-height: 1.4;
    display: list-item;
    list-style-type: disc;
    list-style-position: inside;
    color: #2D2D2D;
}

/* ---- Summary ---- */
p {
    margin: 3pt 0;
    line-height: 1.45;
}

/* ---- Skills Grid ---- */
.skills-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6pt 24pt;
    margin-top: 4pt;
}

.skills-cell {
    font-size: 9pt;
    color: #2D2D2D;
    line-height: 1.4;
}

.skills-cell strong {
    font-weight: 600;
}

/* ---- Languages ---- */
.languages-row {
    display: flex;
    gap: 0;
    margin-top: 4pt;
}

.lang-item {
    display: flex;
    gap: 0;
    min-width: 25%;
}

.lang-name {
    font-size: 9.5pt;
    color: #2D2D2D;
    font-weight: 400;
    min-width: 80pt;
}

.lang-level {
    font-size: 9.5pt;
    color: #666666;
    min-width: 80pt;
}

/* ---- General ---- */
strong {
    font-weight: 700;
}
"""


def main():
    args = [a for a in sys.argv[1:] if a != "--html"]
    html_only = "--html" in sys.argv[1:]

    if len(args) < 1:
        print("Usage: python3 generate-pdf.py [--html] <cv.md> [output.pdf|.html]", file=sys.stderr)
        sys.exit(1)

    input_path = args[0]
    output_path = args[1] if len(args) > 1 else input_path.replace(".md", ".pdf")
    if output_path.endswith(".html"):
        html_only = True

    print(f"Reading: {input_path}")
    with open(input_path, "r") as f:
        md = f.read()

    print("Converting to HTML...")
    body_html = md_to_html(md)

    full_html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>{CSS}</style></head>
<body>{body_html}</body>
</html>"""

    # Write the HTML next to the target so render-pdf.sh can pick it up.
    html_path = output_path if html_only else re.sub(r"\.pdf$", ".html", output_path)
    with open(html_path, "w") as f:
        f.write(full_html)
    print(f"  HTML: {html_path}")

    if html_only:
        print(f"Written: {html_path}")
        return

    # Render to PDF with the dependency-free renderer (uses a browser you already
    # have — no weasyprint, no npm, no Chromium download).
    print("Generating PDF...")
    renderer = os.path.join(os.path.dirname(os.path.abspath(__file__)), "render-pdf.sh")
    result = subprocess.run(["bash", renderer, html_path, output_path])
    if result.returncode == 0 and os.path.exists(output_path):
        size_kb = os.path.getsize(output_path) / 1024
        print(f"Written: {output_path}")
        print(f"Size: {size_kb:.1f}KB")
    elif result.returncode == 2:
        print("PDF engine not found — opened the HTML so you can Save as PDF (Cmd+P).")
    else:
        print("PDF render failed. The HTML is ready at:", html_path, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
