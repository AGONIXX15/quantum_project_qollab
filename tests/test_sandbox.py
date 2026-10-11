"""Sandbox: user-built network, route choice, real swap chain (seeded BasicSimulator)."""

from __future__ import annotations

import copy
import json

import pytest
from qiskit.providers.basic_provider import BasicSimulator

from quantum import api, sandbox, swap
from tests.helpers import Counting, FakeIonQ, ionq_counting
from tests.test_measure_at_end import check_measure_at_end

OPTS = {"seed_simulator": 3}


@pytest.fixture(autouse=True)
def _fresh_ionq_state():
    api._reset_ionq_state()
    yield
    api._reset_ionq_state()


def node(i, lat=4.7, lon=-74.0):
    return {"id": i, "name": i, "lat": lat, "lon": lon}


def chain(Fs, extra_nodes=()):
    """Line graph N0-N1-...-Nk spread along a meridian."""
    ids = [f"N{i}" for i in range(len(Fs) + 1)]
    nodes = [node(n, lat=2.0 + 0.5 * i) for i, n in enumerate(ids)]
    links = [{"a": a, "b": b, "F": F} for a, b, F in zip(ids, ids[1:], Fs)]
    return {"nodes": nodes + list(extra_nodes), "links": links, "src": ids[0], "dst": ids[-1]}


def within(m):
    return m["ci95"][0] <= m["theory"] <= m["ci95"][1]


def run(graph, shots=4000, backend=None):
    return sandbox.run_sandbox(backend or BasicSimulator(), sandbox.validate_graph(graph), shots, 5, **OPTS)


# ------------------------------ validation ---------------------------------

def bad(mut):
    g = chain([0.9, 0.8])
    mut(g)
    return g


@pytest.mark.parametrize("graph", [
    bad(lambda g: g["nodes"].__setitem__(slice(None), g["nodes"][:1])),
    bad(lambda g: g["nodes"].append(node("N0"))),
    bad(lambda g: g["nodes"].append(node("bad id"))),
    bad(lambda g: g["nodes"].append(node("X" * 13))),
    bad(lambda g: g["nodes"].append(node("Z", lat=20))),
    bad(lambda g: g["nodes"].append(node("Z", lon=-100))),
    bad(lambda g: g["links"].clear()),
    bad(lambda g: g["links"].append({"a": "N0", "b": "N0", "F": 0.9})),
    bad(lambda g: g["links"].append({"a": "N1", "b": "N0", "F": 0.9})),
    bad(lambda g: g["links"].append({"a": "N0", "b": "NOPE", "F": 0.9})),
    bad(lambda g: g["links"][0].__setitem__("F", 0.4)),
    bad(lambda g: g["links"][0].__setitem__("F", 1.1)),
    bad(lambda g: g["links"][0].__setitem__("F", "x")),
    bad(lambda g: g.__setitem__("dst", "N0")),
    bad(lambda g: g.__setitem__("dst", "NOPE")),
    bad(lambda g: g["nodes"].append(node("ISO")) or g.__setitem__("dst", "ISO")),  # no route
    "not a graph", None, {"nodes": 3, "links": []},
])
def test_validation_errors(graph):
    with pytest.raises(sandbox.V.InputError):
        sandbox.validate_graph(graph)
    out = api.sandbox(BasicSimulator(), graph)
    assert out["ok"] is False and out["input_error"] is True and out["error"]
    json.dumps(out)


def test_validation_limits():
    many = [node(f"M{i}") for i in range(13)]
    g = {"nodes": many, "links": [{"a": "M0", "b": "M1", "F": 0.9}], "src": "M0", "dst": "M1"}
    with pytest.raises(sandbox.V.InputError, match="2 to 12 nodes"):
        sandbox.validate_graph(g)
    g = chain([0.9])
    g["nodes"] += [node(f"E{i}") for i in range(10)]
    g["links"] = [{"a": f"E{i}", "b": f"E{i+1}", "F": 0.9} for i in range(9)] * 3 \
        + [{"a": "N0", "b": "N1", "F": 0.9}]
    with pytest.raises(sandbox.V.InputError):
        sandbox.validate_graph(g)


def test_bad_shots_and_seed_are_envelopes():
    assert api.sandbox(BasicSimulator(), chain([0.9]), shots=1)["ok"] is False
    assert api.sandbox(None, chain([0.9]))["ok"] is False
    assert api.sandbox(BasicSimulator(), chain([0.9]), seed="x")["ok"] is False


