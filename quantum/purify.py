"""Level 5, entanglement distillation: DEJMPS, fixed and adaptive.

Two noisy pairs (A1, B1) and (A2, B2). Alice applies RX(pi/2) (=SX) and Bob
RX(-pi/2) (=SXdg) to their halves, both do CX(1 -> 2), the target qubits
A2, B2 are measured in Z and the run is kept only if they agree
(postselection in Python). The kept pair is (A1, B1), measured in X, Y or Z
to estimate its fidelity F' and the success probability p_s.

Bit order (Qiskit little-endian), register ``out``:
clbit 0 = A1, 1 = B1, 2 = A2, 3 = B2; postselect pairs [(2, 3)].

Adaptive distillation (the project's "the protocol listens to the noise and
adapts" idea): the fixed circuit is blind to some errors (e.g. Y). The
tomography XX/YY/ZZ of the raw pair gives Bell-diagonal weights
(p_I, p_X, p_Y, p_Z); a local Clifford U on Alice and its complex conjugate U*
on Bob leaves Phi+ invariant but permutes the X, Y, Z errors (``U_PERM``,
verified with operators in the tests). We pick U in {I, H, S, HS, SH, HSH}
that maximizes the predicted F' (``choose_u``). "HS" means: apply S, then H.
Caveats (honest limits): the choice assumes Bell-diagonal states, the
tomography ignores coherences (amplitude damping is not Bell-diagonal, but
the choice still works there, see tests), and the improvement over the fixed
circuit appears only for noise that the fixed circuit does not see
(Y, misaligned X/Z, mixtures, damping).

Run strategies (trade-off): "all" builds tomography (3) + 6 U x 3 bases = 21
circuits, so the adaptive choice is made from the measured tomography inside
ONE job; "predicted" builds tomography (3) + fixed (3) + the U predicted from
the configured noise (3) = 9 circuits (fits the IonQ batch). The adaptive
choice is the best U among the BUILT list according to the measured
tomography; if the tomography's global best U was not built,
``viz.choice.limited`` is True and the adaptive result is a lower bound.

Modes follow noise.py: "teaching" puts the channel in environment qubits
(<= 8 qubits); "precision" runs ideal circuits and samples Pauli errors in
Python (Pauli channels only), simulating the channel classically.

Cost: one output pair consumes 2 raw pairs and succeeds with probability p_s,
so the expected cost is 2 / p_s raw pairs per output pair; fidelity improves at
the price of this cost. ``rounds_to_target`` iterates the map for the
multi-round cost with fixed, adaptive and pumping strategies.

References:
    - Deutsch et al. (1996). Phys. Rev. Lett. 77:2818 (DEJMPS).
    - Bennett et al. (1996). Phys. Rev. Lett. 76:722 (BBPSSW).
    - Dur & Briegel (2007). Rep. Prog. Phys. 70:1381 (pumping, recursion).
    - Gottesman (1998). Heisenberg representation of quantum computers
      (Clifford action on Paulis).
"""

from __future__ import annotations

import math
from typing import Any, Sequence

import numpy as np
from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister
from qiskit.quantum_info import DensityMatrix, partial_trace

from . import analysis as an
from .execute import circuit_report, run_batch, safe_name
from .links import BASES, rotate_to_basis
from .noise import (
    Spec, _CHANNEL, _NOTES, apply_channel, apply_pauli_flips, bell_diag_of,
    build_pair, error_flip_masks, make_spec, n_env, pauli_probs, spec_label,
)

