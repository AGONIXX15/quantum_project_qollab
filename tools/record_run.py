"""Record a full batch on the local BasicSimulator into data/recorded/ (local tool, not uploaded).

Usage (from the repo root): ``uv run python tools/record_run.py``
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from qiskit.providers.basic_provider import BasicSimulator  # noqa: E402

from quantum import api  # noqa: E402

SEED = 20261009
OUT = ROOT / "data" / "recorded" / "basic_simulator_full.json"


def main() -> int:
    result = api.full_batch(BasicSimulator(), seed=SEED)
    if not result.get("ok"):
        print("full_batch failed:", result.get("error"))
        return 1
    bad = [k for k, v in result["levels"].items() if not v.get("ok")]
    if bad:
        print("levels failed:", bad)
        return 1
    data = json.dumps(result, indent=1)
    size = len(data.encode("utf-8"))
    if size >= 2_000_000:
        print(f"too large: {size} bytes (Qollab limit 2 MB)")
        return 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(data, encoding="utf-8")
    print(f"wrote {OUT} ({size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
