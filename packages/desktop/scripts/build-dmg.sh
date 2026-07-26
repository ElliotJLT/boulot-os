#!/usr/bin/env bash
set -euo pipefail

# Wrap Boulot.app in a .dmg.
#
# Tauri's own bundler can produce a dmg and it fails in any non-interactive
# shell: bundle_dmg.sh drives Finder over AppleScript to position the icons, and
# Finder is not there in CI or over ssh. OpenWorker hit the same wall and worked
# around it the same way, which is a reasonable signal this is the path.
#
# hdiutil does the whole job with no window server involved. The layout is
# plainer than a background-image dmg, and a plain dmg that builds every time
# beats a pretty one that builds on one laptop.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP="$(dirname "$HERE")"
BUNDLE="$DESKTOP/src-tauri/target/release/bundle"
APP="$BUNDLE/macos/Boulot.app"
VERSION="$(node -p "require('$DESKTOP/src-tauri/tauri.conf.json').version")"
ARCH="$(uname -m)"
OUT="$BUNDLE/dmg/Boulot_${VERSION}_${ARCH}.dmg"

[ -d "$APP" ] || { echo "No app at $APP. Run 'pnpm -C packages/desktop build' first."; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -R "$APP" "$STAGE/"
# The drag-to-install affordance, which is the only instruction a dmg needs.
ln -s /Applications "$STAGE/Applications"

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"

hdiutil create \
  -volname "Boulot" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDZO \
  "$OUT" >/dev/null

echo "  $OUT"
echo "  $(du -h "$OUT" | cut -f1)"

# Signing and notarisation are deliberately not attempted here.
#
# They need an Apple Developer account and an App Store Connect API key, and
# without notarisation macOS shows "Apple could not verify this app is free of
# malware" on first launch, which for the person this was built for is a worse
# outcome than a terminal. Better to ship an unsigned build knowingly, with the
# workaround written down, than to pretend the step does not exist.
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo "  APPLE_SIGNING_IDENTITY is set; sign and notarise with:"
  echo "    codesign --deep --force --options runtime --sign \"\$APPLE_SIGNING_IDENTITY\" \"$APP\""
  echo "    xcrun notarytool submit \"$OUT\" --keychain-profile boulot --wait"
  echo "    xcrun stapler staple \"$OUT\""
else
  echo "  unsigned: recipients need to right-click and choose Open on first launch"
fi
