#!/usr/bin/env bash
# Build dist/qollab_smoke/: the smoke harness at the root plus quantum/, data/ and requirements.txt.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/dist/qollab_smoke"
rm -rf "$DEST"
mkdir -p "$DEST"
cp "$ROOT"/tools/qollab_smoke/index.html "$ROOT"/tools/qollab_smoke/main.js "$ROOT"/tools/qollab_smoke/main.css "$DEST"/
cp -r "$ROOT/quantum" "$DEST/quantum"
find "$DEST/quantum" -name "__pycache__" -type d -prune -exec rm -rf {} +
cp -r "$ROOT/data" "$DEST/data"
cp "$ROOT/requirements.txt" "$DEST/requirements.txt"
echo "Built $DEST ($(find "$DEST" -type f | wc -l) files)"
