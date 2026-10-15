#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
REPO="${GITHUB_REPO:-kaanrkaraman/damla}"
OUT="$HERE/build"
DMG="$OUT/Damla-$VERSION.dmg"

: "${SIGN_ID:?SIGN_ID must be set (Developer ID Application: ...)}"
: "${NOTARY_PROFILE:?NOTARY_PROFILE must be set (notarytool keychain profile)}"

python3 -I "$ROOT/scripts/check.py"
"$HERE/build.sh"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/damla-release.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

NOTES="$STAGE/Damla-$VERSION.md"
awk -v header="## [$VERSION]" 'index($0, header) == 1 { on = 1; next } /^## \[/ { on = 0 } on' "$ROOT/CHANGELOG.md" | sed '/./,$!d' > "$NOTES"
[ -s "$NOTES" ] || { echo "CHANGELOG.md has no notes for $VERSION" >&2; exit 1; }

cp "$DMG" "$STAGE/"
"$HERE/cache/Sparkle/bin/generate_appcast" --embed-release-notes \
  --download-url-prefix "https://github.com/$REPO/releases/download/v$VERSION/" "$STAGE"
cp "$STAGE/appcast.xml" "$OUT/appcast.xml"
echo "appcast: $OUT/appcast.xml"

if [ "${PUBLISH:-}" = "1" ]; then
  gh release create "v$VERSION" "$DMG" "$OUT/appcast.xml" --repo "$REPO" --title "Damla $VERSION" --notes-file "$NOTES"
else
  echo "set PUBLISH=1 to upload the release with gh"
fi