BIT_ORDER = "Qiskit little-endian; clbits: 0=A1, 1=B1, 2=A2, 3=B2 (postselect A2==B2)"
U_NAMES = ("I", "H", "S", "HS", "SH", "HSH")
# Gates in application order; Bob applies the complex conjugate (s -> sdg).
U_SEQ = {
    "I": [], "H": ["h"], "S": ["s"], "HS": ["s", "h"], "SH": ["h", "s"],
    "HSH": ["h", "s", "h"],
}
# Error permutation (U* P U*^dagger on Bob) from the table in the research notes.
U_PERM = {
    "I": {"X": "X", "Y": "Y", "Z": "Z"},
    "H": {"X": "Z", "Y": "Y", "Z": "X"},
    "S": {"X": "Y", "Y": "X", "Z": "Z"},
    "HS": {"X": "Y", "Y": "Z", "Z": "X"},
    "SH": {"X": "Z", "Y": "X", "Z": "Y"},
    "HSH": {"X": "X", "Y": "Z", "Z": "Y"},
}
_IDX = {"I": 0, "X": 1, "Y": 2, "Z": 3}
_Q_B1, _Q_B2 = 1, 3


# --------------------------------------------------------------------------
# Theory (pure functions)
# --------------------------------------------------------------------------

def permute(p: Sequence[float], u: str) -> tuple[float, float, float, float]:
    """Pauli weights after the local Clifford U (x) U*: new[perm[e]] = p[e]."""
    out = [p[0], 0.0, 0.0, 0.0]
    for e in "XYZ":
        out[_IDX[U_PERM[u][e]]] = p[_IDX[e]]
    return tuple(out)  # type: ignore[return-value]


def dejmps_map2(p1: Sequence[float], p2: Sequence[float]) -> tuple[tuple[float, ...], float]:
    """DEJMPS on two Bell-diagonal pairs; returns (p' of pair 1, p_s).

    With (A, B, C, D) = (p_I, p_Y, p_X, p_Z) (Phi+, Psi-, Psi+, Phi-):
    A' = (A1A2 + B1B2)/N, B' = (C1D2 + D1C2)/N, C' = (C1C2 + D1D2)/N,
    D' = (A1B2 + B1A2)/N with N = (A1+B1)(A2+B2) + (C1+D1)(C2+D2).
    """
    a1, b1, c1, d1 = p1[0], p1[2], p1[1], p1[3]
    a2, b2, c2, d2 = p2[0], p2[2], p2[1], p2[3]
    n = (a1 + b1) * (a2 + b2) + (c1 + d1) * (c2 + d2)
    a = (a1 * a2 + b1 * b2) / n
    b = (c1 * d2 + d1 * c2) / n
    c = (c1 * c2 + d1 * d2) / n
    d = (a1 * b2 + b1 * a2) / n
    return (a, c, b, d), n  # back to (I, X, Y, Z)


def dejmps_map(p: Sequence[float]) -> tuple[tuple[float, ...], float]:
    """DEJMPS on two copies of the same Bell-diagonal state: (p', p_s)."""
    return dejmps_map2(p, p)


def werner_formula(F: float) -> tuple[float, float]:
    """Closed forms for Werner(F): p_s and F' (CLAUDE.md)."""
    q = (1.0 - F) / 3.0
    ps = F * F + 2.0 * F * q + 5.0 * q * q
    return ps, (F * F + q * q) / ps


def normalize_p(p: Sequence[float]) -> tuple[float, float, float, float]:
    """Clip negative shot-noise weights to 0 and renormalize."""
    arr = np.clip(np.asarray(p, dtype=float), 0.0, None)
    arr = arr / arr.sum()
    return tuple(float(v) for v in arr)  # type: ignore[return-value]


def _corr_from_p(p: Sequence[float]) -> np.ndarray:
    """(<XX>, <YY>, <ZZ>) of a Bell-diagonal state."""
    return np.array(an.correlators_from_bell_diagonal(p))


def _p_from_corr(c: np.ndarray) -> tuple[float, float, float, float]:
    xx, yy, zz = c
    return ((1 + xx - yy + zz) / 4, (1 + xx + yy - zz) / 4,
            (1 - xx - yy - zz) / 4, (1 - xx + yy + zz) / 4)


def _predicted_fp(c: np.ndarray, u: str) -> float:
    return dejmps_map(permute(normalize_p(_p_from_corr(c)), u))[0][0]


