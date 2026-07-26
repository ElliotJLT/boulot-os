import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_FILENAME, downloadName, readDetails, writeDetails } from "../src/vault/details.js";

let dir = "";
const PROFILE = `# Profile

Who Boulot is working for.

## Contact
- Phone: (+44) 7927 204 882
- Email: elliot@example.com
- LinkedIn: linkedin.com/in/hireelliot
- Location: East Dulwich, London

## Identity
Builder-operator with ops roots.
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "details-"));
  writeFileSync(join(dir, "profile.md"), PROFILE);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("readDetails", () => {
  it("reads the contact block as written", () => {
    const d = readDetails(dir);
    expect(d.email).toBe("elliot@example.com");
    expect(d.phone).toBe("(+44) 7927 204 882");
    expect(d.location).toBe("East Dulwich, London");
  });

  it("falls back to the default filename when none is set", () => {
    expect(readDetails(dir).filename).toBe(DEFAULT_FILENAME);
  });

  it("returns blanks rather than throwing when there is no profile", () => {
    expect(readDetails(join(dir, "nope")).email).toBe("");
  });
});

describe("writeDetails", () => {
  it("edits a line in place and leaves the rest of the file alone", () => {
    writeDetails(dir, { email: "new@example.com" });
    const text = readFileSync(join(dir, "profile.md"), "utf8");
    expect(text).toContain("- Email: new@example.com");
    expect(text).toContain("Builder-operator with ops roots.");
    expect(text).toContain("- Phone: (+44) 7927 204 882");
  });

  it("adds a field the file has never carried, under Contact", () => {
    writeDetails(dir, { github: "github.com/ElliotJLT" });
    const text = readFileSync(join(dir, "profile.md"), "utf8");
    expect(text).toContain("- GitHub: github.com/ElliotJLT");
    expect(text.indexOf("GitHub")).toBeLessThan(text.indexOf("## Identity"));
  });

  it("does not duplicate a field on a second write", () => {
    writeDetails(dir, { github: "a" });
    writeDetails(dir, { github: "b" });
    const text = readFileSync(join(dir, "profile.md"), "utf8");
    expect(text.match(/GitHub:/g)).toHaveLength(1);
    expect(text).toContain("- GitHub: b");
  });
});

describe("downloadName", () => {
  const base = { ...readDetails(""), name: "Elliot Little", filename: DEFAULT_FILENAME };

  it("uses first and last name plus the role", () => {
    expect(downloadName(base, { role: "Product Engineer" })).toBe("Elliot Little - Product Engineer (CV).pdf");
  });

  it("strips characters that would make a filename into a path", () => {
    expect(downloadName(base, { role: "Product Manager / Applied AI" })).toBe(
      "Elliot Little - Product Manager Applied AI (CV).pdf",
    );
  });

  it("does not leave a dangling dash when the role is unknown", () => {
    expect(downloadName(base, { role: "" })).toBe("Elliot Little (CV).pdf");
  });

  it("honours a custom pattern, including the company", () => {
    const d = { ...base, filename: "{company} — {name}" };
    expect(downloadName(d, { role: "x", company: "Lawhive" })).toBe("Lawhive — Elliot Little.pdf");
  });
});

describe("finding a name that was never written down", () => {
  it("takes it from the master record's heading", () => {
    writeFileSync(join(dir, "cv-master.md"), "# Ada Lovelace\n\n## Experience Bank\n");
    expect(readDetails(dir).name).toBe("Ada Lovelace");
  });

  it("does not mistake the starter template's own title for a person", () => {
    writeFileSync(join(dir, "cv-master.md"), "# Master Experience Bank\n\nEverything you have done.\n");
    expect(readDetails(dir).name).toBe("");
  });

  it("prefers an explicit Name field over the heading", () => {
    writeFileSync(join(dir, "cv-master.md"), "# Ada Lovelace\n");
    writeDetails(dir, { name: "A. Lovelace" });
    expect(readDetails(dir).name).toBe("A. Lovelace");
  });
});
