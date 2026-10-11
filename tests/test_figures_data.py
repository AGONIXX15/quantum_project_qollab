"""The README figures rely on fields of the recorded JSON; fail early if they disappear."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("make_figures", ROOT / "tools" / "make_figures.py")
mf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mf)


def test_recorded_fields_for_figures():
    recs = mf.load_recordings()
    for fname, pairs in mf.REQUIRED_METRICS.items():
        for level, key in pairs:
            m = mf.metric(recs[fname], level, key)
            lo, hi = m["ci95"]
            assert lo <= m["value"] <= hi, (fname, level, key)
    assert recs[mf.QPU_FILE]["backend"].startswith("ionq")
    assert recs[mf.SIM_FILE]["shots"] == 1000
    assert "gamma" in recs[mf.SIM_FILE]["levels"]["purify"]["params"]["noise"]
