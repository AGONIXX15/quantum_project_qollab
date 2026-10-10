"""Tests for geo, rescue, batch and the api facade."""

import json
import math

import numpy as np  # noqa: F401
import pytest
from qiskit.providers.basic_provider import BasicSimulator

from quantum import analysis as an
from quantum import api, batch, geo, noise, rescue, swap
from tests.test_measure_at_end import check_measure_at_end

OPTS = {"seed_simulator": 11}


class Counting(BasicSimulator):
    runs = 0

    def run(self, *a, **k):
        type(self).runs += 1
        return super().run(*a, **k)


class FakeIonQ:
    """Minimal stand-in: only the name matters for the IonQ guard."""

    name = "ionq_simulator"


# ------------------------------- geo ---------------------------------------

def test_geo_distances_and_eta():
    d = geo.haversine_km("BOG", "MED")
    assert 235 < d < 245
    assert geo.link_length_km("BOG", "MED") == pytest.approx(d * 1.3)
    assert geo.transmissivity(100.0) == pytest.approx(1e-2)  # 20 dB
    assert geo.expected_pair_rate(1e6, 100.0) == pytest.approx(1e4)
    assert geo.reroute_links("CAL-BOG") == ("BOG-MED", "MED-CAL")
    assert geo.third_city("BOG-CAL") == "MED"
    with pytest.raises(ValueError):
        geo.normalize_link("BOG-XXX")


def test_geo_projection_and_json():
    info = geo.geo_info()
    json.dumps(info)
    for c in info["cities"].values():
        assert -1 <= c["x"] <= 1 and -1 <= c["z"] <= 1
    assert info["cities"]["CTG"]["z"] < info["cities"]["BOG"]["z"]  # Cartagena is north
    assert [l["id"] for l in info["links"]] == list(geo.LINK_IDS)


# ----------------------------- rescue --------------------------------------

def test_rescue_werner_reroute_recommended():
    be = Counting()
    Counting.runs = 0
    r = rescue.run_rescue(be, 2000, damage={"kind": "werner", "F": 0.7}, target_F=0.85,
                          healthy_F=0.95, **OPTS)
    assert Counting.runs == 1 and len(r["circuits"]) <= 16
    rec = r["viz"]["recommendation"]
    assert rec["strategy"] == "reroute" and rec["meets_target"]
    fid = r["metrics"]["fidelity_reroute"]
    assert fid["theory"] == pytest.approx(0.9033, abs=1e-3)
    assert fid["ci95"][0] <= fid["theory"] <= fid["ci95"][1]
    assert r["viz"]["links"]["BOG-CAL"]["status"] == "rescued"
    assert r["viz"]["links"]["BOG-MED"]["status"] == "healthy"
    assert r["metrics"]["raw_pairs_reroute"]["value"] == 2.0
    json.dumps(r)


def test_rescue_fiber_loss_model_and_criterion():
    r = rescue.run_rescue(BasicSimulator(), 1500, damage={"kind": "werner", "F": 0.7},
                          target_F=0.85, **OPTS)
    g = r["viz"]["geo"]
    hops = g["reroute"]["hops"]
    assert g["reroute"]["eta_ideal_memory"] == pytest.approx(min(hops.values()))
    assert g["reroute"]["eta_no_memory"] == pytest.approx(math.prod(hops.values()))
    assert g["reroute"]["loss_db_ideal_memory"] == pytest.approx(-10 * math.log10(min(hops.values())))
    assert g["direct"]["loss_db"] == pytest.approx(79.8, abs=0.3)
    by = {s["key"]: s for s in r["viz"]["strategies"]}
    assert by["reroute"]["raw_pairs_per_delivered"] == pytest.approx(2.0 / min(hops.values()))
    assert by["direct"]["raw_pairs_per_delivered"] == pytest.approx(1.0 / g["direct"]["eta"])
    assert by["reroute"]["key_per_raw_pair"]["lca_biased"] == pytest.approx(
        r["metrics"]["key_rate_lca_biased_reroute"]["value"] / 2.0)
    rec = r["viz"]["recommendation"]
    assert "including fiber loss" in rec["criterion"] and "criterion" in rec["message"].lower()
    assert rec["fewest_raw_pairs_ignoring_loss"] == "reroute"