# ------------------------------ physics ------------------------------------

def test_one_hop_matches_werner():
    r = run(chain([0.8]))
    m = r["metrics"]["fidelity"]
    assert m["theory"] == pytest.approx(0.8) and within(m)
    assert r["route"] == ["N0", "N1"] and len(r["hops"]) == 1


@pytest.mark.parametrize("F1,F2", [(0.9, 0.85), (1.0, 1.0), (0.7, 0.6)])
def test_two_hops_match_theory_swap_and_level(F1, F2):
    r = run(chain([F1, F2]), shots=6000)
    th = swap.theory_swap(F1, F2)
    m = r["metrics"]["fidelity"]
    assert m["theory"] == pytest.approx(th["F"]) and within(m)
    for p in ("XX", "YY", "ZZ"):
        assert within(r["metrics"][f"corr_{p}"])
    level = swap.run_swap(BasicSimulator(), 6000, F1, F2, "precision", **OPTS)["metrics"]["fidelity"]
    assert abs(m["value"] - level["value"]) < 3 * ((m["ci95"][1] - m["ci95"][0]) / 2
                                                    + (level["ci95"][1] - level["ci95"][0]) / 2)
    assert r["metrics"]["theory_route_F"]["value"] == pytest.approx(th["F"])


def test_frame_matches_swap_for_two_hops():
    assert sandbox.frame_bits(2) == swap._FRAME
    assert sandbox.frame_bits(1) == {"XX": [], "ZZ": [], "YY": []}


def test_five_hops_runs_and_is_consistent():
    Fs = [0.97, 0.95, 0.98, 0.96, 0.97]
    r = run(chain(Fs), shots=6000)
    assert len(r["hops"]) == 5 and within(r["metrics"]["fidelity"])
    assert all(c["qubits"] <= 16 for c in r["circuits"])
    for qc in sandbox.build_sandbox(5):
        check_measure_at_end(qc)
    json.dumps(r)


def test_route_choice_prefers_better_path_and_reports_alternatives():
    g = {"nodes": [node("A", 4, -74), node("B", 5, -74), node("C", 6, -74), node("D", 5, -73)],
         "links": [{"a": "A", "b": "D", "F": 0.7}, {"a": "D", "b": "C", "F": 0.7},
                   {"a": "A", "b": "B", "F": 0.97}, {"a": "B", "b": "C", "F": 0.97},
                   {"a": "A", "b": "C", "F": 0.6}], "src": "A", "dst": "C"}
    r = run(g, shots=2000)
    assert r["route"] == ["A", "B", "C"]
    alts = r["alternatives"]
    assert len(alts) == 3 and alts[0]["chosen"] and alts[0]["F_theory"] >= alts[1]["F_theory"]
    assert {tuple(a["route"]) for a in alts} == {("A", "B", "C"), ("A", "D", "C"), ("A", "C")}
    # tie -> fewer hops
    g2 = chain([1.0])
    g2["nodes"].append(node("M", 3.0))
    g2["links"] += [{"a": "N0", "b": "M", "F": 1.0}, {"a": "M", "b": "N1", "F": 1.0}]
    assert run(g2, 500)["route"] == ["N0", "N1"]


def test_geometry_and_rate_metrics():
    r = run(chain([0.9, 0.9]), shots=500)
    h = r["hops"][0]
    assert h["length_km"] == pytest.approx(h["great_circle_km"] * 1.3)
    assert h["great_circle_km"] == pytest.approx(55.6, abs=0.5)  # 0.5 deg of latitude
    import math
    assert h["loss_db"] == pytest.approx(-10 * math.log10(h["eta"]))
    eta = min(x["eta"] for x in r["hops"])
    assert r["metrics"]["eta_route"]["value"] == pytest.approx(eta)
    assert r["metrics"]["raw_pairs_per_delivered"]["value"] == pytest.approx(2 / eta)
    for k in ("key_rate_shor_preskill", "key_rate_lca_biased"):
        assert 0 <= r["metrics"][k]["value"] <= 1
    assert [v["status"] for v in r["viz"]["links"]] == ["healthy", "healthy"]
    assert r["level"] == "sandbox" and r["bit_order"].startswith("Qiskit little-endian")
    assert r["viz"]["links"][0]["id"] == "N0-N1"
    low = run(chain([0.5]), shots=300)
    assert low["viz"]["links"][0]["status"] == "broken"
    assert sandbox.classify_fidelity(0.75) == "degraded"


