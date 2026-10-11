"""Who is listening? Hidden culprit, fingerprint and detector (seeded BasicSimulator)."""

from __future__ import annotations

import json
import math

import pytest
from qiskit.providers.basic_provider import BasicSimulator

from quantum import api, mystery
from tests.helpers import Counting, FakeIonQ, ionq_counting
from tests.test_measure_at_end import check_measure_at_end

OPTS = {"seed_simulator": 5}


@pytest.fixture(autouse=True)
def _fresh_ionq_state():
    api._reset_ionq_state()
    yield
    api._reset_ionq_state()


def seed_of(kind: str) -> int:
    return next(s for s in range(200) if mystery.draw_culprit(s)["kind"] == kind)


def within(m):
    return m["ci95"][0] <= m["theory"] <= m["ci95"][1]


# ------------------------------ culprit ------------------------------------

def test_draw_is_deterministic_and_in_range():
    assert mystery.draw_culprit(7) == mystery.draw_culprit(7)
    kinds = set()
    for s in range(60):
        t = mystery.draw_culprit(s)
        kinds.add(t["kind"])
        assert mystery.F_LO <= t["F"] <= mystery.F_HI
        if t["kind"] == "spy":  # same F range: F = (1 + cos(theta/2))/2
            assert (1 + math.cos(t["theta"] / 2)) / 2 == pytest.approx(t["F"])
            assert 0 < t["theta_deg"] < 131.1  # still violates CHSH
        else:
            assert t["theta"] == 0.0
    assert kinds == {"noise", "spy"}


# ------------------------------ detector -----------------------------------

def test_detector_pure_cases():
    assert mystery.detect(0, 1000, 60, 1000)["verdict"] == "spy"
    assert mystery.detect(40, 1000, 42, 1000)["verdict"] == "noise"
    assert mystery.detect(0, 1000, 0, 1000)["verdict"] == "undecided"
    assert mystery.detect(80, 1000, 10, 1000)["verdict"] == "undecided"  # Z worse than X
    assert mystery.detect(10, 100, 12, 100)["verdict"] == "noise"
    d = mystery.detect(0, 1000, 60, 1000)
    assert d["z"] > 5 and 0.99 < d["confidence"] <= 1 and d["p_value"] < 0.01
    assert mystery.detect(0, 0, 0, 0)["verdict"] == "undecided"
    assert mystery.detect(0, 100, 3, 100)["verdict"] == "undecided"  # too few shots to say


@pytest.mark.parametrize("kind", ["noise", "spy"])
def test_detector_right_on_simulator(kind):
    verdicts = []
    for s in [x for x in range(300) if mystery.draw_culprit(x)["kind"] == kind][:6]:
        r = mystery.run_mystery(BasicSimulator(), s, 4000, seed_simulator=1000 + s)
        assert r["truth"]["kind"] == kind
        verdicts.append(r["detector"]["verdict"])
    assert verdicts.count(kind) >= 5, verdicts
    assert "noise" not in verdicts or kind == "noise"  # a spy is never called noise
    assert "spy" not in verdicts or kind == "spy"      # and vice versa


# ------------------------------ theory / contract --------------------------

@pytest.mark.parametrize("kind", ["noise", "spy"])
def test_theory_matches_formulas_and_metrics_within_ci(kind):
    s = seed_of(kind)
    r = mystery.run_mystery(BasicSimulator(), s, 6000, **OPTS)
    t = r["truth"]
    m = r["metrics"]
    if kind == "noise":
        assert m["qber_Z"]["theory"] == pytest.approx(2 * (1 - t["F"]) / 3)
        assert m["qber_X"]["theory"] == pytest.approx(2 * (1 - t["F"]) / 3)
    else:
        c = math.cos(t["theta"] / 2)
        assert t["c"] == pytest.approx(c)
        assert m["qber_Z"]["theory"] == pytest.approx(0.0)
        assert m["qber_X"]["theory"] == pytest.approx((1 - c) / 2)
        assert m["qber_X"]["theory"] == pytest.approx(1 - t["F"])
    assert m["fidelity"]["theory"] == pytest.approx(t["F"])
    for k in ("qber_Z", "qber_X", "fidelity"):
        assert within(m[k]) or abs(m[k]["value"] - m[k]["theory"]) < 0.01, k
    assert r["level"] == "mystery" and r["shots"] == 6000 and r["backend"]
    assert r["timestamp"] and r["params"]["seed"] == s
    assert set(r["counts"]) == set(mystery.IDS)
    json.dumps(r)


def test_names_do_not_leak_the_kind():
    for kind in ("noise", "spy"):
        r = mystery.run_mystery(BasicSimulator(), seed_of(kind), 200, **OPTS)
        text = json.dumps([[c["id"] for c in r["circuits"]], list(r["counts"]), r["params"]])
        assert "th" not in text and "F0" not in text and "spy" not in text


def test_measure_at_end_builders():
    for kind in ("noise", "spy"):
        for qc in mystery.build_mystery(mystery.draw_culprit(seed_of(kind))):
            check_measure_at_end(qc)


# ------------------------------ API / IonQ ---------------------------------

def test_api_simulator_single_run_and_validation():
    class C(Counting):
        runs = 0

    r = api.mystery(C(), 3, 500)
    assert r["ok"] and C.runs == 1 and len(r["circuits"]) == 2 and r["mode"] == "live"
    assert api.mystery(BasicSimulator(), None, 200)["ok"]  # fresh seed
    assert api.mystery(BasicSimulator(), -1)["ok"] is False
    assert api.mystery(BasicSimulator(), "x")["ok"] is False
    assert api.mystery(BasicSimulator(), 1, shots=1)["ok"] is False
    assert api.mystery(None, 1)["ok"] is False
    assert api.info()["mystery"]["function"] == "mystery" and "mystery" not in api.RUN_LEVELS


@pytest.mark.parametrize("kind", ["noise", "spy"])
def test_ionq_exactly_one_run_one_circuit_and_cache(kind):
    be = ionq_counting()
    s = seed_of(kind)
    r = api.mystery(be, s, 400)
    assert r["ok"] and r["source"] == "ionq_packed" and r["mode"] == "batch" and Counting.runs == 1
    assert len(be.runs) == 1 and len(be.runs[0]) == 1
    check_measure_at_end(be.runs[0][0], 29)
    assert r["truth"]["kind"] == kind and set(r["counts"]) == set(mystery.IDS)
    again = api.mystery(be, s, 400)
    assert again["cached_run"] is True and len(be.runs) == 1
    assert api.mystery(be, s + 1, 400)["code"] == "ionq_job_used" and len(be.runs) == 1
    assert api.run_level(be, "link")["code"] == "ionq_job_used"


def test_ionq_unseeded_same_request_is_cached():
    be = ionq_counting()
    a = api.mystery(be, None, 300)
    b = api.mystery(be, None, 300)
    assert a["ok"] and b["cached_run"] is True and b["truth"] == a["truth"] and len(be.runs) == 1


def test_ionq_too_wide_does_not_burn_job():
    be = FakeIonQ(num_qubits=5)
    out = api.mystery(be, seed_of("noise"), 200)
    assert out["ok"] is False and out["code"] == "ionq_too_wide" and len(be.runs) == 0
    assert api.backend_diag(be)["ionq_job_used"] is False


def test_ionq_submit_error_releases_job():
    be = ionq_counting()
    orig = be.run

    def boom(*a, **k):
        raise RuntimeError("down")
    be.run = boom
    assert api.mystery(be, 2, 100)["ok"] is False
    be.run = orig
    assert api.mystery(be, 2, 100)["ok"]