def test_rescue_loss_breaks_ties_between_strategies():
    # damping: both purify and (with healthy 0.95) nothing else meets 0.95; loosen so several meet
    r = rescue.run_rescue(BasicSimulator(), 3000, damage={"kind": "damping", "gamma": 0.2},
                          target_F=0.85, **OPTS)
    meeting = [s for s in r["viz"]["strategies"] if s["meets_target"]]
    assert len(meeting) >= 2
    best = min(meeting, key=lambda s: s["raw_pairs_per_delivered"])
    assert r["viz"]["recommendation"]["strategy"] == best["key"]


def test_rescue_no_data_status():
    dmg = {"kind": "werner", "F": 0.7}
    circuits, _ = rescue.build_rescue(dmg, 0.95, "teaching")
    counts = {}
    for qc in circuits:
        if qc.name.startswith("swap"):
            counts[qc.name] = {"0000": 100}
        elif qc.name.startswith("pur_tomo"):
            counts[qc.name] = {"00": 50, "11": 50}
        else:  # purify circuits: A2 != B2 in every shot, so postselection rejects all
            counts[qc.name] = {"0100": 100}
    out = rescue.decode_rescue(counts, dmg, target_F=0.85, mode="teaching")
    st = {s["key"]: s for s in out["viz"]["strategies"]}
    assert st["purify_fixed"]["status"] == "no_data" and not st["purify_fixed"]["meets_target"]
    assert "fidelity_purify_fixed" not in out["metrics"]
    assert out["viz"]["recommendation"]["strategy"] in (None, "reroute", "direct")


def test_rescue_validation():
    for bad in ({"kind": "werner", "F": 0.1}, {"kind": "x"}, {"kind": "spy", "theta": 9}):
        with pytest.raises(ValueError):
            rescue.plan_rescue(bad)
    with pytest.raises(ValueError):
        rescue.run_rescue(BasicSimulator(), 100, target_F=0)


def test_rescue_circuits_measure_at_end():
    for dmg in ({"kind": "werner", "F": 0.7}, {"kind": "damping", "gamma": 0.2},
                {"kind": "spy", "theta": 2.0}):
        circuits, _ = rescue.build_rescue(dmg, 0.9)
        assert len(circuits) <= 16
        for qc in circuits:
            check_measure_at_end(qc)


# ------------------------------ readout ------------------------------------

def test_readout_mitigation_recovers_ideal():
    e0, e1 = [0.02, 0.03], [0.05, 0.04]
    N = 200000
    dist = {}
    for true in (0, 3):  # perfect Bell ZZ=1: 00 or 11
        for r in range(4):
            pr = 1.0
            for i in range(2):
                tb, rb = (true >> i) & 1, (r >> i) & 1
                pe = e0[i] if tb == 0 else e1[i]
                pr *= pe if rb != tb else 1 - pe
            dist[format(r, "02b")] = dist.get(format(r, "02b"), 0) + 0.5 * pr
    counts = {k: int(round(v * N)) for k, v in dist.items()}
    raw = an.correlator(counts, [0, 1])["value"]
    mit = an.mitigated_correlator(counts, [0, 1], e0 + [0, 0], e1 + [0, 0])
    assert raw < 0.9 and mit["value"] == pytest.approx(1.0, abs=2e-3)
    assert mit["ci95"][0] <= 1.0 <= mit["ci95"][1] + 1e-9
    zero = an.mitigated_correlator(counts, [0, 1], [0, 0], [0, 0])
    assert zero["value"] == pytest.approx(raw)


# ------------------------------- batch -------------------------------------

def test_batch_limit_dedupe_and_levels():
    circuits, index = batch.build_full_batch()
    assert len(circuits) <= batch.MAX_BATCH == 40 and index["total"] == len(circuits)
    names = [c.name for c in circuits]
    assert len(set(names)) == len(names)
    assert index["per_level"]["noise"]["new"] == 0       # shares the level-1 circuits
    assert index["per_level"]["rescue"]["new"] < index["per_level"]["rescue"]["circuits"]
    assert sum(v["circuits"] for v in index["per_level"].values()) > len(circuits)
    keys = [batch.structural_key(c) for c in circuits]
    assert len(set(keys)) == len(keys)                   # no remaining duplicates
    for qc in circuits:
        check_measure_at_end(qc)
    assert len({qc.name for qc in index["levels"]["readout"]}) == 2


def test_batch_limit_enforced():
    with pytest.raises(ValueError, match="limit"):
        batch.build_full_batch({"purify": {"strategy": "all"}, "qkd": {"smart_direct": True},
                                "noise": {"mode": "teaching"}, "swap": {"mode": "teaching"}})
    assert batch.build_full_batch({"purify": {"F": 0.8}})[1]["params"]["purify"]["spec"]["kind"] == "werner"
    with pytest.raises(ValueError, match="unknown"):
        batch.build_full_batch({"nope": {}})
    with pytest.raises(ValueError, match="unknown parameters"):
        batch.build_full_batch({"swap": {"bad": 1}})


