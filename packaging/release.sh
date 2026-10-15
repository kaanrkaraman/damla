#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
REPO="${GITHUB_REPO:-kaanrkaraman/damla}"
SPARKLE_BIN="$HERE/cache/Sparkle/bin"
OUT="$HERE/build"
DMG="$OUT/Damla-$VERSION.dmg"

: "${SIGN_ID:?SIGN_ID tanımlı olmalı (Developer ID Application: ...)}"
: "${NOTARY_PROFILE:?NOTARY_PROFILE tanımlı olmalı (notarytool keychain profili)}"

"$HERE/build.sh"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/damla-release.XXXXXX")"
cp "$DMG" "$STAGE/"
"$SPARKLE_BIN/generate_appcast" --download-url-prefix "https://github.com/$REPO/releases/download/v$VERSION/" "$STAGE"
cp "$STAGE/appcast.xml" "$OUT/appcast.xml"
echo "appcast: $OUT/appcast.xml"

if [ "${PUBLISH:-}" = "1" ]; then
  gh release create "v$VERSION" "$DMG" "$OUT/appcast.xml" --repo "$REPO" --title "Damla $VERSION" --notes "${NOTES:-Damla $VERSION}"
else
  echo "yayınlamak için: PUBLISH=1 ./packaging/release.sh   (gh release create çalıştırır)"
fi
