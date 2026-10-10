"""Full experiment in ONE job: levels 1-6, a rescue scenario and readout calibration.

IonQ allows one job per run, so every circuit goes out in a single
``backend.run`` (via ``execute.run_batch``), at most 40 circuits. Identical
circuits needed by several levels are deduplicated by a structural key (gates,
parameters and qubit/clbit indices; names, register names and the decoder-only
``channel`` barrier are ignored) and the shared counts are handed to every
consumer. Levels that share circuits share their SHOTS, so their metrics are
correlated, not independent (``per_level[level]["shares_shots_with"]``).

Parameters use the public units of the API (angles in DEGREES). ``resolve_params``
validates everything BEFORE any circuit is built or run and converts the
angles to radians in one place. After the single run, each level is decoded in
its own try/except (a failing decoder only marks that level) and the raw
counts are ALWAYS returned, so nothing from the job is lost. ``decode_only``
re-decodes saved counts offline.

Readout calibration: two 4-qubit circuits (|0000> and |1111>) give per-qubit
confusion rates (tensored model). Levels 1 and 3 get an extra
"readout-mitigated" metric beside the raw one. The mitigation assumes the
identity logical-to-physical qubit mapping and does not propagate the
calibration uncertainty. In level 3 precision mode the channel is applied
analytically to the mitigated ideal correlators (it is not a validation of
the channel, because the channel is simulated in Python).

References:
    - Bravyi, Sheldon, Kandala, McKay, Gambetta (2021). Mitigating measurement
      errors in multiqubit experiments. Phys. Rev. A 103:042605.
    - Qollab compute backends (IonQ: one job per run):
      https://qollab.xyz/learn/docs/compute-backends
"""

from __future__ import annotations

import copy
import math
from datetime import datetime, timezone
from typing import Any

from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister

from . import analysis as an
from . import geo, links, noise, purify, qkd, rescue, swap, teleport
from . import validate as V
from .execute import circuit_report, run_batch

MAX_BATCH = 40

# Public parameters (single source of truth, also used by api.info()). Degrees.
DEFAULT_PARAMS: dict[str, dict[str, Any]] = {
    "link": {},
    "teleport": {"theta_deg": 60.0, "phi_deg": 30.0, "F": 0.8},
    "noise": {"Fs": [0.95, 0.8, 0.6], "mode": "precision"},
    "swap": {"F1": 0.95, "F2": 0.9, "mode": "precision"},
    "purify": {"F": None, "gamma": 0.2, "p": None, "strategy": "predicted", "mode": "teaching"},
    "qkd": {"theta_deg": 120.0, "smart_direct": False, "beta_source": "split"},
    "rescue": {"broken": "BOG-CAL", "damage": {"kind": "werner", "F": 0.7},
               "healthy_F": 0.95, "target_F": 0.85, "mode": "precision"},
}
LEVEL_ORDER = ("link", "teleport", "noise", "swap", "purify", "qkd", "rescue", "readout")
DECODED_LEVELS = LEVEL_ORDER[:-1]
MODES = ("teaching", "precision")


def _internal_damage(damage: Any) -> dict[str, Any]:
    d = dict(V.py(damage))
    kind = V.choice("damage.kind", d.get("kind", "werner"), ("werner", "damping", "spy"))
    if kind == "werner":
        out = {"kind": kind, "F": V.num("damage.F", d.get("F", 0.7), 0.25, 1.0)}
    elif kind == "damping":
        out = {"kind": kind, "gamma": V.num("damage.gamma", d.get("gamma", 0.2), 0.0, 1.0)}
    else:
        out = {"kind": kind, "theta": math.radians(V.num("damage.theta_deg", d.get("theta_deg", 180.0), 0, 180))}
    rescue.damage_to_spec(out)
    return out