def test_hop_limit_on_simulator():
    r = api.sandbox(BasicSimulator(), chain([0.9] * 7), shots=100)
    assert r["ok"] is False and r["input_error"] is True


# ------------------------------ API / IonQ ----------------------------------

def test_api_simulator_single_run():
    class C(Counting):
        runs = 0

    r = api.sandbox(C(), chain([0.9, 0.8]), 500, 1)
    assert r["ok"] and C.runs == 1 and len(r["circuits"]) == 3
    assert api.info()["sandbox"]["max_nodes"] == 12 and "sandbox" not in api.RUN_LEVELS


def test_api_accepts_jsproxy_like_objects():
    class Proxy:
        def __init__(self, v):
            self.v = v

        def to_py(self):
            return self.v
    g = chain([0.9])
    r = api.sandbox(BasicSimulator(), Proxy({"nodes": Proxy(g["nodes"]), "links": g["links"],
                                             "src": "N0", "dst": "N1"}), 200)
    assert r["ok"], r


def test_ionq_exactly_one_run_one_circuit_and_cache():
    be = ionq_counting()
    g = chain([0.95, 0.9, 0.92])
    r = api.sandbox(be, g, 300, 2)
    assert r["ok"] and r["source"] == "ionq_packed" and Counting.runs == 1
    assert len(be.runs) == 1 and len(be.runs[0]) == 1
    assert be.runs[0][0].num_qubits == 18  # 3 circuits x 6 qubits
    check_measure_at_end(be.runs[0][0], 29)
    again = api.sandbox(be, g, 300, 2)
    assert again["cached_run"] is True and len(be.runs) == 1
    other = api.sandbox(be, chain([0.9]), 300, 2)
    assert other["code"] == "ionq_job_used" and len(be.runs) == 1
    assert api.run_level(be, "link")["code"] == "ionq_job_used"


def test_ionq_hop_limit_picks_route_that_fits():
    be = FakeIonQ(num_qubits=25)  # 4 hops max
    assert sandbox.max_hops_for(be) == 4
    g = chain([0.9, 0.9], extra_nodes=[])  # N0-N1-N2
    g["nodes"] += [node(f"L{i}", 8 + i * 0.1) for i in range(5)]
    g["links"] += [{"a": "N0", "b": "L0", "F": 0.999}] + [
        {"a": f"L{i}", "b": f"L{i+1}", "F": 0.999} for i in range(4)] + [{"a": "L4", "b": "N2", "F": 0.999}]
    r = api.sandbox(be, g, 200, 0)
    assert r["ok"] and r["route"] == ["N0", "N1", "N2"] and r["route_limited"] is True
    assert len(be.runs) == 1


def test_ionq_too_wide_does_not_burn_job():
    be = ionq_counting()
    be.num_qubits = 12  # 2 hops max
    out = api.sandbox(be, chain([0.9] * 3), 200, 0)
    assert out["ok"] is False and out["code"] == "ionq_too_wide"
    assert len(be.runs) == 0 and Counting.runs == 0
    assert api.backend_diag(be)["ionq_job_used"] is False
    ok = api.sandbox(be, chain([0.9, 0.9]), 200, 0)
    assert ok["ok"] and len(be.runs) == 1


def test_ionq_bad_input_does_not_burn_job():
    be = ionq_counting()
    assert api.sandbox(be, {"nodes": []})["ok"] is False
    assert api.backend_diag(be)["ionq_job_used"] is False


def test_ionq_submit_error_releases_job():
    be = ionq_counting()
    orig = be.run

    def boom(*a, **k):
        raise RuntimeError("down")
    be.run = boom
    out = api.sandbox(be, chain([0.9]), 100)
    assert out["ok"] is False
    be.run = orig
    assert api.sandbox(be, chain([0.9]), 100)["ok"]


# ------------------------------ presets -------------------------------------

def test_presets_inside_bbox():
    p = api.sandbox_presets()
    assert p["ok"] and 12 <= len(p["cities"]) <= 20
    ids = [c["id"] for c in p["cities"]]
    assert len(set(ids)) == len(ids)
    for c in p["cities"]:
        assert -8 <= c["lat"] <= 16 and -92 <= c["lon"] <= -58, c
    g = copy.deepcopy(p["example"])
    pos = {c["id"]: c for c in p["cities"]}
    g["nodes"] = [pos[i] for i in g["nodes"]]
    assert api.sandbox(BasicSimulator(), g, 200)["ok"]
