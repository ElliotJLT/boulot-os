/**
 * Editing frontmatter without rewriting the file.
 *
 * The obvious implementation is parse to an object, mutate, serialise. It is
 * also wrong here: these files are hand-written and hand-read, and a round trip
 * through a YAML serialiser reorders keys, restyles quotes, collapses block
 * scalars and normalises the comments out of existence. The user opens the file
 * afterwards and finds a diff they did not make.
 *
 * So this patches lines in place. Keys that exist are rewritten where they sit,
 * keys that do not are appended to the end of the block, and every other byte of
 * the file — body, comments, spacing, key order — survives untouched.
 */

const KEY_LINE = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/;

/** Values that need quoting to stay valid YAML scalars. */
function serialise(value: string): string {
  return /^[\s"']|[:#]|[\s]$/.test(value) ? JSON.stringify(value) : value;
}

/**
 * Set keys in a file's YAML frontmatter.
 *
 * A `null` value removes the key. Files with no frontmatter get one.
 */
export function updateFrontmatter(text: string, patch: Record<string, string | null>): string {
  const entries = Object.entries(patch);
  if (!entries.length) return text;

  if (!text.startsWith("---")) {
    const block = entries
      .filter((e): e is [string, string] => e[1] !== null)
      .map(([k, v]) => `${k}: ${serialise(v)}`)
      .join("\n");
    return `---\n${block}\n---\n\n${text}`;
  }

  /*
   * Frontmatter that was never closed.
   *
   * Returning the text unchanged here is what a missing "---" used to do, and
   * it fails in the worst available way: the caller writes the file back
   * happily, the endpoint reports success, and the value never changes. A card
   * that would not move between columns however many times you dragged it
   * turned out to be one status.md whose closing delimiter was never written.
   *
   * The file is still readable and the intent is obvious, so it gets repaired
   * rather than refused. The block runs to the last line that still looks like
   * a key, and anything after that is body text that keeps its place below a
   * delimiter this now supplies.
   */
  let end = text.indexOf("\n---", 3);
  if (end === -1) {
    const lines = text.split("\n");
    let last = 0;
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (KEY_LINE.test(line) || /^\s+\S/.test(line)) last = i;
      else if (line.trim() !== "") break;
    }
    const upto = lines.slice(0, last + 1).join("\n");
    text = `${upto}\n---\n${lines.slice(last + 1).join("\n")}`;
    end = upto.length;
  }

  const head = text.slice(0, text.indexOf("\n") + 1);
  const block = text.slice(text.indexOf("\n") + 1, end);
  const tail = text.slice(end);

  const remaining = new Map(entries);
  const out: string[] = [];
  // Lines belonging to a `key: |` block scalar are continuations, not keys, and
  // matching them as keys would rewrite the middle of someone's notes.
  let inBlockScalar = false;

  for (const line of block.split("\n")) {
    if (inBlockScalar && (line.startsWith("  ") || line.trim() === "")) {
      out.push(line);
      continue;
    }
    inBlockScalar = false;

    const m = KEY_LINE.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const [, key = "", value = ""] = m;
    if (value === "|" || value === ">") inBlockScalar = true;

    if (!remaining.has(key)) {
      out.push(line);
      continue;
    }
    const next = remaining.get(key) ?? null;
    remaining.delete(key);
    if (next !== null) out.push(`${key}: ${serialise(next)}`);
    // null drops the line, and its block-scalar continuation with it.
    else inBlockScalar = value === "|" || value === ">";
  }

  for (const [key, value] of remaining) {
    if (value !== null) out.push(`${key}: ${serialise(value)}`);
  }

  return head + out.join("\n") + tail;
}

/** Today, as the date-only string the vault writes. */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