def resolve_params(params: dict[str, Any] | None) -> tuple[dict[str, dict], dict[str, dict]]:
    """Validate and merge ``params`` with the defaults.

    Returns ``(public, internal)``: ``public`` keeps degrees (what the UI
    sends and displays); ``internal`` has angles in radians and validated
    types (the only place where degrees are converted). Raises ValueError.
    """
    pub = copy.deepcopy(DEFAULT_PARAMS)
    user = V.py(params) or {}
    for level, vals in user.items():
        if level not in pub:
            raise V.InputError(f"unknown level {level!r}")
        vals = dict(V.py(vals))
        unknown = set(vals) - set(pub[level])
        if unknown:
            raise V.InputError(f"unknown parameters for {level}: {sorted(unknown)}")
        if level == "purify" and any(vals.get(k) is not None for k in ("F", "gamma", "p")):
            for k in ("F", "gamma", "p"):  # a chosen noise replaces the default one
                pub[level][k] = None
        pub[level].update(vals)
    t, nz, sw, pu, qk, rc = (pub[k] for k in ("teleport", "noise", "swap", "purify", "qkd", "rescue"))
    internal: dict[str, dict] = {
        "link": {},
        "teleport": {
            "theta": math.radians(V.num("teleport.theta_deg", t["theta_deg"], 0, 180)),
            "phi": math.radians(V.num("teleport.phi_deg", t["phi_deg"], -360, 360)),
            "F": None if t["F"] is None else V.num("teleport.F", t["F"], 0.25, 1.0),
        },
        "noise": {"Fs": V.f_list("noise.F", nz["Fs"]), "mode": V.choice("noise.mode", nz["mode"], MODES)},
        "swap": {"F1": V.num("swap.F1", sw["F1"], 0.25, 1.0), "F2": V.num("swap.F2", sw["F2"], 0.25, 1.0),
                 "mode": V.choice("swap.mode", sw["mode"], MODES)},
        "qkd": {"theta": math.radians(V.num("qkd.theta_deg", qk["theta_deg"], 0, 180)),
                "smart_direct": bool(qk["smart_direct"]),
                "beta_source": V.choice("qkd.beta_source", qk["beta_source"], ("split", "oracle"))},
    }
    spec_kw = V.spec_args(pu["F"], pu["gamma"], pu["p"])
    mode = V.choice("purify.mode", pu["mode"], MODES)
    if mode == "precision" and "gamma" in spec_kw:
        raise V.InputError("purify precision mode supports only Pauli channels (F or p)")
    internal["purify"] = {
        "spec": noise.make_spec(**spec_kw), "spec_args": spec_kw, "mode": mode,
        "strategy": V.choice("purify.strategy", pu["strategy"], ("all", "predicted")),
    }
    hf = V.py(rc["healthy_F"])
    healthy = [V.num("rescue.healthy_F", f, 0.25, 1.0) for f in (hf if isinstance(hf, (list, tuple)) else [hf])]
    if len(healthy) not in (1, 2):
        raise V.InputError("rescue.healthy_F must be one value or two")
    internal["rescue"] = {
        "broken": geo.normalize_link(rc["broken"]), "damage": _internal_damage(rc["damage"]),
        "healthy_F": healthy[0] if len(healthy) == 1 else healthy,
        "target_F": V.num("rescue.target_F", rc["target_F"], 0.3, 1.0),
        "mode": V.choice("rescue.mode", rc["mode"], MODES),
    }
    return pub, internal


def structural_key(qc: QuantumCircuit) -> tuple:
    """Hashable description of what a circuit does (ignores names and barriers)."""
    ops = []
    for inst in qc.data:
        op = inst.operation
        if op.name == "barrier":
            continue
        pars = tuple(round(float(p), 9) if isinstance(p, (int, float)) else str(p) for p in op.params)
        ops.append((
            op.name, pars,
            tuple(qc.find_bit(q).index for q in inst.qubits),
            tuple(qc.find_bit(c).index for c in inst.clbits),
        ))
    return (qc.num_qubits, qc.num_clbits, tuple(ops))


def build_readout() -> list[QuantumCircuit]:
    """|0000> and |1111> calibration circuits (all four qubits measured)."""
    out = []
    for name, ones in (("readout_0000", False), ("readout_1111", True)):
        q, c = QuantumRegister(4, "q"), ClassicalRegister(4, "out")
        qc = QuantumCircuit(q, c, name=name)
        if ones:
            qc.x(q)
        qc.measure(q, c)
        out.append(qc)
    return out