def test_full_batch_single_run_and_all_levels():
    be = Counting()
    Counting.runs = 0
    r = batch.run_full_batch(be, seed=2, **OPTS)
    assert Counting.runs == 1
    assert r["mode"] == "batch" and r["shots"] == 1000 and r["circuits_total"] <= 40
    assert set(r["levels"]) == {"link", "teleport", "noise", "swap", "purify", "qkd", "rescue"}
    for name, lv in r["levels"].items():
        assert lv["ok"] and lv["mode"] == "batch" and lv["level"] == name and lv["metrics"], name
    assert set(r["counts"]) >= {"readout_0000", "readout_1111"} and r["summary"].startswith("29 unique")
    assert "link" in r["per_level"]["noise"]["shares_shots_with"] and r["notes"]
    L = r["levels"]
    assert L["link"]["metrics"]["fidelity"]["value"] > 0.97
    assert "fidelity_readout_mitigated" in L["link"]["metrics"]
    assert "fidelity_readout_mitigated@0.8" in L["noise"]["metrics"]
    m = L["noise"]["metrics"]["fidelity@0.8"]
    assert m["ci95"][0] - 0.03 <= 0.8 <= m["ci95"][1] + 0.03
    assert L["swap"]["metrics"]["fidelity"]["theory"] == pytest.approx(0.95 * 0.9 + 0.05 * 0.1 / 3)
    assert L["purify"]["metrics"]["fidelity_adaptive"]["value"] > L["purify"]["metrics"]["fidelity_fixed"]["value"]
    assert L["rescue"]["viz"]["recommendation"]["strategy"] == "reroute"
    assert L["qkd"]["metrics"]["chsh_standard"]["value"] > 2.0
    assert all(c["id"] in L["swap"]["counts"] for c in L["swap"]["circuits"])
    json.dumps(r)
    assert r["readout"]["e0"] == [0.0] * 4  # simulator has no readout error


@pytest.mark.parametrize("params", [
    {"teleport": {"theta_deg": 200}}, {"teleport": {"phi_deg": float("nan")}},
    {"noise": {"Fs": [0.1]}}, {"noise": {"mode": "bogus"}}, {"swap": {"F1": 2}},
    {"purify": {"F": 0.8, "gamma": 0.2}}, {"purify": {"p": [0.5, 0.5, 0.5, 0.5]}},
    {"purify": {"p": [float("nan"), 0, 0, 1]}}, {"purify": {"gamma": 0.2, "mode": "precision"}},
    {"qkd": {"theta_deg": -5}}, {"qkd": {"beta_source": "x"}},
    {"rescue": {"broken": "XXX-YYY"}}, {"rescue": {"target_F": 5}},
    {"rescue": {"damage": {"kind": "spy", "theta_deg": 400}}}, {"rescue": {"healthy_F": [0.9, 0.9, 0.9]}},
    {"nope": {}}, {"swap": {"bad": 1}},
])
def test_full_batch_rejects_bad_params_before_running(params):
    be = Counting()
    Counting.runs = 0
    with pytest.raises(ValueError):
        batch.run_full_batch(be, params=params, **OPTS)
    assert Counting.runs == 0
    out = api.full_batch(be, params=params)
    assert out["ok"] is False and Counting.runs == 0


def test_full_batch_params_are_degrees():
    be = BasicSimulator()
    r = batch.run_full_batch(be, params={"teleport": {"theta_deg": 90.0, "phi_deg": 180.0},
                                         "qkd": {"theta_deg": 180.0}}, **OPTS)
    assert r["levels"]["teleport"]["params"]["theta"] == pytest.approx(math.pi / 2)
    assert r["levels"]["teleport"]["params"]["phi"] == pytest.approx(math.pi)
    assert r["levels"]["qkd"]["params"]["theta"] == pytest.approx(math.pi)
    assert r["params"]["qkd"]["theta_deg"] == 180.0
    assert r["levels"]["qkd"]["metrics"]["chsh_standard"]["value"] < 2.0   # full intercept


