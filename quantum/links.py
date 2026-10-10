"""Level 1, first link: a Bell pair measured in the X, Y and Z bases.

Circuit: H(A), CX(A, B) prepares |Phi+>. Three circuits measure the
correlators <XX>, <YY>, <ZZ>; the ideal values are +1, -1, +1 and the
fidelity F = (1 + <XX> - <YY> + <ZZ>) / 4 equals 1.

Bit order (Qiskit little-endian), register ``m``: clbit 0 = A, clbit 1 = B,
so the rightmost character of a counts key is A. Measurements are last.

References:
    - Bennett, Brassard, Crepeau, Jozsa, Peres, Wootters (1993). Phys. Rev.
      Lett. 70:1895.
    - Nielsen & Chuang, Quantum Computation and Quantum Information, 1.3.6.
    - Bennett et al. (1996). Phys. Rev. A 54:3824 (fidelity from correlators).
"""

from __future__ import annotations

from typing import Any

from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister

from . import analysis as an
from .execute import circuit_report, run_batch

BASES = ("XX", "YY", "ZZ")
BIT_ORDER = "Qiskit little-endian; clbits: 0=A, 1=B"


def rotate_to_basis(qc: QuantumCircuit, qubit: Any, basis: str) -> None:
    """Rotate so a Z-basis measurement reads Pauli ``basis`` (X: H; Y: Sdg, H)."""
    if basis == "X":
        qc.h(qubit)
    elif basis == "Y":
        qc.sdg(qubit)
        qc.h(qubit)
    elif basis != "Z":
        raise ValueError(f"unknown basis {basis!r}")


def build_link(prefix: str = "link") -> list[QuantumCircuit]:
    """Return the XX, YY, ZZ circuits named ``{prefix}_XX`` etc. (1 CX each)."""
    circuits = []
    for pair in BASES:
        a, b = QuantumRegister(1, "A"), QuantumRegister(1, "B")
        m = ClassicalRegister(2, "m")
        qc = QuantumCircuit(a, b, m, name=f"{prefix}_{pair}")
        qc.h(a[0])
        qc.cx(a[0], b[0])
        rotate_to_basis(qc, a[0], pair[0])
        rotate_to_basis(qc, b[0], pair[1])
        qc.measure(a[0], m[0])
        qc.measure(b[0], m[1])
        circuits.append(qc)
    return circuits


def theory_link() -> dict[str, float]:
    """Ideal Bell-pair values."""
    return {"XX": 1.0, "YY": -1.0, "ZZ": 1.0, "F": 1.0}


def marginal_bloch(counts_by_basis: dict[str, dict[str, int]], clbit: int) -> dict[str, Any]:
    """Single-qubit Bloch vector of one clbit, free from the XX/YY/ZZ counts.

    ``counts_by_basis`` maps "X"/"Y"/"Z" to the counts of the circuit that
    measures that qubit in that basis.
    """
    comps = [an.correlator(counts_by_basis[p], [clbit]) for p in "XYZ"]
    return {
        "value": [c["value"] for c in comps],
        "ci95": [c["ci95"] for c in comps],
    }


def decode_link(counts_by_id: dict[str, dict[str, int]], prefix: str = "link", seed: int = 0) -> dict[str, Any]:
    """Compute correlators, fidelity (with CI) and the viz payload."""
    corr = {p: an.correlator(counts_by_id[f"{prefix}_{p}"], [0, 1]) for p in BASES}
    fid = an.bell_fidelity(corr["XX"], corr["YY"], corr["ZZ"])
    th = theory_link()
    metrics = {
        f"corr_{p}": an.metric(c["value"], c["ci95"], th[p], shots=c["shots"])
        for p, c in corr.items()
    }
    metrics["fidelity"] = an.metric(fid["value"], fid["ci95"], th["F"], raw=fid["raw"])
    # Circuit {p}{p} measures both qubits in basis p, so it also gives each
    # qubit's single-basis marginal.
    marginal_counts = {p: counts_by_id[f"{prefix}_{p}{p}"] for p in "XYZ"}
    viz = {
        "samples": an.sample_parity(counts_by_id[f"{prefix}_ZZ"], [0, 1], seed=seed),
        "bloch": {
            "A": marginal_bloch(marginal_counts, 0),
            "B": marginal_bloch(marginal_counts, 1),
            # Each half of Phi+ is maximally mixed, so the marginal Bloch
            # vector is zero (holds for the ideal Bell pair only).
            "theory": [0.0, 0.0, 0.0],
        },
        "leak": 0.0,
    }
    return {"metrics": metrics, "viz": viz}


def run_link(backend: Any, shots: int = 1000, seed: int = 0, **run_options: Any) -> dict[str, Any]:
    """Run level 1 with a single ``backend.run`` and return the JSON contract."""
    circuits = build_link()
    counts, compiled = run_batch(backend, circuits, shots, **run_options)
    dec = decode_link(counts, seed=seed)
    dec["viz"]["steps"] = {qc.name: an.circuit_steps(qc) for qc in circuits}
    return an.make_result(
        "link", "live", an.backend_name(backend), shots, {}, BIT_ORDER,
        dec["metrics"], circuit_report(circuits, compiled), counts, viz=dec["viz"],
    )
