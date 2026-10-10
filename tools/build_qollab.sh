#!/usr/bin/env bash
# Build dist/qollab_app/ and dist/qollab_app.zip: the project to upload to Qollab.
# Contents: index.html (body only), main.js, main.css, ui/*.js, quantum/, data/, requirements.txt,
# README.md, LICENSE. Excluded: dev/ (local only), tools/, tests/, docs/, __pycache__.
# Fails if there are more than 100 files, any file is over 2 MB, or a relative import does not resolve.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/dist/qollab_app"
ZIP="$ROOT/dist/qollab_app.zip"
rm -rf "$DEST" "$ZIP"
mkdir -p "$DEST/ui"
cp "$ROOT"/index.html "$ROOT"/main.js "$ROOT"/main.css "$ROOT"/requirements.txt "$ROOT"/README.md "$ROOT"/LICENSE "$DEST"/
for f in "$ROOT"/ui/*.js; do
  case "$(basename "$f")" in mock-*) continue ;; esac   # local-only mocks are not bundled
  cp "$f" "$DEST/ui/"
done
mkdir -p "$DEST/ui/data"
cp "$ROOT"/ui/data/*.js "$DEST/ui/data/"
cp -r "$ROOT/quantum" "$DEST/quantum"
find "$DEST/quantum" -name "__pycache__" -type d -prune -exec rm -rf {} +
find "$DEST/quantum" -name "*.pyc" -delete
cp -r "$ROOT/data" "$DEST/data"
find "$DEST/data" -name ".gitkeep" -delete
if find "$DEST" -type f -iname "*mock*" | grep -q .; then echo "FAIL: a bundled file name contains 'mock'" >&2; exit 1; fi

COUNT="$(find "$DEST" -type f | wc -l)"
if [ "$COUNT" -gt 100 ]; then echo "FAIL: $COUNT files (limit 100)" >&2; exit 1; fi
BIG="$(find "$DEST" -type f -size +2097152c)"
if [ -n "$BIG" ]; then echo "FAIL: files over 2 MB:" >&2; echo "$BIG" >&2; exit 1; fi
# No functional reference to dev/ (import, src, href, url(...)); comments may mention it.
if grep -rIEl "(from|import|src=|href=|url\()[[:space:]]*[\"']?[./]*dev/" "$DEST"/index.html "$DEST"/main.js "$DEST"/main.css "$DEST"/ui 2>/dev/null | grep -q .; then
  echo "FAIL: a shipped file loads something from dev/" >&2; exit 1
fi
# Imports: relative ones must resolve; the only bare specifiers allowed are three, three/addons/* and
# quantum.api; no dynamic import( anywhere in the bundled JS.
node - "$DEST" <<'JS'
const fs = require('fs'), path = require('path');
const root = process.argv[2]; let bad = 0;
const files = [path.join(root, 'main.js'), ...fs.readdirSync(path.join(root, 'ui')).filter((f) => f.endsWith('.js')).map((f) => path.join(root, 'ui', f)), ...fs.readdirSync(path.join(root, 'ui', 'data')).filter((f) => f.endsWith('.js')).map((f) => path.join(root, 'ui', 'data', f))];
const allowed = (s) => s === 'three' || s.startsWith('three/addons/') || s === 'quantum.api';
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'); // drop comments
  if (/\bimport\s*\(/.test(src)) { console.error('FAIL: dynamic import() in', f); bad++; }
  for (const m of src.matchAll(/(?:import|export)[^'"`;]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']/g)) {
    const spec = m[1] || m[2];
    if (spec.startsWith('.')) {
      if (!fs.existsSync(path.resolve(path.dirname(f), spec))) { console.error('FAIL: unresolved import', f, spec); bad++; }
    } else if (!allowed(spec)) { console.error('FAIL: bare specifier not allowed', f, spec); bad++; }
  }
}
process.exit(bad ? 1 : 0);
JS
(cd "$DEST" && python3 - "$ZIP" <<'PY'
import os, sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    for base, _, names in sorted(os.walk(".")):
        for n in sorted(names):
            p = os.path.join(base, n)
            z.write(p, os.path.relpath(p, "."))
PY
)
echo "Built $DEST ($COUNT files) and $ZIP"
