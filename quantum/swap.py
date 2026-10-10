"""Level 4, quantum repeater: entanglement swapping A-B1 + B2-C -> A-C.

Two Bell pairs (A, B1) and (B2, C), each optionally degraded by a Werner(F)
channel on the repeater's half. The repeater performs a Bell measurement,
CX(B1, B2) then H(B1), measured at the END (deferred measurement). The
outcomes only tell which Pauli the end-to-end pair carries, so they are
applied as a Pauli frame in Python (parity correction on the A-C correlators).

Bit order (Qiskit little-endian), register ``out``:
clbit 0 = A, 1 = C, 2 = m_z (outcome of B1: triggers Z on C),
3 = m_x (outcome of B2: triggers X on C).
Pauli frame: ZZ <- ZZ xor m_x, XX <- XX xor m_z, YY <- YY xor m_x xor m_z.

Theory: Werner pairs compose as a convolution of their Pauli weights over the
Klein four-group, giving F = F1 F2 + (1-F1)(1-F2)/3 (see ``swap_bell_diag``).
At most 8 qubits (4 + up to 4 environment qubits).

Modes: "teaching" (environment qubits inside the circuit, 9 CX-equivalents)
and "precision" (ideal 3-CX circuits shared by every F; the Pauli errors are
sampled in Python and propagated through the Clifford repeater circuit with
``noise.error_flip_masks``). Precision simulates the channel classically, and
only the 3-CX circuit is exposed to hardware noise.

References:
    - Zukowski, Zeilinger, Horne, Ekert (1993). Phys. Rev. Lett. 71:4287.
    - Briegel, Dur, Cirac, Zoller (1998). Phys. Rev. Lett. 81:5932.
    - Knill (2005). Nature 434:39 (Pauli frame).
    - Werner (1989). Phys. Rev. A 40:4277.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister

from . import analysis as an
from .execute import circuit_report, run_batch, safe_name
from .links import BASES, rotate_to_basis
from .noise import (
    Spec, apply_channel, apply_pauli_flips, error_flip_masks, n_env, pauli_probs,
    spec_label, werner_spec, _NOTES, _CHANNEL,
)

BIT_ORDER = "Qiskit little-endian; clbits: 0=A, 1=C, 2=m_z (B1), 3=m_x (B2)"
_FRAME = {"ZZ": [3], "XX": [2], "YY": [2, 3]}
_Q_B1, _Q_B2 = 1, 2  # qubit indices of the repeater halves


def _specs(F1: float | None, F2: float | None) -> tuple[Spec, Spec]:
    return (
        None if F1 is None else werner_spec(F1),
        None if F2 is None else werner_spec(F2),
    )


def _cname(mode: str, F1: float | None, F2: float | None, pair: str) -> str:
    if mode == "precision":
        return f"swap_ideal_{pair}"
    s1, s2 = _specs(F1, F2)
    return safe_name(f"swap_{spec_label(s1)}_{spec_label(s2)}_{pair}")


def _swap_circuit(name: str, pair: str, s1: Spec, s2: Spec) -> QuantumCircuit:
    a, b1, b2, c = (QuantumRegister(1, n) for n in ("A", "B1", "B2", "C"))
    regs = [a, b1, b2, c]
    e1 = QuantumRegister(n_env(s1), "env1") if n_env(s1) else None
    e2 = QuantumRegister(n_env(s2), "env2") if n_env(s2) else None
    regs += [r for r in (e1, e2) if r is not None]
    out = ClassicalRegister(4, "out")
    qc = QuantumCircuit(*regs, out, name=name)
    qc.h(a[0])
    qc.cx(a[0], b1[0])
    qc.h(b2[0])
    qc.cx(b2[0], c[0])
    qc.barrier(label="channel")  # errors enter here in precision mode
    if e1 is not None:
        apply_channel(qc, b1[0], list(e1), s1)
    if e2 is not None:
        apply_channel(qc, b2[0], list(e2), s2)
    qc.cx(b1[0], b2[0])  # Bell measurement of the repeater
    qc.h(b1[0])
    rotate_to_basis(qc, a[0], pair[0])
    rotate_to_basis(qc, c[0], pair[1])
    qc.measure(a[0], out[0])
    qc.measure(c[0], out[1])
    qc.measure(b1[0], out[2])
    qc.measure(b2[0], out[3])
    return qc


def build_swap(
    F1: float | None = 0.9, F2: float | None = 0.85, mode: str = "teaching"
) -> list[QuantumCircuit]:
    """XX, YY, ZZ circuits of the repeater (``F=None`` means a clean pair)."""
    if mode not in ("teaching", "precision"):
        raise ValueError("mode must be 'teaching' or 'precision'")
    s1, s2 = (None, None) if mode == "precision" else _specs(F1, F2)
    return [
        _swap_circuit(_cname(mode, F1, F2, p), p, s1, s2) for p in BASES
    ]


def swap_bell_diag(p1, p2) -> tuple[float, float, float, float]:
    """Pauli weights after swapping two Bell-diagonal pairs (group convolution)."""
    order = (0, 1, 3, 2)  # I, X, Y, Z -> labels I=0, X=1, Z=2, Y=3 under XOR
    a, b = np.zeros(4), np.zeros(4)
    for idx, lab in enumerate(order):
        a[lab], b[lab] = p1[idx], p2[idx]
    c = np.zeros(4)
    for i in range(4):
        for j in range(4):
            c[i ^ j] += a[i] * b[j]
    return (c[0], c[1], c[3], c[2])  # back to I, X, Y, Z


def theory_swap(F1: float | None, F2: float | None) -> dict[str, float]:
    """End-to-end fidelity F1 F2 + (1-F1)(1-F2)/3 and the three correlators."""
    s1, s2 = _specs(F1, F2)
    p = swap_bell_diag(pauli_probs(s1), pauli_probs(s2))
    xx, yy, zz = an.correlators_from_bell_diagonal(p)
    return {"F": p[0], "XX": xx, "YY": yy, "ZZ": zz}


def decode_swap(
    counts_by_id: dict[str, dict[str, int]],
    F1: float | None = 0.9,
    F2: float | None = 0.85,
    mode: str = "teaching",
    seed: int = 0,
) -> dict[str, Any]:
    """Pauli-frame-corrected A-C correlators, fidelity with CI, viz payload."""
    s1, s2 = _specs(F1, F2)
    rng = np.random.default_rng(seed)
    per = {}
    for qc in build_swap(F1, F2, mode):
        pair = qc.name[-2:]
        counts = counts_by_id[qc.name]
        if mode == "precision":
            errs = {q: s for q, s in ((_Q_B1, s1), (_Q_B2, s2)) if s is not None}
            if errs:
                masks = error_flip_masks(qc, list(errs))
                counts = apply_pauli_flips(
                    counts, 4, masks, {q: pauli_probs(s) for q, s in errs.items()}, rng
                )
        per[pair] = counts
    corr = {p: an.correlator(per[p], [0, 1], flips=_FRAME[p]) for p in BASES}
    fid = an.bell_fidelity(corr["XX"], corr["YY"], corr["ZZ"])
    th = theory_swap(F1, F2)
    metrics = {
        f"corr_{p}": an.metric(c["value"], c["ci95"], th[p]) for p, c in corr.items()
    }
    metrics["fidelity"] = an.metric(fid["value"], fid["ci95"], th["F"], raw=fid["raw"])
    f1 = 1.0 if F1 is None else F1
    f2 = 1.0 if F2 is None else F2
    viz = {
        "samples": an.sample_parity(per["ZZ"], [0, 1], flips=_FRAME["ZZ"], seed=seed),
        "leak": {
            "value": 1.0 - fid["value"],
            "by_link": {"AB": 1.0 - f1, "BC": 1.0 - f2},
            "source": "simulated" if mode == "precision" else "circuit",
        },
        "links": {
            "AB": {"F": f1}, "BC": {"F": f2},
            "AC": {"F": fid["value"], "ci95": fid["ci95"]},
        },
        "bloch": {"theory": [0.0, 0.0, 0.0]},
        "notes": list(_NOTES[mode]),
    }
    return {"metrics": metrics, "viz": viz}


def run_swap(
    backend: Any,
    shots: int = 1000,
    F1: float | None = 0.9,
    F2: float | None = 0.85,
    mode: str = "teaching",
    seed: int = 0,
    **run_options: Any,
) -> dict[str, Any]:
    """Run level 4 with a single ``backend.run``; returns the JSON contract."""
    circuits = build_swap(F1, F2, mode)
    counts, compiled = run_batch(backend, circuits, shots, **run_options)
    dec = decode_swap(counts, F1, F2, mode, seed)
    dec["viz"]["steps"] = {qc.name: an.circuit_steps(qc) for qc in circuits}
    return an.make_result(
        "swap", "live", an.backend_name(backend), shots,
        {"F1": F1, "F2": F2, "mode": mode, "channel": _CHANNEL[mode]}, BIT_ORDER,
        dec["metrics"], circuit_report(circuits, compiled), counts, viz=dec["viz"],
    )
