#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

uv run --quiet ruff format .
uv run --quiet ruff check --fix .
node_modules/.bin/biome check --write .
xcrun swift-format format --in-place --recursive Damla
