"""Save the Quantum Network: repair a damaged link with REAL circuits.

One of the three links (default Bogota-Cali) is damaged: Werner noise, T1
amplitude damping, or a spy. Three ways to deliver an end-to-end pair are
measured on the backend in ONE ``backend.run`` (at most 16 circuits):

    a. direct   - use the damaged link as it is (tomography XX/YY/ZZ);
    b. reroute  - entanglement swapping through the third city over the two
                  healthy links (swap.py);
    c. purify   - one round of DEJMPS on two damaged pairs (purify.py), fixed
                  circuit (U = I) and, if it helps, the U predicted from the
                  damage model. The U is predicted from the configured
                  damage, not chosen from the direct tomography (that would
                  need a second job); the decoder then confirms the best U
                  among the built circuits with the measured tomography.

A spy copying information of Bob's qubit is, for the A-B statistics, exactly
a Z-dephasing channel with probability (1-cos(theta/2))/2 (tracing the spy
out); the full CRY circuit lives in level 6.

For every strategy the result gives the measured fidelity with a 95 % CI,
the theory, the raw pairs consumed (1 direct; 2 reroute; 2/p_s purify), the
QBERs and the asymptotic key rates (Shor-Preskill with 1/2 sifting and the
Lo-Chau-Ardehali biased scheme), and whether the lower CI bound meets the
target. The recommendation is the strategy whose lower CI bound meets the
target and that needs the fewest raw pairs per delivered pair INCLUDING fiber
loss (raw pairs / eta_effective); the fewest raw pairs ignoring loss is
reported too. If none meets the target, it says so. Fiber loss lowers the pair
RATE, not the fidelity (see geo.py for the memory model).

Projections (pure Python, Bell-diagonal, ideal local gates, single damaged
link): raw pairs for several rounds of the fixed circuit, adaptive DEJMPS and
pumping.

References:
    - Briegel, Dur, Cirac, Zoller (1998). Phys. Rev. Lett. 81:5932.
    - Dur, Briegel, Cirac, Zoller (1999). Phys. Rev. A 59:169.
    - Deutsch et al. (1996). Phys. Rev. Lett. 77:2818.
    - Munro, Azuma, Tamaki, Nemoto (2015). IEEE J. Sel. Top. Quantum Electron.
      21:6400112 (repeater generations).
    - Lo, Chau, Ardehali (2005). J. Cryptology 18:133 (biased-basis key rate).
    - Research notes R21 (T1 damping).
"""

from __future__ import annotations

import math
from typing import Any, Sequence

from . import analysis as an
from . import geo, purify, swap
from .execute import circuit_report, run_batch
from .noise import (
    Spec, bell_diag_of, damping_spec, pauli_spec, werner_spec, _CHANNEL, _NOTES,
)

MAX_CIRCUITS = 16
DEFAULT_DAMAGE = {"kind": "werner", "F": 0.7}


def damage_to_spec(damage: dict[str, Any] | None) -> tuple[Spec, dict[str, Any]]:
    """Channel spec of a damage description and a clean copy of the description."""
    d = dict(DEFAULT_DAMAGE if damage is None else damage)
    kind = d.get("kind", "werner")
    if kind == "werner":
        F = float(d.get("F", 0.7))
        if not 0.25 <= F <= 1.0:
            raise ValueError("damage F must be in [0.25, 1]")
        return werner_spec(F), {"kind": kind, "F": F}
    if kind == "damping":
        g = float(d.get("gamma", 0.2))
        if not 0.0 <= g <= 1.0:
            raise ValueError("damage gamma must be in [0, 1]")
        return damping_spec(g), {"kind": kind, "gamma": g}
    if kind == "spy":
        th = float(d.get("theta", math.pi))
        if not 0.0 <= th <= math.pi:
            raise ValueError("spy theta must be in [0, pi]")
        z = (1.0 - math.cos(th / 2.0)) / 2.0
        return pauli_spec((1.0 - z, 0.0, 0.0, z)), {"kind": kind, "theta": th}
    raise ValueError(f"unknown damage kind {kind!r}")


