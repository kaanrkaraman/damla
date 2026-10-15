#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CACHE="$HERE/cache"
mkdir -p "$CACHE"

PYTHON_TAG="20261013"
PYTHON_ASSET="cpython-3.13.16+${PYTHON_TAG}-aarch64-apple-darwin-install_only.tar.gz"
YTDLP_TAG="2026.08.19"
FFMPEG_VERSION="9.0.2"
SPARKLE_VERSION="2.10.0"

fetch() {
  local url="$1" out="$2"
  if [ ! -f "$CACHE/$out" ]; then
    echo "downloading: $out"
    curl -fL --retry 3 -o "$CACHE/$out.part" "$url"
    mv "$CACHE/$out.part" "$CACHE/$out"
  fi
  local want have
  have="$(shasum -a 256 "$CACHE/$out" | cut -d' ' -f1)"
  want="$(grep " $out\$" "$HERE/checksums.txt" 2>/dev/null | cut -d' ' -f1 || true)"
  if [ -z "$want" ]; then
    echo "$have  $out" | sed 's/  / /' >> "$HERE/checksums.txt"
    echo "sha256 recorded: $out"
  elif [ "$want" != "$have" ]; then
    echo "SHA256 MISMATCH: $out" >&2
    exit 1
  fi
}

fetch "https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_TAG}/${PYTHON_ASSET//+/%2B}" "python.tar.gz"
fetch "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_TAG}/yt-dlp" "yt-dlp"
fetch "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" "ffmpeg-src.tar.xz"
fetch "https://github.com/sparkle-project/Sparkle/releases/download/${SPARKLE_VERSION}/Sparkle-${SPARKLE_VERSION}.tar.xz" "sparkle.tar.xz"
if [ ! -d "$CACHE/Sparkle" ]; then
  mkdir -p "$CACHE/Sparkle"
  tar -xJf "$CACHE/sparkle.tar.xz" -C "$CACHE/Sparkle"
fi
echo "tools ready: $CACHE"
