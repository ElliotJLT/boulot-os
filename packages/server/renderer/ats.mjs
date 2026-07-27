import { execFileSync } from "node:child_process";

/**
 * What an applicant tracking system actually sees.
 *
 * Everything else in this renderer measures the PDF as a picture: how tall the
 * content is, how many pages it takes, whether a section spills. None of that
 * is what gets read first. The first reader is a parser that pulls a text layer
 * out of the file and tries to find a name, an email and a phone number in it,
 * and if that fails a person never sees the document at all.
 *
 * Chrome produces a good text layer, so this is not usually broken — which is
 * exactly why it needs checking rather than assuming. The failure is silent and
 * total: the CV looks perfect on screen, and the pipeline it was written for
 * cannot read it.
 *
 * Three things are checked, and only things that can be checked:
 *
 *   1. There is a text layer at all. A CV rendered as an image scores zero.
 *   2. The contact details survive extraction, in a form a regex can find.
 *   3. Reading order holds: the name comes before the summary, sections come in
 *      the order they were written, and the two-column header has not
 *      interleaved into "Elliot (+44) Little 7927".
 *
 * What is deliberately NOT checked: keyword density, "ATS score", or any of the
 * things products sell. A score against an unpublished proprietary parser is a
 * number somebody made up. This reports what the text layer contains and lets
 * the reader judge.
 */

/**
 * Pull the text layer.
 *
 * Two failures look the same from here and mean opposite things: the tool is
 * not installed (we cannot check, say so and move on) versus the tool ran and
 * could not read the file (that is the failure itself, and it is fatal). The
 * first is answered by asking whether the binary exists at all.
 */
export function extractText(pdfPath) {
  const quiet = { encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"] };
  let available = false;
  try {
    execFileSync("pdftotext", ["-v"], quiet);
    available = true;
  } catch (e) {
    // -v exits non-zero on some builds while still being present.
    available = e?.code !== "ENOENT";
  }
  if (!available) return { text: null, tool: null, available: false };

  try {
    return { text: execFileSync("pdftotext", ["-layout", "-nopgbrk", pdfPath, "-"], quiet), tool: "pdftotext", available: true };
  } catch {
    return { text: null, tool: "pdftotext", available: true };
  }
}

const RE = {
  email: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  // Deliberately loose: international, spaces, brackets, dashes all allowed.
  phone: /(\+?\d[\d\s().-]{8,}\d)/,
  linkedin: /linkedin\.com\/[a-z0-9/_-]+/i,
};

/**
 * Read the extracted text the way a parser would, and report what it found.
 *
 * `expect` carries what the vault believes is true — the name and contact
 * details from profile.md — so the check is "did what we wrote survive", not
 * "does this look like a CV". Without it the check can only say a phone number
 * exists somewhere, which is the kind of test that passes while the document
 * is wrong.
 */
export function checkAts(pdfPath, expect = {}) {
  const { text, tool, available } = extractText(pdfPath);

  if (!available) {
    return {
      checked: false,
      reason: "pdftotext is not installed, so the text layer could not be read",
      problems: [],
    };
  }
  if (text == null) {
    // The tool is here and could not read the file. That is the finding.
    return {
      checked: true,
      tool,
      chars: 0,
      found: {},
      problems: [
        {
          severity: "fatal",
          what: "The PDF could not be parsed at all",
          detail: "A standard text extractor failed on this file. No screening system will read it.",
        },
      ],
    };
  }

  const flat = text.replace(/\s+/g, " ").trim();
  const problems = [];

  if (flat.length < 400) {
    problems.push({
      severity: "fatal",
      what: "Almost no extractable text",
      detail: `${flat.length} characters came out of the PDF. A parser will read this as an empty document.`,
    });
    return { checked: true, tool, chars: flat.length, problems, found: {} };
  }

  const found = {
    email: RE.email.exec(flat)?.[0] ?? null,
    phone: RE.phone.exec(flat)?.[0]?.trim() ?? null,
    linkedin: RE.linkedin.exec(flat)?.[0] ?? null,
  };

  if (!found.email) {
    problems.push({
      severity: "fatal",
      what: "No email address in the text layer",
      detail: "A parser that cannot find an email usually discards the application.",
    });
  } else if (expect.email && !flat.includes(expect.email)) {
    problems.push({
      severity: "fatal",
      what: "The email came out mangled",
      detail: `Expected ${expect.email}, extracted ${found.email}.`,
    });
  }

  if (!found.phone) {
    problems.push({
      severity: "warn",
      what: "No phone number in the text layer",
      detail: "Recruiters filter on it and some forms require it.",
    });
  }

  /*
   * Reading order, checked against the one thing that must come first.
   *
   * A two-column header is where this breaks: visually the name is left and the
   * contact block is right, but if the text layer interleaves them a parser
   * reads "Elliot (+44) Little 7927" and the name field is filled with a phone
   * number. The test is cheap and specific — the name must appear before the
   * email, uninterrupted.
   */
  if (expect.name) {
    const nameAt = flat.indexOf(expect.name);
    if (nameAt === -1) {
      problems.push({
        severity: "fatal",
        what: "The name did not survive extraction",
        detail: `"${expect.name}" is not in the text layer as written. The name field will be filled with whatever came first.`,
      });
    } else if (found.email && nameAt > flat.indexOf(found.email)) {
      problems.push({
        severity: "warn",
        what: "Contact details are read before the name",
        detail: "Some parsers take the first line as the name.",
      });
    } else if (nameAt > 120) {
      problems.push({
        severity: "warn",
        what: "The name is not near the top of the text layer",
        detail: `It appears ${nameAt} characters in.`,
      });
    }
  }

  /*
   * Sections in the order they were written.
   *
   * Out-of-order sections mean the columns interleaved somewhere below the
   * header, which is the difference between a parsed work history and a pile of
   * sentences.
   */
  if (Array.isArray(expect.sections) && expect.sections.length > 1) {
    const positions = expect.sections
      .map((title) => ({ title, at: flat.toUpperCase().indexOf(title.toUpperCase()) }))
      .filter((s) => s.at > -1);
    const missing = expect.sections.filter((t) => !positions.some((p) => p.title === t));
    if (missing.length) {
      problems.push({
        severity: "warn",
        what: `${missing.length} section heading${missing.length === 1 ? "" : "s"} missing from the text layer`,
        detail: missing.join(", "),
      });
    }
    const outOfOrder = positions.filter((p, i) => i > 0 && p.at < positions[i - 1].at);
    if (outOfOrder.length) {
      problems.push({
        severity: "fatal",
        what: "Sections come out in the wrong order",
        detail: `${outOfOrder.map((p) => p.title).join(", ")} read before the section above ${outOfOrder.length === 1 ? "it" : "them"}. The columns have interleaved.`,
      });
    }
  }

  // Ligature and glyph damage: a real failure mode with subsetted fonts.
  if (/[�]/.test(text)) {
    problems.push({
      severity: "warn",
      what: "Replacement characters in the text layer",
      detail: "Some glyphs did not map back to characters.",
    });
  }

  return { checked: true, tool, chars: flat.length, found, problems };
}
