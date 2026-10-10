"""Robustness: every judge-facing call must return a JSON-able envelope, never raise or hang."""

from __future__ import annotations

import json

import pytest
from qiskit.providers.basic_provider import BasicSimulator

from quantum import api
from tests.helpers import Counting, ionq_counting

FUNCS = {
    "link": api.level_link, "teleport": api.level_teleport, "noise": api.level_noise,
    "swap": api.level_swap, "purify": api.level_purify, "qkd": api.level_qkd, "rescue": api.rescue,
}
LEVEL_IDS = list(FUNCS)
FAST = 200  # shots for the sweeps


@pytest.fixture(autouse=True)
def _fresh_ionq_state():
    api._reset_ionq_state()
    yield
    api._reset_ionq_state()


def _info_levels() -> dict[str, dict]:
    return {lv["id"]: lv["params"] for lv in api.info()["levels"]}


def _defaults(level: str) -> dict:
    return {k: v["default"] for k, v in _info_levels()[level].items() if "default" in v}


_ionq_backend = ionq_counting


@pytest.mark.parametrize("level", LEVEL_IDS)
def test_info_defaults_and_no_kwargs_are_ok(level):
    kwargs = {**_defaults(level), "shots": FAST}
    out = FUNCS[level](BasicSimulator(), **kwargs)
    assert out["ok"] is True, out.get("error")
    json.dumps(out)
    out = FUNCS[level](BasicSimulator())
    assert out["ok"] is True, out.get("error")


def _sweep_cases():
    cases = []
    for level, params in _info_levels().items():
        cases.append((level, {"shots": 10}))
        for name, spec in params.items():
            if name != "shots" and "min" in spec and "max" in spec:
                for bound in ("min", "max"):
                    cases.append((level, {name: spec[bound]}))
    # Fs: list parameter at its bounds and at maximum length
    cases += [("noise", {"Fs": [0.25]}), ("noise", {"Fs": [1.0]}), ("noise", {"Fs": [1, 0.9, 0.8, 0.5, 0.25]})]
    return cases


@pytest.mark.parametrize("level,kwargs", _sweep_cases(), ids=lambda v: str(v))
def test_edge_sweep_never_raises(level, kwargs):
    kwargs = {"shots": FAST, **kwargs}
    # purify: a bound of one channel parameter replaces the default channel
    if level == "purify" and ("F" in kwargs):
        kwargs["gamma"] = None
    # qkd: F (Werner) excludes a spy angle
    if level == "qkd" and kwargs.get("F") is not None:
        kwargs["theta_deg"] = 0
    out = FUNCS[level](BasicSimulator(), **kwargs)
    assert isinstance(out, dict) and "ok" in out
    json.dumps(out)
    if not out["ok"]:
        pytest.fail(f"{level} {kwargs}: {out.get('error')}")


def test_fake_ionq_run_level_one_job_then_guards():
    be = _ionq_backend()
    outs = [api.run_level(be, lv) for lv in ("link", "swap", "qkd")]
    assert Counting.runs == 1
    for lv, out in zip(("link", "swap", "qkd"), outs):
        assert out["ok"] and out["source"] == "ionq_batch_cache" and out["level"] == lv
        json.dumps(out)
    assert outs[0]["cached_run"] is False and outs[1]["cached_run"] is True
    out = api.full_batch(be)
    assert out["ok"] is False and out["code"] == "ionq_job_used" and out["cached"]["levels"]["link"] is True
    assert api.rescue(be)["code"] == "ionq_job_used"
    assert api.run_level(be, "rescue")["ok"]
    assert Counting.runs == 1


def test_fake_ionq_run_level_params_and_rescue_mapping():
    be = _ionq_backend()
    out = api.run_level(be, "rescue", broken="MED-CAL", damage_kind="spy", damage_theta_deg=90,
                        target_F=0.8, shots=300)
    assert out["ok"], out.get("error")
    assert Counting.runs == 1 and out["shots"] == 300
    assert api.run_level(be, "teleport", theta_deg=10)["params_ignored"] is True


def test_fake_ionq_rescue_first_blocks_full_batch():
    be = _ionq_backend()
    assert api.rescue(be, 300)["ok"] and Counting.runs == 1
    out = api.full_batch(be)
    assert out["code"] == "ionq_job_used" and out["cached"] is None and Counting.runs == 1
    assert api.run_level(be, "link")["code"] == "ionq_job_used"