def choose_u(
    p: Sequence[float],
    candidates: Sequence[str] = U_NAMES,
    margin: float = 1e-2,
    shots: float | None = None,
    z: float = 3.0,
) -> tuple[str, dict[str, float]]:
    """Best U by predicted F'; 'I' is kept unless another U clearly gains.

    The gain over 'I' must exceed ``margin`` and, when the tomography size
    ``shots`` (per basis) is given, also ``z`` standard errors of that gain
    (delta method on the three correlators), so shot noise does not switch to
    an equivalent U when the noise is symmetric (e.g. Werner).
    """
    p = normalize_p(p)
    pred = {u: dejmps_map(permute(p, u))[0][0] for u in candidates}
    best = max(candidates, key=lambda u: (round(pred[u], 12), -list(candidates).index(u)))
    if "I" not in pred or best == "I":
        return best, pred
    need = margin
    if shots:
        c0 = _corr_from_p(p)
        var_c = np.clip(1.0 - c0**2, 1e-6, None) / shots
        grad = np.zeros(3)
        for k in range(3):
            d = np.zeros(3)
            d[k] = 1e-4
            hi, lo = c0 + d, c0 - d
            grad[k] = (
                (_predicted_fp(hi, best) - _predicted_fp(hi, "I"))
                - (_predicted_fp(lo, best) - _predicted_fp(lo, "I"))
            ) / 2e-4
        need = max(margin, z * float(np.sqrt((grad**2 * var_c).sum())))
    return (best if pred[best] - pred["I"] > need else "I"), pred


def exact_purify(spec: Spec, u: str = "I", spec2: Spec = None) -> tuple[float, float]:
    """Exact (F', p_s) from the density matrix of the teaching circuit.

    Works for any channel (including non-Bell-diagonal amplitude damping).
    """
    qc = _purify_circuit("exact", "ZZ", spec, spec2 or spec, u)
    qc.remove_final_measurements()
    n_data = 4
    env = list(range(n_data, qc.num_qubits))
    rho = DensityMatrix(qc)
    if env:
        rho = partial_trace(rho, env)
    r = rho.data  # index = a1 + 2 b1 + 4 a2 + 8 b2
    sigma = np.zeros((4, 4), dtype=complex)
    for s in (0, 1):
        idx = [s * 4 + s * 8 + k for k in range(4)]
        sigma += r[np.ix_(idx, idx)]
    ps = float(np.real(np.trace(sigma)))
    phi = np.array([1, 0, 0, 1]) / math.sqrt(2)
    return float(np.real(phi @ sigma @ phi) / ps), ps


def theory_purify(spec: Spec, u: str = "I", spec2: Spec = None) -> dict[str, float]:
    """Theoretical F' and p_s (closed form if Bell-diagonal, exact otherwise)."""
    s2 = spec2 or spec
    if (spec is None or spec["kind"] != "damping") and (s2 is None or s2["kind"] != "damping"):
        p, ps = dejmps_map2(permute(bell_diag_of(spec), u), permute(bell_diag_of(s2), u))
        return {"F_out": p[0], "p_s": ps, "F_in": bell_diag_of(spec)[0]}
    f, ps = exact_purify(spec, u, s2)
    return {"F_out": f, "p_s": ps, "F_in": bell_diag_of(spec)[0]}


