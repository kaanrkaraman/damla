#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "== Python"
uv run --quiet ruff format --check .
uv run --quiet ruff check .
uv run --quiet ty check
uv run --quiet pytest --quiet

echo "== TypeScript"
node_modules/.bin/tsc --noEmit
node_modules/.bin/biome check .

echo "== Swift"
xcrun swift-format lint --strict --recursive Damla

echo "== Shell"
shellcheck packaging/*.sh scripts/*.sh .githooks/*

echo "== Consistency"
python3 -I scripts/check.py