def test_fake_ionq_invalid_params_do_not_burn_the_job():
    be = _ionq_backend()
    assert api.run_level(be, "swap", F1=5)["ok"] is False and Counting.runs == 0
    assert api.run_level(be, "bogus")["ok"] is False
    assert api.full_batch(be, params={"nope": {}})["ok"] is False and Counting.runs == 0
    assert api.run_level(be, "link")["ok"] and Counting.runs == 1


def test_failed_ionq_job_counts_as_used():
    class Boom(Counting):
        def run(self, *a, **k):
            Counting.runs += 1
            raise RuntimeError("job rejected")

    be = Boom()
    be.name = "ionq_simulator"
    Counting.runs = 0
    out = api.run_level(be, "link")
    assert out["ok"] is False and isinstance(out["error"], str)
    assert api.run_level(be, "swap")["code"] == "ionq_job_used" and Counting.runs == 1


def test_load_recorded_basic_simulator_full():
    rec = api.load_recorded()
    assert rec["ok"] and rec["errors"] == []
    run = {r["name"]: r["result"] for r in rec["recorded"]}["basic_simulator_full"]
    assert run["mode"] == "recorded"
    for level in api.RUN_LEVELS:
        lv = run["levels"][level]
        assert lv["ok"] is True and lv["mode"] == "recorded"
    json.dumps(rec)


@pytest.mark.parametrize("level", LEVEL_IDS)
def test_run_level_on_simulator_matches_direct_call(level):
    a = api.run_level(BasicSimulator(), level, shots=FAST)
    b = FUNCS[level](BasicSimulator(), shots=FAST)
    assert a["ok"] and b["ok"] and set(a) == set(b)
    assert a["level"] == b["level"] and a["shots"] == b["shots"]


def test_run_level_bad_inputs_on_simulator():
    be = BasicSimulator()
    assert api.run_level(be, "bogus")["ok"] is False
    out = api.run_level(be, "link", not_a_param=1)
    assert out["ok"] is False and out["error"]
    assert api.run_level(be, "swap", {"F1": 0.9, "F2": 0.8}, shots=FAST)["ok"]  # params dict + kwargs


def test_ionq_teleport_none_passes_through_and_qkd_f_rejected():
    be = _ionq_backend()
    out = api.run_level(be, "qkd", F=0.9)
    assert out["ok"] is False and Counting.runs == 0
    out = api.run_level(be, "teleport", {"F": None, "theta_deg": 45})
    assert out["ok"], out.get("error") and Counting.runs == 1
    assert out["params"]["F"] is None


def test_cached_summary_is_slim_and_message_friendly():
    be = _ionq_backend()
    assert api.run_level(be, "link")["ok"]
    out = api.full_batch(be)
    assert out["code"] == "ionq_job_used" and "Press Run again" in out["error"]
    c = out["cached"]
    assert set(c) == {"backend", "timestamp", "shots", "levels"} and c["levels"]["link"] is True
    assert "counts" not in c


def test_compile_failure_does_not_burn_the_ionq_job(monkeypatch):
    from quantum import execute

    def boom(*a, **k):
        raise RuntimeError("compile failed")

    be = _ionq_backend()
    monkeypatch.setattr(execute, "compile_for", boom)
    assert api.run_level(be, "link")["ok"] is False
    assert api.rescue(be, 300)["ok"] is False
    assert api._IONQ['used'] is False and Counting.runs == 0
    monkeypatch.undo()
    assert api.run_level(be, "link")["ok"] and Counting.runs == 1


def test_backend_diag():
    d = api.backend_diag(BasicSimulator())
    assert d["ok"] and d["is_ionq"] is False and d["ionq_job_used"] is False and d["module"]
    be = _ionq_backend()
    assert api.backend_diag(be)["is_ionq"] is True
    api.run_level(be, "link")
    assert api.backend_diag(be)["ionq_job_used"] is True


def test_purify_channel_precedence_and_precision_default():
    be = BasicSimulator()
    assert api.level_purify(be, FAST, F=0.7, gamma=0.2)["ok"]  # F overrides gamma
    assert api.level_purify(be, FAST, p=[0.8, 0, 0.2, 0], gamma=0.2)["ok"]
    assert api.level_purify(be, FAST, F=0.7, p=[0.8, 0, 0.2, 0])["ok"] is False
    out = api.level_purify(be, FAST, mode="precision")
    assert out["ok"], out.get("error")


def test_guard_is_per_backend_object():
    a = ionq_counting()
    assert api.run_level(a, "link")["ok"] and Counting.runs == 1
    assert api.full_batch(a)["code"] == "ionq_job_used"
    assert api.backend_diag(a)["ionq_job_used"] is True
    b = Counting()
    b.name = "ionq_simulator"
    assert api.backend_diag(b)["ionq_job_used"] is False
    assert api.run_level(b, "swap")["ok"] and Counting.runs == 2  # new Run, new backend: allowed
    assert api.backend_diag(b)["ionq_job_used"] is True