def rounds_to_target(
    p: Sequence[float],
    F_target: float,
    strategy: str = "adaptive",
    max_rounds: int = 12,
) -> dict[str, Any]:
    """Raw pairs needed to reach ``F_target`` from Bell-diagonal ``p`` (no circuits).

    Strategies: "fixed" (recursive DEJMPS, U=I), "adaptive" (recursive, best U
    each round), "pumping" (adaptive; the target is purified with a fresh raw
    pair each round, restart on failure: c_k = (c_{k-1} + 1) / p_s) and "auto"
    (cheapest reachable of adaptive and pumping, the hybrid selector).
    Recursive cost per round: c_k = 2 c_{k-1} / p_s.

    Every round is simulated (F may first drop, as the fixed circuit does with
    Y errors). The result is the FIRST round reaching the target with its
    accumulated cost; ``reachable`` is False only if no round within
    ``max_rounds`` reaches it, or F stops changing (|dF| < 1e-9 for 3 rounds)
    below the target.
    """
    if strategy == "auto":
        cands = [rounds_to_target(p, F_target, s, max_rounds) for s in ("adaptive", "pumping")]
        ok = [c for c in cands if c["reachable"]]
        return min(ok, key=lambda c: c["raw_pairs"]) if ok else cands[0]
    if strategy not in ("fixed", "adaptive", "pumping"):
        raise ValueError(f"unknown strategy {strategy!r}")
    raw = normalize_p(p)
    state, cost, rounds = raw, 1.0, 0
    traj, costs, still = [state[0]], [cost], 0
    while state[0] < F_target and rounds < max_rounds:
        other = raw if strategy == "pumping" else state
        u = "I"
        if strategy != "fixed":
            u = max(U_NAMES, key=lambda v: dejmps_map2(permute(state, v), permute(other, v))[0][0])
        new, ps = dejmps_map2(permute(state, u), permute(other, u))
        cost = (cost + 1.0) / ps if strategy == "pumping" else 2.0 * cost / ps
        still = still + 1 if abs(new[0] - state[0]) < 1e-9 else 0
        state, rounds = new, rounds + 1
        traj.append(state[0])
        costs.append(cost)
        if still >= 3:
            break  # fixed point below the target
    ok = state[0] >= F_target
    return {
        "strategy": strategy, "reachable": ok, "rounds": rounds,
        "raw_pairs": cost if ok else math.inf, "F": state[0],
        "trajectory": traj, "cost_trajectory": costs,
    }


# --------------------------------------------------------------------------
# Circuits
# --------------------------------------------------------------------------

def apply_u(qc: QuantumCircuit, alice: Any, bob: Any, u: str) -> None:
    """U on Alice's qubit and its complex conjugate U* on Bob's (Phi+ invariant)."""
    for g in U_SEQ[u]:
        getattr(qc, g)(alice)
        getattr(qc, "sdg" if g == "s" else g)(bob)


def _purify_circuit(name: str, pair: str, s1: Spec, s2: Spec, u: str, ideal: bool = False) -> QuantumCircuit:
    a1, b1, a2, b2 = (QuantumRegister(1, n) for n in ("A1", "B1", "A2", "B2"))
    regs = [a1, b1, a2, b2]
    e1 = e2 = None
    if not ideal:
        e1 = QuantumRegister(n_env(s1), "env1") if n_env(s1) else None
        e2 = QuantumRegister(n_env(s2), "env2") if n_env(s2) else None
        regs += [r for r in (e1, e2) if r is not None]
    out = ClassicalRegister(4, "out")
    qc = QuantumCircuit(*regs, out, name=name)
    for a, b in ((a1, b1), (a2, b2)):
        qc.h(a[0])
        qc.cx(a[0], b[0])
    qc.barrier(label="channel")  # errors enter here in precision mode
    if e1 is not None:
        apply_channel(qc, b1[0], list(e1), s1)
    if e2 is not None:
        apply_channel(qc, b2[0], list(e2), s2)
    for a, b in ((a1, b1), (a2, b2)):
        apply_u(qc, a[0], b[0], u)
        qc.sx(a[0])    # RX(pi/2) on Alice
        qc.sxdg(b[0])  # RX(-pi/2) on Bob
    qc.cx(a1[0], a2[0])
    qc.cx(b1[0], b2[0])
    rotate_to_basis(qc, a1[0], pair[0])
    rotate_to_basis(qc, b1[0], pair[1])
    qc.measure(a1[0], out[0])
    qc.measure(b1[0], out[1])
    qc.measure(a2[0], out[2])
    qc.measure(b2[0], out[3])
    return qc


def _label(mode: str, spec: Spec, spec2: Spec) -> str:
    if mode == "precision":
        return "ideal"
    return spec_label(spec) + ("" if spec2 is None else "_" + spec_label(spec2))


def _names(mode: str, spec: Spec, spec2: Spec, u: str, pair: str) -> str:
    return safe_name(f"pur_{_label(mode, spec, spec2)}_{u}_{pair}")