def _purify_us(spec, strategy: str):
    if strategy == "all":
        return purify.U_NAMES
    best, _ = purify.choose_u(noise.bell_diag_of(spec))
    return ("I",) if best == "I" else ("I", best)


def level_circuits(level: str, ip: dict[str, dict]) -> list[QuantumCircuit]:
    """The circuits one level needs, from the internal parameters."""
    if level == "link":
        return links.build_link()
    if level == "teleport":
        q = ip["teleport"]
        return teleport.build_teleport(q["theta"], q["phi"], q["F"])
    if level == "noise":
        return noise.build_noise(ip["noise"]["Fs"], ip["noise"]["mode"])
    if level == "swap":
        q = ip["swap"]
        return swap.build_swap(q["F1"], q["F2"], q["mode"])
    if level == "purify":
        q = ip["purify"]
        return purify.build_purify(q["spec"], _purify_us(q["spec"], q["strategy"]), None, q["mode"])
    if level == "qkd":
        q = ip["qkd"]
        return qkd.build_qkd(q["theta"], None, None, q["smart_direct"])
    if level == "rescue":
        q = ip["rescue"]
        return rescue.build_rescue(q["damage"], q["healthy_F"], q["mode"])[0]
    if level == "readout":
        return build_readout()
    raise ValueError(f"unknown level {level!r}")


def build_full_batch(params: dict[str, Any] | None = None):
    """Validate, build every level's circuits and deduplicate them.

    Returns ``(circuits, index)``: ``circuits`` is the unique list to run;
    ``index`` has ``alias`` (level -> consumer name -> canonical name),
    ``levels`` (level -> consumer circuits), ``per_level`` (counts and the
    levels each one shares shots with), ``summary``, ``total`` and the
    parameters. Raises ValueError for bad parameters or above ``MAX_BATCH``.
    """
    pub, ip = resolve_params(params)
    levels = {lv: level_circuits(lv, ip) for lv in LEVEL_ORDER}
    unique: dict[str, QuantumCircuit] = {}
    keys: dict[tuple, str] = {}
    alias: dict[str, dict[str, str]] = {}
    per_level: dict[str, dict[str, Any]] = {}
    for level in LEVEL_ORDER:
        alias[level] = {}
        new = 0
        for qc in levels[level]:
            k = structural_key(qc)
            if k in keys:
                alias[level][qc.name] = keys[k]
                continue
            name = qc.name if qc.name not in unique else f"{qc.name}__{level}"
            unique[name] = qc if name == qc.name else qc.copy(name=name)
            keys[k] = name
            alias[level][qc.name] = name
            new += 1
        per_level[level] = {"circuits": len(levels[level]), "new": new}
    for lv in LEVEL_ORDER:
        mine = set(alias[lv].values())
        per_level[lv]["shares_shots_with"] = [
            o for o in LEVEL_ORDER if o != lv and mine & set(alias[o].values())
        ]
    total = len(unique)
    summary = ", ".join(f"{l}: {v['circuits']} ({v['new']} new)" for l, v in per_level.items())
    if total > MAX_BATCH:
        raise ValueError(f"full batch has {total} circuits, limit is {MAX_BATCH}")
    index = {"alias": alias, "levels": levels, "per_level": per_level, "total": total,
             "public": pub, "params": ip, "summary": f"{total} unique circuits ({summary})"}
    return list(unique.values()), index


# --------------------------------------------------------------------------
# Decoding
# --------------------------------------------------------------------------

SHARED_NOTE = ("Levels that share circuits share their shots: their metrics are correlated, "
               "not independent.")


def _mitigate_link(cm, e0, e1) -> dict[str, Any]:
    """Readout-mitigated correlators and fidelity of the level-1 circuits."""
    corr = {P: an.mitigated_correlator(cm[f"link_{P}"], [0, 1], e0, e1) for P in links.BASES}
    if any(c is None for c in corr.values()):
        return {}
    fid = an.bell_fidelity(corr["XX"], corr["YY"], corr["ZZ"])
    out = {f"corr_{P}_readout_mitigated": an.metric(c["value"], c["ci95"], links.theory_link()[P],
                                                    clipped=c["clipped"])
           for P, c in corr.items()}
    out["fidelity_readout_mitigated"] = an.metric(fid["value"], fid["ci95"], 1.0, raw=fid["raw"])
    return out


