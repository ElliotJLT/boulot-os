#!/usr/bin/env bash
#
# render-pdf.sh — turn an HTML file into a PDF with ZERO installs.
#
# Usage: bash render-pdf.sh <input.html> <output.pdf>
#
# It tries, in order:
#   1. A Chromium-family browser you already have (Chrome, Brave, Edge,
#      Chromium, Vivaldi, Arc) — headless, no npm, no download.
#   2. weasyprint, if you happen to have it installed.
#   3. Nothing? It just opens the HTML in your browser and tells you to
#      press Cmd/Ctrl+P -> Save as PDF. Always works, on any machine.
#
# No Node, no Python, no `npm install`, no 300MB Chromium download.

set -euo pipefail

HTML="${1:-}"
OUT="${2:-}"

if [ -z "$HTML" ] || [ -z "$OUT" ]; then
  echo "Usage: bash render-pdf.sh <input.html> <output.pdf>" >&2
  exit 1
fi

if [ ! -f "$HTML" ]; then
  echo "render-pdf: input HTML not found: $HTML" >&2
  exit 1
fi

# Resolve to an absolute file:// URL (Chrome needs an absolute path).
abspath() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *)  printf '%s/%s' "$(pwd)" "$1" ;;
  esac
}
HTML_ABS="$(abspath "$HTML")"
OUT_ABS="$(abspath "$OUT")"

# ── 1. Find a Chromium-family browser ────────────────────────────────
BROWSER=""
CANDIDATES=(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi"
  "/Applications/Arc.app/Contents/MacOS/Arc"
  # Linux / PATH names, in case Boulot is run outside macOS
  "google-chrome"
  "google-chrome-stable"
  "chromium"
  "chromium-browser"
  "brave-browser"
  "microsoft-edge"
)
for c in "${CANDIDATES[@]}"; do
  if [ -x "$c" ]; then BROWSER="$c"; break; fi
  if command -v "$c" >/dev/null 2>&1; then BROWSER="$(command -v "$c")"; break; fi
done

if [ -n "$BROWSER" ]; then
  # A fresh, isolated profile dir keeps this from touching the user's real browser.
  PROFILE="$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/boulot-chrome.$$")"
  rm -f "$OUT_ABS" 2>/dev/null || true

  # Run headless Chrome in the background. Some builds print the PDF but don't
  # exit cleanly, so we poll for the output file and then stop the browser
  # ourselves — no external `timeout` needed (macOS doesn't ship one).
  "$BROWSER" \
    --headless=new \
    --disable-gpu \
    --no-first-run \
    --no-default-browser-check \
    --user-data-dir="$PROFILE" \
    --no-pdf-header-footer \
    --print-to-pdf="$OUT_ABS" \
    "file://$HTML_ABS" >/dev/null 2>&1 &
  BPID=$!

  # Wait up to ~30s for a non-empty PDF to appear.
  for _ in $(seq 1 60); do
    if [ -s "$OUT_ABS" ]; then break; fi
    kill -0 "$BPID" 2>/dev/null || break   # browser exited on its own
    sleep 0.5
  done
  # Give it a beat to finish flushing, then make sure the browser is gone.
  sleep 0.5
  kill "$BPID" 2>/dev/null || true
  wait "$BPID" 2>/dev/null || true
  rm -rf "$PROFILE" 2>/dev/null || true

  if [ -s "$OUT_ABS" ]; then
    echo "OK: rendered with $(basename "$BROWSER") -> $OUT_ABS"
    exit 0
  fi
  echo "render-pdf: browser render did not produce a file, trying fallbacks..." >&2
fi

# ── 2. weasyprint, if present ────────────────────────────────────────
if command -v weasyprint >/dev/null 2>&1; then
  weasyprint "$HTML_ABS" "$OUT_ABS" && {
    echo "OK: rendered with weasyprint -> $OUT_ABS"
    exit 0
  }
fi

# ── 3. No renderer: open the HTML for manual Save-as-PDF ──────────────
echo "" >&2
echo "No PDF engine found on this machine, so I've opened your CV in a browser." >&2
echo "To finish: press Cmd+P (Mac) or Ctrl+P (Windows/Linux), then choose" >&2
echo "\"Save as PDF\" as the destination. That gives you an identical PDF." >&2
echo "" >&2
if command -v open >/dev/null 2>&1; then
  open "$HTML_ABS" || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$HTML_ABS" || true
fi
# Signal to the caller that manual action is needed.
exit 2