def _tomo_name(mode: str, spec: Spec, pair: str) -> str:
    return safe_name(f"pur_tomo_{'ideal' if mode == 'precision' else spec_label(spec)}_{pair}")


def build_purify(
    spec: Spec,
    us: Sequence[str] = ("I",),
    spec2: Spec = None,
    mode: str = "teaching",
    tomography: bool = True,
) -> list[QuantumCircuit]:
    """Tomography (3) + one DEJMPS triple (XX, YY, ZZ) per U in ``us``."""
    if mode not in ("teaching", "precision"):
        raise ValueError("mode must be 'teaching' or 'precision'")
    out: list[QuantumCircuit] = []
    if tomography:
        out += [
            build_pair(_tomo_name(mode, spec, p), p, None if mode == "precision" else spec)
            for p in BASES
        ]
    s1, s2 = (None, None) if mode == "precision" else (spec, spec2 or spec)
    for u in us:
        out += [
            _purify_circuit(_names(mode, spec, spec2, u, p), p, s1, s2, u, mode == "precision")
            for p in BASES
        ]
    return out


# --------------------------------------------------------------------------
# Decoding
# --------------------------------------------------------------------------

def _injected(
    qc: QuantumCircuit, counts: dict[str, int], errs: dict[int, Spec], rng: np.random.Generator
) -> dict[str, int]:
    """Precision mode: sample the Pauli errors of ``errs`` into the ideal counts."""
    errs = {q: s for q, s in errs.items() if s is not None}
    if not errs:
        return counts
    masks = error_flip_masks(qc, list(errs))
    n = len(qc.cregs[0])
    return apply_pauli_flips(counts, n, masks, {q: pauli_probs(s) for q, s in errs.items()}, rng)


def _run_stats(per_basis: dict[str, dict[str, int]]) -> dict[str, Any]:
    """F', p_s (pooled over the three bases, Wilson CI) and cost for one U."""
    corr = {p: an.correlator(c, [0, 1], postselect=[(2, 3)]) for p, c in per_basis.items()}
    fid = an.bell_fidelity(corr["XX"], corr["YY"], corr["ZZ"])
    acc = sum(c["accepted"] for c in corr.values())
    tot = sum(c["total"] for c in corr.values())
    lo, hi = an.wilson(acc, tot)
    ps = acc / tot if tot else 0.0
    cost = [2.0 / hi if hi > 0 else math.inf, 2.0 / lo if lo > 0 else math.inf]
    return {
        "fid": fid, "p_s": ps, "p_s_ci95": [lo, hi], "cost": 2.0 / ps if ps > 0 else math.inf,
        "cost_ci95": cost, "per_basis": per_basis,
    }