def _mitigate_noise(cm, Fs, mode, e0, e1) -> dict[str, Any]:
    """Readout-mitigated Werner fidelities of level 3."""
    out = {}
    ideal = {"XX": 1.0, "YY": -1.0, "ZZ": 1.0}
    label = ("analytic channel on mitigated ideal correlators - not a validation of the channel"
             if mode == "precision" else "readout-mitigated circuit counts")
    for F in Fs:
        th = noise.theory_werner(F)
        corr = {}
        for P in links.BASES:
            name = f"noise_ideal_{P}" if mode == "precision" else noise._cname(F, P)
            c = an.mitigated_correlator(cm[name], [0, 1], e0, e1)
            if c is None:
                return {}
            if mode == "precision":  # channel applied analytically: scale by the Werner factor
                f = th[P] / ideal[P]
                c = {"value": c["value"] * f, "var": c["var"] * f * f, "shots": c["shots"]}
            corr[P] = c
        fid = an.bell_fidelity(corr["XX"], corr["YY"], corr["ZZ"])
        out[f"fidelity_readout_mitigated@{noise._fkey(F)}"] = an.metric(
            fid["value"], fid["ci95"], F, raw=fid["raw"], configured=F, label=label)
    return out


def decode_level(
    level: str, cm: dict[str, dict[str, int]], ip: dict[str, dict], seed: int = 0,
    readout: tuple | None = None,
):
    """Decode one level from counts keyed by its own circuit names.

    Returns ``(decoded, params_out, bit_order)`` with ``decoded`` = metrics and viz.
    """
    if level == "link":
        dec = links.decode_link(cm, "link", seed)
        pout, bo = {}, links.BIT_ORDER
    elif level == "teleport":
        q = ip["teleport"]
        dec = teleport.decode_teleport(cm, q["theta"], q["phi"], q["F"], "psi", seed)
        pout, bo = dict(q), teleport.BIT_ORDER
    elif level == "noise":
        q = ip["noise"]
        dec = noise.decode_noise(cm, q["Fs"], q["mode"], seed)
        pout, bo = {**q, "channel": noise._CHANNEL[q["mode"]]}, links.BIT_ORDER
    elif level == "swap":
        q = ip["swap"]
        dec = swap.decode_swap(cm, q["F1"], q["F2"], q["mode"], seed)
        pout, bo = {**q, "channel": noise._CHANNEL[q["mode"]]}, swap.BIT_ORDER
    elif level == "purify":
        q = ip["purify"]
        us = _purify_us(q["spec"], q["strategy"])
        dec = purify.decode_purify(cm, q["spec"], us, None, q["mode"], seed)
        dec.pop("extra")
        pout = {"noise": q["spec"], "strategy": q["strategy"], "mode": q["mode"],
                "channel": noise._CHANNEL[q["mode"]]}
        bo = purify.BIT_ORDER
    elif level == "qkd":
        q = ip["qkd"]
        dec = qkd.decode_qkd(cm, q["theta"], None, None, q["smart_direct"], seed, q["beta_source"])
        pout, bo = dict(q), qkd.BIT_ORDER
    elif level == "rescue":
        q = ip["rescue"]
        dec = rescue.decode_rescue(cm, q["damage"], q["broken"], q["healthy_F"], q["target_F"], q["mode"], seed)
        pout, bo = dict(q), purify.BIT_ORDER + " | swap: " + swap.BIT_ORDER
    else:
        raise ValueError(f"cannot decode level {level!r}")
    notes = dec["viz"].setdefault("notes", [])
    if readout is not None and level in ("link", "noise"):
        e0, e1 = readout
        extra = (_mitigate_link(cm, e0, e1) if level == "link"
                 else _mitigate_noise(cm, ip["noise"]["Fs"], ip["noise"]["mode"], e0, e1))
        if extra:
            dec["metrics"].update(extra)
            notes.append("readout mitigation assumes the identity logical-to-physical qubit mapping; "
                         "calibration uncertainty is not propagated")
            if level == "noise" and ip["noise"]["mode"] == "precision":
                notes.append("readout-mitigated metric: analytic channel on mitigated ideal "
                             "correlators - not a validation of the channel")
        else:
            notes.append("readout mitigation skipped (singular confusion matrix)")
    notes.append(SHARED_NOTE)
    return dec, pout, bo