def _healthy(healthy_F: float | Sequence[float]) -> tuple[float, float]:
    pair = (healthy_F, healthy_F) if isinstance(healthy_F, (int, float)) else tuple(healthy_F)
    if len(pair) != 2 or not all(0.25 <= f <= 1.0 for f in pair):
        raise ValueError("healthy_F must be one F or two Fs in [0.25, 1]")
    return float(pair[0]), float(pair[1])


def plan_rescue(
    damage: dict[str, Any] | None = None, healthy_F: float | Sequence[float] = 0.95,
    mode: str = "precision",
) -> dict[str, Any]:
    """Resolve the spec, the mode actually used and the U list to build."""
    spec, clean = damage_to_spec(damage)
    mode_used = "teaching" if spec["kind"] == "damping" else mode
    if mode_used not in ("teaching", "precision"):
        raise ValueError("mode must be 'teaching' or 'precision'")
    best, _ = purify.choose_u(bell_diag_of(spec))
    us = ("I",) if best == "I" else ("I", best)
    return {"spec": spec, "damage": clean, "mode": mode_used, "us": us,
            "healthy": _healthy(healthy_F), "predicted_u": best}


def build_rescue(
    damage: dict[str, Any] | None = None, healthy_F: float | Sequence[float] = 0.95,
    mode: str = "precision",
):
    """Circuits of the rescue (tomography + purify + swap) and the plan."""
    plan = plan_rescue(damage, healthy_F, mode)
    f1, f2 = plan["healthy"]
    circuits = purify.build_purify(plan["spec"], plan["us"], None, plan["mode"])
    circuits += swap.build_swap(f1, f2, plan["mode"])
    if len(circuits) > MAX_CIRCUITS:
        raise ValueError(f"rescue needs {len(circuits)} circuits (max {MAX_CIRCUITS})")
    return circuits, plan


def _q(corr: dict[str, Any]) -> tuple[float, list[float]]:
    return (1 - corr["value"]) / 2, [(1 - corr["ci95"][1]) / 2, (1 - corr["ci95"][0]) / 2]


def _rate_metrics(qz, qz_ci, qx, qx_ci, th_q=None) -> dict[str, dict[str, Any]]:
    sp = lambda a, b: 0.5 * an.key_rate_bb84((a + b) / 2)  # noqa: E731
    lca = an.key_rate_per_basis
    tsp = tl = None
    if th_q is not None:
        tsp, tl = sp(*th_q), lca(*th_q)
    return {
        "shor_preskill": an.metric(sp(qz, qx), [sp(qz_ci[1], qx_ci[1]), sp(qz_ci[0], qx_ci[0])], tsp),
        "lca_biased": an.metric(lca(qz, qx), [lca(qz_ci[1], qx_ci[1]), lca(qz_ci[0], qx_ci[0])], tl),
    }


def _theory_q(p: Sequence[float] | None) -> tuple[float, float] | None:
    if p is None:
        return None
    xx, _, zz = an.correlators_from_bell_diagonal(p)
    return (1 - zz) / 2, (1 - xx) / 2


def _purified_p(spec: Spec, u: str) -> tuple[float, ...] | None:
    if spec["kind"] == "damping":
        return None
    p = purify.permute(bell_diag_of(spec), u)
    return purify.dejmps_map2(p, p)[0]


def _fmt(v: float | None, nd: int = 3) -> str:
    return "n/a" if v is None or not math.isfinite(v) else f"{v:.{nd}f}"