def decode_purify(
    counts_by_id: dict[str, dict[str, int]],
    spec: Spec,
    us: Sequence[str] = ("I",),
    spec2: Spec = None,
    mode: str = "teaching",
    seed: int = 0,
) -> dict[str, Any]:
    """Tomography -> adaptive choice; fixed vs adaptive F', p_s and raw-pair cost."""
    rng = np.random.default_rng(seed)
    s2 = spec2 or spec
    circuits = {qc.name: qc for qc in build_purify(spec, us, spec2, mode)}

    def counts_for(name: str, errs: dict[int, Spec]) -> dict[str, int]:
        c = counts_by_id[name]
        return _injected(circuits[name], c, errs, rng) if mode == "precision" else c

    tomo = {p: an.correlator(counts_for(_tomo_name(mode, spec, p), {1: spec}), [0, 1]) for p in BASES}
    f_in = an.bell_fidelity(tomo["XX"], tomo["YY"], tomo["ZZ"])
    p_hat = normalize_p(an.bell_diagonal(tomo["XX"], tomo["YY"], tomo["ZZ"]))

    stats = {}
    for u in us:
        per = {
            p: counts_for(_names(mode, spec, spec2, u, p), {_Q_B1: spec, _Q_B2: s2})
            for p in BASES
        }
        stats[u] = _run_stats(per)

    t_shots = min(c["shots"] for c in tomo.values())
    chosen, predicted = choose_u(p_hat, us, shots=t_shots)
    global_choice, _ = choose_u(p_hat, U_NAMES, shots=t_shots)
    th_in = bell_diag_of(spec)[0]
    metrics: dict[str, Any] = {
        "fidelity_input": an.metric(f_in["value"], f_in["ci95"], th_in, raw=f_in["raw"]),
    }
    for key, u in (("fixed", "I"), ("adaptive", chosen)):
        if u not in stats:
            continue
        st, th = stats[u], theory_purify(spec, u, spec2)
        metrics[f"fidelity_{key}"] = an.metric(
            st["fid"]["value"], st["fid"]["ci95"], th["F_out"], raw=st["fid"]["raw"], u=u
        )
        metrics[f"p_s_{key}"] = an.metric(st["p_s"], st["p_s_ci95"], th["p_s"], u=u)
        metrics[f"raw_pairs_{key}"] = an.metric(st["cost"], st["cost_ci95"], 2.0 / th["p_s"], u=u)
    ps_inp = stats[chosen]["p_s"] if chosen in stats else None
    viz = {
        "choice": {
            "chosen": chosen, "global_best": global_choice,
            "limited": global_choice not in us,
            "predicted_F_out": predicted,
            "measured_F_out": {u: s["fid"]["value"] for u, s in stats.items()},
            "p_hat": list(p_hat),
        },
        "samples": an.sample_parity(
            stats[chosen]["per_basis"]["ZZ"], [0, 1], postselect=[(2, 3)]
        ),
        "leak": {
            "value": 1.0 - f_in["value"], "source": "simulated" if mode == "precision" else "circuit",
        },
        "links": {
            "input": {"F": f_in["value"], "ci95": f_in["ci95"]},
            "fixed": {"F": stats["I"]["fid"]["value"]} if "I" in stats else None,
            "adaptive": {"F": stats[chosen]["fid"]["value"], "u": chosen, "p_s": ps_inp},
        },
        "bloch": {"theory": [0.0, 0.0, 0.0]},
        "notes": list(_NOTES[mode]),
    }
    return {"metrics": metrics, "viz": viz}


def run_purify(
    backend: Any,
    shots: int = 1000,
    F: float | None = None,
    gamma: float | None = None,
    p: Sequence[float] | None = None,
    strategy: str = "all",
    mode: str = "teaching",
    seed: int = 0,
    **run_options: Any,
) -> dict[str, Any]:
    """Run level 5 with a single ``backend.run``; returns the JSON contract.

    Give one of ``F`` (Werner), ``gamma`` (amplitude damping) or ``p`` (Pauli
    weights I, X, Y, Z). ``strategy``: "all" (21 circuits) or "predicted" (9).
    """
    spec = make_spec(F, gamma, p)
    if spec is None:
        raise ValueError("give F, gamma or p")
    if strategy == "all":
        us: tuple[str, ...] = U_NAMES
    elif strategy == "predicted":
        best, _ = choose_u(bell_diag_of(spec))
        us = ("I",) if best == "I" else ("I", best)
    else:
        raise ValueError("strategy must be 'all' or 'predicted'")
    circuits = build_purify(spec, us, None, mode)
    counts, compiled = run_batch(backend, circuits, shots, **run_options)
    dec = decode_purify(counts, spec, us, None, mode, seed)
    chosen = dec["viz"]["choice"]["chosen"]
    keep = {qc.name for qc in circuits if qc.name.endswith("_ZZ")
            and (f"_{chosen}_" in qc.name or "_I_" in qc.name or "tomo" in qc.name)}
    dec["viz"]["steps"] = {qc.name: an.circuit_steps(qc) for qc in circuits if qc.name in keep}
    return an.make_result(
        "purify", "live", an.backend_name(backend), shots,
        {"noise": spec, "strategy": strategy, "mode": mode, "channel": _CHANNEL[mode]},
        BIT_ORDER, dec["metrics"], circuit_report(circuits, compiled), counts, viz=dec["viz"],
    )
