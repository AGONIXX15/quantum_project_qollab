"""Rebuild data/recorded/ionq_sim_forte1.json from the raw IonQ Forte 1 simulator counts.

Each chapter was run once on Qollab with the free "IonQ Forte 1 (29q)" noise-model
simulator (one Run = one level = one packed circuit). The raw packed counts of every
job are stored in data/recorded/ionq_sim_forte1_raw.json; this script replays them
through the real decoder (``batch.run_level_packed``, default parameters, seed 0) so
the recording is exactly what the app decoded on Qollab. Run from the repo root::

    uv run --python /usr/bin/python3.14 python tools/replay_ionq_sim.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from quantum import batch  # noqa: E402
from tools.replay_ionq_recording import ReplayBackend  # noqa: E402

RAW_PATH = ROOT / "data" / "recorded" / "ionq_sim_forte1_raw.json"
OUT_PATH = ROOT / "data" / "recorded" / "ionq_sim_forte1.json"


def build_recording(raw: dict[str, Any]) -> dict[str, Any]:
    """Decode every level of ``raw`` into the ``load_recorded`` file shape."""
    shots = int(raw["shots"])
    levels: dict[str, Any] = {}
    for level, lv in raw["levels"].items():
        if sum(lv["counts"].values()) != shots:
            raise ValueError(f"{level}: raw counts do not sum to shots")
        backend = ReplayBackend(raw["backend"], lv["counts"], int(raw["cap"]))
        res = batch.run_level_packed(backend, level, shots, 0, None)
        res["timestamp"] = lv["timestamp"]
        res["ok"] = True
        res["source"] = "ionq_packed"
        res["recorded_from"] = f"{raw['backend']} ({raw['device']} noise model, free simulator)"
        levels[level] = res
    stamps = sorted(lv["timestamp"] for lv in raw["levels"].values())
    return {"ok": True, "mode": "recorded", "backend": raw["backend"], "timestamp": stamps[-1],
            "shots": shots, "levels": levels}


def main() -> None:
    raw = json.loads(RAW_PATH.read_text(encoding="utf-8"))
    rec = build_recording(raw)
    OUT_PATH.write_text(json.dumps(rec, indent=1), encoding="utf-8")
    print(f"wrote {OUT_PATH.relative_to(ROOT)} ({OUT_PATH.stat().st_size} bytes)")
    for level, res in rec["levels"].items():
        m = res["metrics"]
        key = next(k for k in m if k.startswith("fidelity") or k.startswith("qber"))
        print(f"  {level:9s} {key} = {m[key]['value']:.4f}")


if __name__ == "__main__":
    main()