def decode_rescue(
    counts_by_id: dict[str, dict[str, int]],
    damage: dict[str, Any] | None = None,
    broken: str = "BOG-CAL",
    healthy_F: float | Sequence[float] = 0.95,
    target_F: float = 0.9,
    mode: str = "precision",
    seed: int = 0,
) -> dict[str, Any]:
    """Turn the counts of ``build_rescue`` into strategies, recommendation, viz.

    Recommendation criterion: (1) the lower CI bound of the measured fidelity
    meets ``target_F``; (2) among those, the lowest raw pairs per delivered
    pair INCLUDING fiber loss (raw pairs / eta_effective). The strategy with
    the fewest raw pairs ignoring loss is reported too. Purify costs use the
    point estimate of p_s, while the fidelity test uses its lower CI bound.
    """
    broken = geo.normalize_link(broken)
    plan = plan_rescue(damage, healthy_F, mode)
    spec, us, mode_u = plan["spec"], plan["us"], plan["mode"]
    f1, f2 = plan["healthy"]
    pdec = purify.decode_purify(counts_by_id, spec, us, None, mode_u, seed)
    sdec = swap.decode_swap(counts_by_id, f1, f2, mode_u, seed + 1)
    pm, ex = pdec["metrics"], pdec["extra"]
    chosen = pdec["viz"]["choice"]["chosen"]
    tomo = ex["tomo_corr"]
    ra, rb = geo.reroute_links(broken)
    eta_d = geo.transmissivity(geo.link_length_km(*broken.split("-")))
    hop = [geo.transmissivity(geo.link_length_km(*r.split("-"))) for r in (ra, rb)]
    rr = geo.reroute_eta(hop)
    eta_info = {
        "direct": {"eta": eta_d, "loss_db": geo.loss_db(eta_d)},
        "reroute": {"eta_ideal_memory": rr["ideal_memory"], "eta_no_memory": rr["no_memory"],
                    "loss_db_ideal_memory": geo.loss_db(rr["ideal_memory"]),
                    "loss_db_no_memory": geo.loss_db(rr["no_memory"]),
                    "hops": {ra: hop[0], rb: hop[1]}},
    }
    eta_eff = {"direct": eta_d, "reroute": rr["ideal_memory"],
               "purify_fixed": eta_d, "purify_adaptive": eta_d}

    def strat(key, title, fid, qz, qx, raw_val, raw_metric, th_q, detail, samples, u=None, p_s=None):
        rates = _rate_metrics(*qz, *qx, th_q)
        cost = raw_val / eta_eff[key]
        sp, lca = rates["shor_preskill"]["value"], rates["lca_biased"]["value"]
        return {
            "key": key, "title": title, "status": "ok", "fidelity": fid, "raw_pairs": raw_metric,
            "eta_effective": eta_eff[key], "loss_db": geo.loss_db(eta_eff[key]),
            "raw_pairs_per_delivered": cost,
            "qber_Z": an.metric(qz[0], qz[1], th_q[0] if th_q else None),
            "qber_X": an.metric(qx[0], qx[1], th_q[1] if th_q else None),
            "key_rate_shor_preskill": rates["shor_preskill"], "key_rate_lca_biased": rates["lca_biased"],
            "key_per_raw_pair": {"shor_preskill": sp / raw_val, "lca_biased": lca / raw_val},
            "meets_target": bool(fid["ci95"][0] >= target_F), "u": u, "p_s": p_s,
            "explanation": f"{detail} Fidelity lower CI bound {fid['ci95'][0]:.3f} vs target {target_F}.",
            "samples": samples,
        }

    def no_data(key, title, u):
        return {"key": key, "title": title, "status": "no_data", "meets_target": False, "u": u,
                "fidelity": None, "raw_pairs": None, "samples": [],
                "explanation": "No data: no shot passed the postselection, so nothing can be said."}

    th_in = bell_diag_of(spec)
    strategies = []
    fi = pm["fidelity_input"]
    strategies.append(strat(
        "direct", "Use the damaged link", fi, _q(tomo["ZZ"]), _q(tomo["XX"]), 1.0,
        an.metric(1.0, [1.0, 1.0], 1.0), _theory_q(th_in),
        f"Direct link: F = {fi['value']:.3f}, 1 raw pair per delivered pair.",
        an.sample_parity(ex["per_basis"]["tomo"]["ZZ"], [0, 1], seed=seed),
    ))
    sf = sdec["metrics"]["fidelity"]
    th_sw = swap.theory_swap(f1, f2)
    sw_p = swap.swap_bell_diag(bell_diag_of(werner_spec(f1)), bell_diag_of(werner_spec(f2)))
    strategies.append(strat(
        "reroute", f"Reroute via {geo.CITIES[geo.third_city(broken)]['name']}", sf,
        _q(sdec["metrics"]["corr_ZZ"]), _q(sdec["metrics"]["corr_XX"]), 2.0,
        an.metric(2.0, [2.0, 2.0], 2.0), _theory_q(sw_p),
        f"Swap over healthy links {ra} and {rb}: F = {sf['value']:.3f} (theory {th_sw['F']:.3f}), "
        "2 raw pairs (ideal Bell measurement).",
        sdec["viz"]["samples"],
    ))
    for key, u, title in (("purify_fixed", "I", "Purify once (fixed DEJMPS)"),
                          ("purify_adaptive", chosen, "Purify once (adaptive U)")):
        if key == "purify_adaptive" and chosen == "I":
            continue
        tag = "fixed" if u == "I" else "adaptive"
        st = ex["stats"][u]
        if st["p_s"] <= 0 or any(c.get("empty") for c in st["corr"].values()):
            strategies.append(no_data(key, title, u))
            continue
        fid, raw = pm[f"fidelity_{tag}"], pm[f"raw_pairs_{tag}"]
        samples = an.sample_parity(ex["per_basis"][u]["ZZ"], [0, 1], postselect=[(2, 3)], seed=seed)
        strategies.append(strat(
            key, title, fid, _q(st["corr"]["ZZ"]), _q(st["corr"]["XX"]), st["cost"],
            an.metric(raw["value"], raw["ci95"], raw["theory"]), _theory_q(_purified_p(spec, u)),
            f"One DEJMPS round (U = {u}): F = {fid['value']:.3f} (input {fi['value']:.3f}), success "
            f"{st['p_s']:.2f}, {st['cost']:.2f} raw pairs per output pair.",
            samples, u=u, p_s=st["p_s"],
        ))
    live = [s for s in strategies if s["status"] == "ok"]
    ok = [s for s in live if s["meets_target"]]
    criterion = ("lower CI bound of F meets the target; then fewest raw pairs per delivered pair "
                 "including fiber loss")
    if ok:
        best = min(ok, key=lambda s: s["raw_pairs_per_delivered"])
        fewest = min(ok, key=lambda s: s["raw_pairs"]["value"])
        rec = {"strategy": best["key"], "meets_target": True, "criterion": criterion,
               "fewest_raw_pairs_ignoring_loss": fewest["key"],
               "message": f"Recommended: {best['title']} (F = {best['fidelity']['value']:.3f}, "
                          f"{best['raw_pairs']['value']:.2f} raw pairs). Criterion: {criterion}."}
    else:
        top = max(live, key=lambda s: s["fidelity"]["value"])
        rec = {"strategy": None, "meets_target": False, "criterion": criterion,
               "fewest_raw_pairs_ignoring_loss": None,
               "message": f"No single strategy meets the target {target_F} with confidence. "
                          f"Best measured: {top['title']} (F = {top['fidelity']['value']:.3f}). "
                          "See the multi-round projections, or lower the target."}
    proj = {
        name: purify.rounds_to_target(th_in, target_F, strat_name)
        for name, strat_name in (("recursive_fixed_single_link", "fixed"), ("adaptive", "adaptive"),
                                 ("pumping", "pumping"), ("auto", "auto"))
    }
    metrics: dict[str, Any] = {}
    theory_f = {"direct": th_in[0], "reroute": th_sw["F"],
                "purify_fixed": purify.theory_purify(spec, "I")["F_out"],
                "purify_adaptive": purify.theory_purify(spec, chosen)["F_out"]}
    for s in live:
        k = s["key"]
        metrics[f"fidelity_{k}"] = {**s["fidelity"], "theory": theory_f[k]}
        metrics[f"raw_pairs_{k}"] = s["raw_pairs"]
        metrics[f"key_rate_shor_preskill_{k}"] = s["key_rate_shor_preskill"]
        metrics[f"key_rate_lca_biased_{k}"] = s["key_rate_lca_biased"]
        metrics[f"key_per_raw_pair_lca_biased_{k}"] = an.metric(
            s["key_per_raw_pair"]["lca_biased"], [s["key_rate_lca_biased"]["ci95"][0] / s["raw_pairs"]["value"],
                                                  s["key_rate_lca_biased"]["ci95"][1] / s["raw_pairs"]["value"]], None)
    best_f = next((s["fidelity"] for s in live if s["key"] == rec["strategy"]), fi)
    spy = plan["damage"]["kind"] == "spy"
    if spy:
        src = "simulated (dephasing-equivalent model)" if mode_u == "precision" else "dephasing-equivalent model"
    else:
        src = "simulated" if mode_u == "precision" else "circuit"
    viz = {
        "links": {
            lid: ({"F": best_f["value"], "ci95": best_f["ci95"],
                   "status": "rescued" if rec["meets_target"] else "damaged", "source": src,
                   "direct_F": fi["value"], "via": rec["strategy"]}
                  if lid == broken else
                  {"F": f1 if lid == ra else f2, "ci95": None, "status": "healthy", "source": "configured"})
            for lid in geo.LINK_IDS
        },
        "strategies": [{k: v for k, v in s.items() if k != "samples"} for s in strategies],
        "samples": {s["key"]: s["samples"] for s in strategies},
        "leak": {"value": 1.0 - fi["value"], "source": src},
        "recommendation": rec,
        "projections": proj,
        "projection_note": "Bell-diagonal projection with ideal local gates, single damaged link; "
                           "'recursive_fixed_single_link' repeats the fixed circuit k times. Not measured.",
        "geo": {**eta_info, "note": "eta is one photon over the fiber (source at one end); loss lowers "
                "the pair rate, not the fidelity. Reroute with ideal memories is limited by the worse hop "
                "(min); without memories it is the product. Assumes an ideal Bell measurement."},
        "criteria_note": "Fidelity test uses the lower CI bound; purify costs use the point estimate of p_s.",
        "predicted_u": plan["predicted_u"],
        "choice": pdec["viz"]["choice"],
        "notes": list(_NOTES[mode_u]) + (
            ["spy modelled as the equivalent Z-dephasing channel, not the CRY circuit"] if spy else []),
    }
    return {"metrics": metrics, "viz": viz}


