#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
OUT="$HERE/build"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
SIGN_ID="${SIGN_ID:--}"
NOTARY_PROFILE="${NOTARY_PROFILE:-}"
APP="$OUT/Damla.app"
RES="$APP/Contents/Resources"

if [ "$SIGN_ID" = "-" ]; then TIMESTAMP="--timestamp=none"; else TIMESTAMP="--timestamp"; fi

sign() {
  local target="$1"; shift
  codesign --force --sign "$SIGN_ID" "$TIMESTAMP" --options runtime "$@" "$target"
}

"$HERE/fetch-tools.sh"
"$HERE/build-ffmpeg.sh"

echo "== Extension build"
(cd "$ROOT" && npm ci --silent && npm run --silent typecheck && npm run --silent build)

echo "== Xcode Release build"
rm -rf "$OUT/dd"
xcodebuild -project "$ROOT/Damla/Damla.xcodeproj" -scheme Damla -configuration Release \
  -derivedDataPath "$OUT/dd" CODE_SIGNING_ALLOWED=NO CODE_SIGN_IDENTITY="" build | tail -3

LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
"$LSREGISTER" -u "$OUT/dd/Build/Products/Release/Damla.app" 2>/dev/null || true

echo "== Assembling the app"
rm -rf "$APP"
cp -R "$OUT/dd/Build/Products/Release/Damla.app" "$APP"
mkdir -p "$RES/helper" "$RES/bin" "$RES/licenses"
cp "$ROOT/helper/server.py" "$RES/helper/"
cp "$ROOT/VERSION" "$RES/helper/VERSION"

tar -xzf "$HERE/cache/python.tar.gz" -C "$RES"
PY="$RES/python"
rm -rf "$PY/include" "$PY/share" "$PY/lib/tcl"* "$PY/lib/tk"* "$PY/lib/itcl"* "$PY/lib/libtcl"* "$PY/lib/libtk"* "$PY/lib/thread"*
LIBPY="$(echo "$PY"/lib/python3.*)"
rm -rf "$LIBPY/test" "$LIBPY/idlelib" "$LIBPY/tkinter" "$LIBPY/turtledemo" "$LIBPY/ensurepip" "$LIBPY/site-packages/pip"* "$LIBPY"/config-*
rm -f "$LIBPY"/lib-dynload/_tkinter* "$LIBPY"/lib-dynload/_test* "$PY"/bin/pip* "$PY"/bin/idle* "$PY"/bin/2to3* "$PY"/bin/pydoc*
find "$PY" -name __pycache__ -prune -exec rm -rf {} +
# Precompile now: Python may not write bytecode into the sealed bundle later.
"$PY/bin/python3" -B -m compileall -q -j 0 --invalidation-mode unchecked-hash "$LIBPY"

cp "$HERE/cache/yt-dlp" "$HERE/cache/ffmpeg" "$RES/bin/"
chmod +x "$RES/bin/yt-dlp" "$RES/bin/ffmpeg"
cp "$HERE/cache/ffmpeg.LICENSE" "$HERE/cache/ffmpeg.buildconf" "$RES/licenses/"
FFMPEG_VERSION="$(grep '^FFMPEG_VERSION=' "$HERE/fetch-tools.sh" | cut -d'"' -f2)"
sed "s/@FFMPEG_VERSION@/$FFMPEG_VERSION/" "$HERE/app/NOTICE.txt" > "$RES/licenses/NOTICE.txt"

echo "== Signing ($SIGN_ID)"
while IFS= read -r f; do
  if file -b "$f" | grep -q "Mach-O"; then
    case "$(basename "$f")" in
      python3.*) sign "$f" --entitlements "$HERE/app/tool.entitlements" ;;
      *) sign "$f" ;;
    esac
  fi
done < <(find "$PY" "$RES/bin" -type f)
SPARKLE="$APP/Contents/Frameworks/Sparkle.framework"
sign "$SPARKLE/Versions/B/Autoupdate"
sign "$SPARKLE/Versions/B/Updater.app"
sign "$SPARKLE"
sign "$APP/Contents/PlugIns/Damla Extension.appex" --entitlements "$HERE/app/extension.entitlements"
# Ad-hoc builds need library validation off because strict validation rejects an ad-hoc Sparkle.
if [ "$SIGN_ID" = "-" ]; then
  sign "$APP" --entitlements "$HERE/app/tool.entitlements"
else
  sign "$APP"
fi
codesign --verify --deep --strict --verbose=1 "$APP"

# Running the tools must leave the signature intact.
echo "== Smoke test"
PYTHONDONTWRITEBYTECODE=1 "$PY/bin/python3" -B -I -c "import http.server, json, shutil, ssl, subprocess, threading, urllib.request, uuid"
PYTHONDONTWRITEBYTECODE=1 "$PY/bin/python3" -B -I "$RES/bin/yt-dlp" --version
codesign --verify --deep --strict "$APP"

if [ -n "$NOTARY_PROFILE" ] && [ "$SIGN_ID" != "-" ]; then
  echo "== Notarizing the app"
  APPZIP="$OUT/Damla-app.zip"
  rm -f "$APPZIP"
  ditto -c -k --keepParent "$APP" "$APPZIP"
  xcrun notarytool submit "$APPZIP" --keychain-profile "$NOTARY_PROFILE" --wait
  rm -f "$APPZIP"
  xcrun stapler staple "$APP"
fi

echo "== DMG"
STAGE="$OUT/stage"
rm -rf "$STAGE"; mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
DMG="$OUT/Damla-$VERSION.dmg"
rm -f "$DMG"
hdiutil create -volname "Damla" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
[ "$SIGN_ID" = "-" ] || codesign --force --sign "$SIGN_ID" --timestamp "$DMG"

if [ -n "$NOTARY_PROFILE" ] && [ "$SIGN_ID" != "-" ]; then
  echo "== Notarizing the DMG"
  xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG"
else
  echo "== Notarization skipped (SIGN_ID and NOTARY_PROFILE not set)"
fi
echo "ready: $DMG ($(du -h "$DMG" | cut -f1))"