def _package(level, dec, pout, bo, qcs, cm, compiled_by_name, backend_name_, shots, stamp, mode="batch"):
    viz = dec["viz"]
    viz["steps"] = {qc.name: an.circuit_steps(qc) for qc in qcs[:3]}
    res = an.make_result(level, mode, backend_name_, shots, pout, bo, dec["metrics"],
                         circuit_report(qcs, compiled_by_name), cm, viz=viz, timestamp=stamp)
    return {"ok": True, **res}


def run_full_batch(
    backend: Any, shots: int | None = None, seed: int = 0,
    params: dict[str, Any] | None = None, **run_options: Any,
) -> dict[str, Any]:
    """Run the whole experiment with ONE ``backend.run`` and decode every level.

    All parameters are validated first. ``shots`` defaults to 1000 (500 on
    IonQ). Each level decodes in its own try/except; the raw counts of the
    unique circuits are always returned under ``counts``.
    """
    if shots is None:
        shots = 500 if an.is_ionq(backend) else 1000
    shots = V.shots(shots)
    circuits, index = build_full_batch(params)
    counts, compiled = run_batch(backend, circuits, shots, **run_options)
    alias, ip = index["alias"], index["params"]
    name = an.backend_name(backend)
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    readout = None
    try:
        readout = an.readout_rates(counts["readout_0000"], counts["readout_1111"], 4)
    except Exception:  # noqa: BLE001 - calibration is optional for decoding
        readout = None

    out: dict[str, Any] = {}
    for level in DECODED_LEVELS:
        try:
            cm = {n: counts[c] for n, c in alias[level].items()}
            dec, pout, bo = decode_level(level, cm, ip, seed, readout)
            out[level] = _package(level, dec, pout, bo, index["levels"][level], cm,
                                  {n: compiled[c] for n, c in alias[level].items()}, name, shots, stamp)
        except Exception as exc:  # noqa: BLE001 - one failing decoder must not lose the job
            out[level] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    return an.to_plain({
        "mode": "batch", "backend": name, "timestamp": stamp, "shots": shots,
        "levels": out, "circuits_total": index["total"], "per_level": index["per_level"],
        "summary": index["summary"], "params": index["public"], "notes": [SHARED_NOTE],
        "counts": counts, "alias": alias, "compiled": compiled,
        "readout": None if readout is None else {"e0": readout[0], "e1": readout[1]},
    })


def decode_only(
    level: str, counts: dict[str, dict[str, int]], params: dict[str, Any] | None = None,
    seed: int = 0, backend_name: str = "unknown", shots: int | None = None,
    timestamp: str | None = None, mode: str = "batch",
    readout_counts: dict[str, dict[str, int]] | None = None,
) -> dict[str, Any]:
    """Re-decode saved counts of one level offline (no backend).

    ``counts`` is the level's ``counts`` field (keyed by the level's circuit
    names); ``params`` are the same public parameters used for the run (for
    example a different ``target_F`` for the rescue). ``readout_counts`` may
    hold ``readout_0000`` and ``readout_1111`` to repeat the mitigation.
    """
    if level not in DECODED_LEVELS:
        raise ValueError(f"level must be one of {list(DECODED_LEVELS)}")
    _, ip = resolve_params({level: V.py(params)} if params else None)
    cm = V.py(counts)
    readout = None
    if readout_counts and "readout_0000" in readout_counts and "readout_1111" in readout_counts:
        readout = an.readout_rates(readout_counts["readout_0000"], readout_counts["readout_1111"], 4)
    dec, pout, bo = decode_level(level, cm, ip, seed, readout)
    qcs = level_circuits(level, ip)
    if shots is None:
        shots = int(sum(next(iter(cm.values())).values())) if cm else 0
    stamp = timestamp or datetime.now(timezone.utc).isoformat(timespec="seconds")
    return _package(level, dec, pout, bo, qcs, cm, {}, backend_name, shots, stamp, mode)