def test_failing_decoder_only_marks_its_level(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("decoder exploded")

    monkeypatch.setattr(batch.qkd, "decode_qkd", boom)
    r = batch.run_full_batch(BasicSimulator(), **OPTS)
    assert r["levels"]["qkd"]["ok"] is False and "exploded" in r["levels"]["qkd"]["error"]
    assert r["levels"]["link"]["ok"] and r["levels"]["swap"]["ok"]
    assert r["counts"] and all(isinstance(v, dict) for v in r["counts"].values())
    json.dumps(r)


def test_structural_key_distinguishes_clbit_order_and_ignores_names():
    from qiskit import QuantumCircuit
    a = QuantumCircuit(2, 2, name="a")
    a.h(0); a.measure(0, 0); a.measure(1, 1)
    b = QuantumCircuit(2, 2, name="b")
    b.h(0); b.measure(0, 1); b.measure(1, 0)   # swapped clbits
    c = QuantumCircuit(2, 2, name="c")
    c.h(0); c.barrier(label="channel"); c.measure(0, 0); c.measure(1, 1)
    assert batch.structural_key(a) != batch.structural_key(b)
    assert batch.structural_key(a) == batch.structural_key(c)


def _readout_dist(true_dist, e0, e1):
    out = {}
    for true, pt in true_dist.items():
        for r in range(4):
            pr = pt
            for i in range(2):
                tb, rb = (int(true, 2) >> i) & 1, (r >> i) & 1
                pe = e0[i] if tb == 0 else e1[i]
                pr *= pe if rb != tb else 1 - pe
            out[format(r, "02b")] = out.get(format(r, "02b"), 0.0) + pr
    return {k: int(round(v * 100000)) for k, v in out.items()}


def test_decode_only_with_synthetic_readout_error():
    e0, e1 = [0.03, 0.04, 0, 0], [0.06, 0.05, 0, 0]
    cm = {
        "link_XX": _readout_dist({"00": 0.5, "11": 0.5}, e0, e1),
        "link_YY": _readout_dist({"01": 0.5, "10": 0.5}, e0, e1),
        "link_ZZ": _readout_dist({"00": 0.5, "11": 0.5}, e0, e1),
    }
    cal0 = {format(r, "04b"): int(round(100000 * np_prod)) for r, np_prod in
            [(0, (1 - .03) * (1 - .04) * 1.0 * 1.0), (1, .03 * (1 - .04)), (2, (1 - .03) * .04), (3, .03 * .04)]}
    cal1 = {"1111": int(round(100000 * (1 - .06) * (1 - .05))), "1110": int(round(100000 * .06 * (1 - .05))),
            "1101": int(round(100000 * (1 - .06) * .05)), "1100": int(round(100000 * .06 * .05))}
    out = api.decode_only("link", cm, readout_counts={"readout_0000": cal0, "readout_1111": cal1},
                          backend_name="saved")
    assert out["ok"] and out["backend"] == "saved" and out["mode"] == "batch"
    m = out["metrics"]
    assert m["fidelity"]["value"] < 0.92
    assert m["fidelity_readout_mitigated"]["value"] == pytest.approx(1.0, abs=0.01)
    assert any("identity" in n for n in out["viz"]["notes"])


def test_mitigation_guards_singular_and_clips():
    counts = {"00": 500, "11": 500}
    assert an.mitigated_correlator(counts, [0, 1], [0.5, 0.5], [0.5, 0.5]) is None
    over = an.mitigated_correlator({"00": 480, "11": 480, "01": 40}, [0, 1], [0.1, 0.1], [0.1, 0.1])
    assert over["clipped"] is True and -1 <= over["value"] <= 1 and over["raw"] > 1.0
    # singular calibration in a decode: mitigation skipped with a note, raw metrics kept
    cm = {"link_XX": {"00": 500, "11": 500}, "link_YY": {"01": 500, "10": 500}, "link_ZZ": {"00": 500, "11": 500}}
    flat = {"0000": 500, "1111": 500}
    out = api.decode_only("link", cm, readout_counts={"readout_0000": flat, "readout_1111": flat})
    assert "fidelity_readout_mitigated" not in out["metrics"] and "fidelity" in out["metrics"]
    assert any("skipped" in n for n in out["viz"]["notes"])


def test_decode_only_rescue_with_new_target():
    be = BasicSimulator()
    first = batch.run_full_batch(be, **OPTS)["levels"]["rescue"]
    again = api.decode_only("rescue", first["counts"], {"target_F": 0.99}, shots=first["shots"])
    assert again["ok"] and first["viz"]["recommendation"]["meets_target"]
    assert again["viz"]["recommendation"]["meets_target"] is False
    bad = api.decode_only("rescue", first["counts"], {"target_F": 7})
    assert bad["ok"] is False
    assert api.decode_only("nope", {})["ok"] is False


def test_full_batch_ionq_defaults_to_500_shots():
    be = Counting()
    be.name = "ionq_simulator"  # hits the name-based IonQ detection
    r = batch.run_full_batch(be, params=None, **OPTS)
    assert r["shots"] == 500


# -------------------------------- api --------------------------------------

def test_api_ok_envelope_and_json():
    be = BasicSimulator()
    out = api.level_link(be, 500)
    assert out["ok"] and out["level"] == "link"
    json.dumps(out)
    assert api.level_teleport(be, 400, 90, 0)["ok"]
    assert api.level_noise(be, 400, [0.9, 0.7])["ok"]
    assert api.level_swap(be, 400, 0.9, 0.8)["ok"]
    assert api.level_purify(be, 400, p=[0.8, 0, 0.2, 0], strategy="predicted")["ok"]
    assert api.level_qkd(be, 400, 90)["ok"]
    r = api.rescue(be, 400, damage_kind="spy", damage_theta_deg=180)
    assert r["ok"] and r["level"] == "rescue"
    json.dumps(r)


@pytest.mark.parametrize("call", [
    lambda be: api.level_link(be, 5),
    lambda be: api.level_teleport(be, 500, 200, 0),
    lambda be: api.level_noise(be, 500, [2.0]),
    lambda be: api.level_noise(be, 500, [0.9], mode="bogus"),
    lambda be: api.level_swap(be, 500, 0.1, 0.9),
    lambda be: api.level_purify(be, 500),
    lambda be: api.level_purify(be, 500, F=0.8, gamma=0.1),
    lambda be: api.level_purify(be, 500, p=[0.5, 0.5, 0.5, 0.5]),
    lambda be: api.level_purify(be, 500, gamma=0.2, mode="precision"),
    lambda be: api.level_qkd(be, 500, 90, F=0.9),
    lambda be: api.rescue(be, 500, broken="BOG-XXX"),
    lambda be: api.rescue(be, 500, target_F=2),
    lambda be: api.level_link(None),
])
def test_api_errors_are_enveloped(call):
    out = call(BasicSimulator())
    assert out["ok"] is False and isinstance(out["error"], str) and out["error"]


def test_api_ionq_refusal_and_one_job():
    for fn in (api.level_link, api.level_teleport, api.level_noise, api.level_swap, api.level_qkd):
        out = fn(FakeIonQ())
        assert out == {"ok": False, "error": api.IONQ_MESSAGE, "code": "ionq_use_full_batch"}
    assert api.level_purify(FakeIonQ(), 500, F=0.8)["code"] == "ionq_use_full_batch"
    be = Counting()
    be.name = "ionq_simulator"
    Counting.runs = 0
    out = api.full_batch(be)
    assert out["ok"] and out["mode"] == "batch" and Counting.runs == 1 and out["shots"] == 500
    json.dumps(out)
    # rescue is a single job (<= 16 circuits): allowed on IonQ
    Counting.runs = 0
    out = api.rescue(be, 300)
    assert out["ok"] and Counting.runs == 1 and out["backend"] == "ionq_simulator"


def test_api_info_and_files():
    i = api.info()
    json.dumps(i)
    assert i["ok"] and {l["id"] for l in i["levels"]} >= {"link", "qkd", "rescue"}
    assert i["geo"]["links"] and i["attribution"] == "This effort is supported by Qollab & IonQ."
    d = batch.DEFAULT_PARAMS
    by = {l["id"]: l for l in i["levels"]}
    assert by["teleport"]["params"]["theta_deg"]["default"] == d["teleport"]["theta_deg"]
    assert by["qkd"]["params"]["theta_deg"]["default"] == d["qkd"]["theta_deg"]
    assert i["full_batch"]["default_params"] == d and "degrees" in i["full_batch"]["params_schema"]
    rec = api.load_recorded()
    assert rec["ok"] and rec["recorded"] == [] and rec["files"] == []
    exp = api.export_result({"a": 1})
    assert exp["ok"] and exp["exported"] is False  # no `js` module locally
    for bad in ("x.txt", "../x.json", ".json", ""):
        assert api.export_result({"a": 1}, bad)["ok"] is False
    assert api.export_result({"blob": "x" * 2_100_000})["ok"] is False


def test_load_recorded_fails_if_a_listed_file_fails(monkeypatch):
    def missing():
        return open("data/recorded/does-not-exist.json", encoding="utf-8")

    monkeypatch.setitem(api.RECORDED_OPENERS, "ghost", missing)
    out = api.load_recorded()
    assert out["ok"] is False and out["errors"][0]["file"] == "ghost"
