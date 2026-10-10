"""Level 2, teleportation of one qubit over a (possibly noisy) link.

Qubits: q0 = state psi (RY(theta), RZ(phi) on |0>), A and B = Bell pair, and
optionally two environment qubits that turn the pair into Werner(F)
(see noise.py). Alice applies CX(q0, A), H(q0); everything is measured at the
END (deferred measurement, no classically controlled gates). Bob's qubit is
measured in X, Y or Z (three circuits).

The correction is a Pauli frame applied in Python: the outcome of A triggers
X and the outcome of q0 triggers Z, so Bob's Z-basis bit is flipped by m_x,
the X-basis bit by m_z and the Y-basis bit by both (m_x XOR m_z).

Bit order (Qiskit little-endian), register ``out``:
clbit 0 = Bob, clbit 1 = m_x (qubit A), clbit 2 = m_z (qubit q0).

Theory: with a Werner(F) link the output Bloch vector is (4F-1)/3 * r_psi, so
the fidelity is F_tel = (2F+1)/3, against the classical measure-and-prepare
bound 2/3.

References:
    - Bennett et al. (1993). Phys. Rev. Lett. 70:1895.
    - Knill, E. (2005). Quantum computing with realistically noisy devices.
      Nature 434:39 (Pauli-frame tracking).
    - Massar & Popescu (1995). Phys. Rev. Lett. 74:1259 (classical 2/3 bound).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister

from . import analysis as an
from .execute import circuit_report, run_batch, safe_name
from .links import rotate_to_basis
from .noise import apply_werner

BIT_ORDER = "Qiskit little-endian; clbits: 0=Bob, 1=m_x (A), 2=m_z (q0)"
CLASSICAL_BOUND = 2.0 / 3.0
_FRAME = {"Z": [1], "X": [2], "Y": [1, 2]}  # clbits XORed into Bob's bit


def bloch_vector(theta: float, phi: float) -> list[float]:
    """Bloch vector of RZ(phi) RY(theta)|0>."""
    return [
        math.sin(theta) * math.cos(phi),
        math.sin(theta) * math.sin(phi),
        math.cos(theta),
    ]


def _cname(label: str, F: float | None, basis: str) -> str:
    suffix = "" if F is None else f"_F{F:g}"
    return safe_name(f"tele_{label}{suffix}_{basis}")


def build_teleport(
    theta: float = 0.0, phi: float = 0.0, F: float | None = None, label: str = "psi"
) -> list[QuantumCircuit]:
    """Three circuits (Bob in X, Y, Z). ``F`` adds a Werner(F) noisy link.

    2-qubit gates: 2 ideal, 5 noisy (env prep 1 + CX + CZ).
    """
    circuits = []
    for basis in "XYZ":
        q0, a, b = (QuantumRegister(1, n) for n in ("q0", "A", "B"))
        regs = [q0, a, b]
        env = None
        if F is not None:
            env = QuantumRegister(2, "env")
            regs.append(env)
        out = ClassicalRegister(3, "out")
        qc = QuantumCircuit(*regs, out, name=_cname(label, F, basis))
        qc.ry(theta, q0[0])
        qc.rz(phi, q0[0])
        qc.h(a[0])
        qc.cx(a[0], b[0])
        if env is not None:
            apply_werner(qc, b[0], env[0], env[1], F)
        qc.cx(q0[0], a[0])
        qc.h(q0[0])
        rotate_to_basis(qc, b[0], basis)
        qc.measure(b[0], out[0])
        qc.measure(a[0], out[1])
        qc.measure(q0[0], out[2])
        circuits.append(qc)
    return circuits


def theory_teleport(F: float | None = None) -> dict[str, float]:
    """Theoretical teleportation fidelity (1 for a perfect link)."""
    f = 1.0 if F is None else (2.0 * F + 1.0) / 3.0
    return {"F_tel": f, "classical_bound": CLASSICAL_BOUND}


def decode_teleport(
    counts_by_id: dict[str, dict[str, int]],
    theta: float = 0.0,
    phi: float = 0.0,
    F: float | None = None,
    label: str = "psi",
    seed: int = 0,
) -> dict[str, Any]:
    """Bob's Bloch vector (Pauli-frame corrected), fidelity with CI, viz."""
    cs = {p: counts_by_id[_cname(label, F, p)] for p in "XYZ"}
    comps = {p: an.correlator(cs[p], [0], flips=_FRAME[p]) for p in "XYZ"}
    r_in = bloch_vector(theta, phi)
    scale = 1.0 if F is None else (4.0 * F - 1.0) / 3.0
    r_th = [scale * v for v in r_in]
    raw = 0.5 * (1.0 + sum(c["value"] * r for c, r in zip(comps.values(), r_in)))
    var = sum(r * r * c["var"] for c, r in zip(comps.values(), r_in)) / 4.0
    half = 1.96 * math.sqrt(var)
    clip = lambda x: min(1.0, max(0.0, x))  # noqa: E731
    th = theory_teleport(F)
    metrics = {
        f"bob_{p}": an.metric(c["value"], c["ci95"], t)
        for (p, c), t in zip(comps.items(), r_th)
    }
    metrics["fidelity"] = an.metric(
        clip(raw), [clip(raw - half), clip(raw + half)], th["F_tel"],
        raw=raw, classical_bound=th["classical_bound"],
    )
    viz = {
        "samples": an.sample_parity(cs["Z"], [0], flips=_FRAME["Z"], seed=seed),
        "bloch": {
            "measured": [comps[p]["value"] for p in "XYZ"],
            "ci95": [comps[p]["ci95"] for p in "XYZ"],
            "theory": r_th,
            "input": r_in,
        },
        "leak": 0.0 if F is None else 1.0 - F,
    }
    return {"metrics": metrics, "viz": viz}


def run_teleport(
    backend: Any,
    shots: int = 1000,
    theta: float = 0.0,
    phi: float = 0.0,
    F: float | None = None,
    seed: int = 0,
    **run_options: Any,
) -> dict[str, Any]:
    """Run level 2 with a single ``backend.run``; returns the JSON contract."""
    circuits = build_teleport(theta, phi, F)
    counts, compiled = run_batch(backend, circuits, shots, **run_options)
    dec = decode_teleport(counts, theta, phi, F, seed=seed)
    dec["viz"]["steps"] = {qc.name: an.circuit_steps(qc) for qc in circuits}
    return an.make_result(
        "teleport", "live", an.backend_name(backend), shots,
        {"theta": theta, "phi": phi, "F": F}, BIT_ORDER, dec["metrics"],
        circuit_report(circuits, compiled), counts, viz=dec["viz"],
    )
