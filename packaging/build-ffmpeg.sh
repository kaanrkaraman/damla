#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CACHE="$HERE/cache"
WORK="$HERE/build/ffmpeg-src"

[ -f "$CACHE/ffmpeg-src.tar.xz" ] || "$HERE/fetch-tools.sh"
[ -x "$CACHE/ffmpeg" ] && { echo "ffmpeg hazır: $CACHE/ffmpeg"; exit 0; }

rm -rf "$WORK"
mkdir -p "$WORK"
tar -xJf "$CACHE/ffmpeg-src.tar.xz" -C "$WORK" --strip-components=1
cd "$WORK"

./configure \
  --arch=arm64 \
  --disable-gpl --disable-nonfree --disable-autodetect \
  --disable-shared --enable-static \
  --enable-videotoolbox --enable-audiotoolbox \
  --disable-ffplay --disable-ffprobe --disable-doc --disable-debug \
  --extra-cflags="-mmacosx-version-min=14.0" --extra-ldflags="-mmacosx-version-min=14.0"

make -j"$(sysctl -n hw.ncpu)"
strip ffmpeg
cp ffmpeg "$CACHE/ffmpeg"
cp COPYING.LGPLv2.1 "$CACHE/ffmpeg.LICENSE"
./ffmpeg -hide_banner -buildconf | grep -E "enable|disable" | tr -s ' ' > "$CACHE/ffmpeg.buildconf"
echo "ffmpeg derlendi: $CACHE/ffmpeg"
