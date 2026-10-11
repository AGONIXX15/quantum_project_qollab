"""Rebuild data/recorded/ionq_qpu_link.json from the raw IonQ Forte 1 packed counts.

Replays data/recorded/ionq_qpu_forte1_link_raw.json through the real decoder
(``batch.run_level_packed``) with a fake backend, so the recording is exactly what the
app decoded on Qollab. Run from the repo root (``app`` layout: this repo root)::

    uv run --python /usr/bin/python3.14 python tools/replay_ionq_recording.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from quantum import batch  # noqa: E402

RAW_PATH = ROOT / "data" / "recorded" / "ionq_qpu_forte1_link_raw.json"
OUT_PATH = ROOT / "data" / "recorded" / "ionq_qpu_link.json"


class ReplayBackend:
    """Fake IonQ backend that returns the recorded raw packed counts."""

    def __init__(self, name: str, counts: dict[str, int], num_qubits: int = 36) -> None:
        self.name = name
        self.num_qubits = num_qubits
        self._counts = counts

    def run(self, _circuit: Any, shots: int = 1000, **_kw: Any) -> Any:
        counts = self._counts

        class _Result:
            def get_counts(self, *_a: Any) -> dict[str, int]:
                return dict(counts)

        class _Job:
            def result(self) -> _Result:
                return _Result()

        return _Job()


def build_recording(raw: dict[str, Any]) -> dict[str, Any]:
    """Decode ``raw`` (see the raw JSON file) into the ``load_recorded`` file shape."""
    shots = int(raw["shots"])
    if sum(raw["counts"].values()) != shots:
        raise ValueError("raw counts do not sum to shots")
    res = batch.run_level_packed(ReplayBackend(raw["backend"], raw["counts"]), raw["level"], shots, 0, None)
    res["timestamp"] = raw["timestamp"]
    res["ok"] = True
    res["source"] = "ionq_packed"
    res["recorded_from"] = f"{raw['backend']} (real hardware)"
    return {"ok": True, "mode": "recorded", "backend": raw["backend"], "timestamp": raw["timestamp"],
            "shots": shots, "levels": {raw["level"]: res}}


def main() -> None:
    raw = json.loads(RAW_PATH.read_text(encoding="utf-8"))
    rec = build_recording(raw)
    OUT_PATH.write_text(json.dumps(rec, indent=1), encoding="utf-8")
    m = rec["levels"][raw["level"]]["metrics"]["fidelity"]
    print(f"wrote {OUT_PATH.relative_to(ROOT)} ({OUT_PATH.stat().st_size} bytes); "
          f"F={m['value']:.4f} ci95={m['ci95']}")


if __name__ == "__main__":
    main()