def run_rescue(
    backend: Any,
    shots: int = 1000,
    broken: str = "BOG-CAL",
    damage: dict[str, Any] | None = None,
    healthy_F: float | Sequence[float] = 0.95,
    target_F: float = 0.9,
    mode: str = "precision",
    seed: int = 0,
    **run_options: Any,
) -> dict[str, Any]:
    """Run the rescue with a single ``backend.run``; returns the JSON contract."""
    if not 0.0 < target_F <= 1.0:
        raise ValueError("target_F must be in (0, 1]")
    broken = geo.normalize_link(broken)
    circuits, plan = build_rescue(damage, healthy_F, mode)
    counts, compiled = run_batch(backend, circuits, shots, **run_options)
    dec = decode_rescue(counts, damage, broken, healthy_F, target_F, mode, seed)
    keep = [qc for qc in circuits if qc.name.endswith("_ZZ")]
    dec["viz"]["steps"] = {qc.name: an.circuit_steps(qc) for qc in keep}
    return an.make_result(
        "rescue", "live", an.backend_name(backend), shots,
        {"broken": broken, "damage": plan["damage"], "healthy_F": list(plan["healthy"]),
         "target_F": target_F, "mode": plan["mode"], "channel": _CHANNEL[plan["mode"]]},
        purify.BIT_ORDER + " | swap: " + swap.BIT_ORDER, dec["metrics"],
        circuit_report(circuits, compiled), counts, viz=dec["viz"],
    )
