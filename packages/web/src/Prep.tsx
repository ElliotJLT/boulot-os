import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "./Activity.js";

/**
 * The prep document: rendered, and editable where you are looking.
 *
 * Clicking the prose used to swap the whole pane for a monospace box holding
 * the raw file, frontmatter and hashes and all. That is a mode change disguised
 * as a click: you asked to fix one sentence and the document you were reading
 * disappeared. It also put the least readable version of the file on screen at
 * the exact moment you were trying to read it.
 *
 * A block at a time instead. Click a paragraph and only that paragraph becomes
 * text you can type in; everything around it stays rendered. Blur or Escape and
 * it renders again. The rest of the document never moves, so you never lose
 * your place, and the markdown you are editing is one paragraph of it rather
 * than a file.
 *
 * This is deliberately not a rich text editor. The file has to stay markdown
 * on disk — the agent reads and writes it, and so can you in any editor — and a
 * WYSIWYG layer over that is a large amount of machinery whose main achievement
 * would be hiding the format from the one person who benefits from seeing it.
 */

/** Frontmatter is the app's, not yours: kept, never shown, never edited here. */
function split(text: string): { front: string; body: string } {
  if (!text.startsWith("---")) return { front: "", body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { front: "", body: text };
  const stop = text.indexOf("\n", end + 1);
  return stop === -1
    ? { front: text, body: "" }
    : { front: text.slice(0, stop + 1), body: text.slice(stop + 1) };
}

/**
 * Blocks are separated by blank lines, which keeps multi-line things whole.
 *
 * A list, a table and a blockquote are each several lines with no blank line
 * inside them, so splitting this way means clicking any row of a table opens
 * the whole table rather than one orphaned row of pipes.
 */
function blocksOf(body: string): string[] {
  return body.split(/\n[ \t]*\n/).map((b) => b.replace(/\s+$/, "")).filter((b) => b !== "");
}

function Editing({
  value,
  onCommit,
  onCancel,
}: {
  value: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const box = useRef<HTMLTextAreaElement>(null);

  // Grow to the text rather than scrolling inside a fixed box: the block you
  // are editing should occupy the space the block you were reading occupied.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [draft]);

  return (
    <textarea
      ref={box}
      className="block-edit"
      value={draft}
      spellCheck
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
        // Enter makes a new line, because these are paragraphs. Cmd-Enter is
        // the deliberate "done", for anyone who does not want to click away.
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onCommit(draft);
        }
      }}
    />
  );
}

export function PrepDoc({
  text,
  onChange,
  onAsk,
}: {
  text: string;
  onChange: (next: string) => void;
  /** Hand a highlighted passage to the conversation. */
  onAsk: (passage: string) => void;
}) {
  const { front, body } = split(text);
  const blocks = useMemo(() => blocksOf(body), [body]);
  const [editing, setEditing] = useState<number | null>(null);
  const [picked, setPicked] = useState<{ text: string; x: number; y: number } | null>(null);
  const pane = useRef<HTMLDivElement>(null);

  const write = (next: string[]) =>
    onChange(`${front}${front ? "\n" : ""}${next.filter((b) => b.trim()).join("\n\n")}\n`);

  const commit = (i: number, next: string) => {
    setEditing(null);
    if (next === blocks[i]) return;
    const copy = [...blocks];
    // Emptying a block deletes it, which is the only delete this needs: a
    // paragraph you have selected all of and typed over is a paragraph you
    // meant to remove.
    copy[i] = next;
    write(copy);
  };

  return (
    <div className="reading prep-doc" ref={pane}>
      {blocks.map((block, i) =>
        editing === i ? (
          <Editing
            key={i}
            value={block}
            onCommit={(next) => commit(i, next)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div
            key={i}
            className="block"
            onMouseUp={(e) => {
              const chosen = window.getSelection()?.toString().trim() ?? "";
              if (chosen.length > 2) {
                const box = pane.current?.getBoundingClientRect();
                if (!box) return;
                setPicked({
                  text: chosen,
                  // Kept inside the pane: released near the right edge, the
                  // button hung off it and read as "Ask about".
                  x: Math.min(Math.max(e.clientX - box.left, 8), box.width - 130),
                  y: e.clientY - box.top + (pane.current?.scrollTop ?? 0),
                });
                return;
              }
              setPicked(null);
              setEditing(i);
            }}
          >
            <Markdown text={block} />
          </div>
        ),
      )}

      {/* Somewhere to start, and somewhere to carry on. */}
      <button
        className="block-add"
        onClick={() => {
          write([...blocks, ""]);
          setEditing(blocks.length);
        }}
      >
        {blocks.length ? "Add a note" : "Nothing here yet. Click to start writing, or ask a question on the right."}
      </button>

      {picked && (
        <button
          className="ask-about"
          style={{ insetInlineStart: picked.x, insetBlockStart: picked.y + 10 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onAsk(picked.text);
            setPicked(null);
            window.getSelection()?.removeAllRanges();
          }}
        >
          Ask about this
        </button>
      )}
    </div>
  );
}