def test_positional_contract():
    be = BasicSimulator()
    assert api.run_level(be, "swap", {"F1": 0.9, "shots": FAST})["ok"]
    assert api.full_batch(be, FAST, 1, {"swap": {"F1": 0.9}})["ok"]
    assert api.level_swap(be, FAST, 0.9, 0.8)["ok"]


def test_fallback_on_failure_and_none_for_input_errors(monkeypatch):
    a = ionq_counting()
    assert api.run_level(a, "link")["ok"]
    out = api.rescue(a)  # job already used -> raw failure, not run_level
    assert out["code"] == "ionq_job_used"
    # rescue first, then run_level: job used without cache -> fallback to the recorded level
    b = ionq_counting()
    assert api.rescue(b, 300)["ok"]
    out = api.run_level(b, "swap")
    assert out["ok"] is False and out["code"] == "ionq_job_used"
    fb = out["fallback"]
    assert fb["source"] == "recorded" and fb["mode"] == "recorded" and fb["result"]["level"] == "swap"
    assert fb["result"]["ok"] and fb["backend"] and fb["timestamp"] and fb["file"]
    json.dumps(out)
    # caller mistakes keep a plain failure
    for call in (lambda: api.run_level(BasicSimulator(), "swap", {"F1": 5}),
                 lambda: api.run_level(BasicSimulator(), "bogus"),
                 lambda: api.run_level(BasicSimulator(), "link", {"nope": 1})):
        r = call()
        assert r["ok"] is False and "fallback" not in r and r["input_error"] is True
    # missing recordings: fallback is None, never raises
    monkeypatch.setattr(api, "RECORDED_OPENERS", {})
    c = ionq_counting()
    assert api.rescue(c, 300)["ok"]
    assert api.run_level(c, "link")["fallback"] is None


def test_fallback_prefers_ionq_recording(monkeypatch):
    def ionq_rec():
        import io
        data = {"backend": "ionq_simulator", "timestamp": "t",
                "levels": {"link": {"ok": True, "level": "link", "mode": "batch", "backend": "ionq_simulator",
                                    "timestamp": "t"}}}
        return io.StringIO(json.dumps(data))

    monkeypatch.setitem(api.RECORDED_OPENERS, "ionq_aria_sim_full", ionq_rec)
    b = ionq_counting()
    assert api.rescue(b, 300)["ok"]
    fb = api.run_level(b, "link")["fallback"]
    assert fb["file"] == "ionq_aria_sim_full" and fb["mode"] == "recorded" and fb["backend"] == "ionq_simulator"


def test_internal_value_errors_get_fallback_but_input_errors_do_not(monkeypatch):
    from quantum import batch, execute

    def boom(*a, **k):
        raise ValueError("internal decode problem")

    be = BasicSimulator()
    monkeypatch.setattr(execute, "run_batch", boom)
    monkeypatch.setattr("quantum.links.run_link", boom)
    out = api.run_level(be, "link", {"shots": FAST})
    assert out["ok"] is False and "input_error" not in out
    assert out["fallback"]["source"] == "recorded" and out["fallback"]["result"]["level"] == "link"
    monkeypatch.undo()
    # decoder failure on IonQ batch path
    monkeypatch.setattr(batch, "decode_level", boom)
    ion = ionq_counting()
    out = api.run_level(ion, "swap")
    assert out["ok"] is False and "input_error" not in out and out["fallback"] is not None
    monkeypatch.undo()
    for call in (lambda: api.run_level(be, "swap", {"F1": 9}),
                 lambda: api.run_level(be, "swap", {"F9": 1}),
                 lambda: api.run_level(be, "nope"),
                 lambda: api.run_level(None, "link")):
        r = call()
        assert r["ok"] is False and r["input_error"] is True and "fallback" not in r


def test_backend_diag_identity_fields():
    api._LAST_DIAG["backend"] = None
    be = BasicSimulator()
    a = api.backend_diag(be)
    assert a["same_object_as_last_diag"] is None
    assert api.backend_diag(be)["same_object_as_last_diag"] is True
    assert api.backend_diag(BasicSimulator())["same_object_as_last_diag"] is False
    ion = ionq_counting()
    api.run_level(ion, "link")
    assert api.backend_diag(ion)["guard_key_matches"] is True
    assert api.backend_diag(BasicSimulator())["guard_key_matches"] is False
