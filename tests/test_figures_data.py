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


def test_ionq_sim_recording_has_figure_metrics():
    rec = mf.load_recordings()[mf.IONQ_SIM_FILE]
    assert rec["backend"] == "ionq_simulator"
    assert rec["shots"] == 1000
    # Reduced to fit 29 qubits: no fixed-DEJMPS baseline and no reroute on IonQ.
    assert "fidelity_fixed" not in rec["levels"]["purify"]["metrics"]
    assert "fidelity_reroute" not in rec["levels"]["rescue"]["metrics"]


def test_replay_reproduces_ionq_sim_recording():
    import json
    import sys

    sys.path.insert(0, str(ROOT))
    from tools import replay_ionq_sim as rp

    raw = json.loads(rp.RAW_PATH.read_text(encoding="utf-8"))
    rebuilt = rp.build_recording(raw)
    committed = mf.load_recordings()[mf.IONQ_SIM_FILE]
    assert rebuilt["levels"]["link"]["metrics"]["fidelity"]["value"] == \
        committed["levels"]["link"]["metrics"]["fidelity"]["value"]
    assert round(rebuilt["levels"]["link"]["metrics"]["fidelity"]["value"], 3) == 0.988
    assert round(rebuilt["levels"]["qkd"]["metrics"]["qber_X"]["value"], 3) == 0.272
