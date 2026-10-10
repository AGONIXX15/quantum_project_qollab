"""Single-job circuit execution shared by all levels.

The backend is always an argument (Qollab creates it). All circuits go out in
ONE ``backend.run`` call, which is mandatory on IonQ (one job per execution).

Compilation (``compile_for``):
    - IonQ (all-to-all): transpile to a small basis, no coupling map and no
      backend target; if that fails, the untranspiled circuits are sent.
    - Other backends: transpile against the backend with each circuit pinned
      to qubits 0..n-1 (``initial_layout``), then drop idle qubits when the
      circuit stayed inside that range, so a 4-qubit circuit does not become a
      27- or 120-qubit simulation. On failure, fall back to a basis-only
      transpile.

References:
    - Qollab compute backends: https://qollab.xyz/learn/docs/compute-backends
    - Qiskit transpile: https://quantum.cloud.ibm.com/docs/api/qiskit/transpiler
"""

from __future__ import annotations

import re
from typing import Any, Callable

from qiskit import QuantumCircuit, transpile
from qiskit.transpiler.passes import RemoveBarriers

from . import analysis as an

Counts = dict[str, int]

IONQ_BASIS = ["h", "x", "y", "z", "s", "sdg", "rx", "ry", "rz", "cx"]
_NOT_GATES = {
    "measure", "reset", "delay", "barrier", "if_else", "while_loop", "for_loop",
    "switch_case", "break_loop", "continue_loop",
}


def safe_name(name: str) -> str:
    """Circuit-name sanitizer: only [A-Za-z0-9_-]; '.' becomes 'p' (F0.8 -> F0p8)."""
    return re.sub(r"[^A-Za-z0-9_-]", "_", name.replace(".", "p"))


def _trim(qc: QuantumCircuit, n: int) -> QuantumCircuit:
    """Drop idle qubits >= n if no instruction touches them; else return ``qc``."""
    if qc.num_qubits <= n:
        return qc
    if any(qc.find_bit(q).index >= n for inst in qc.data for q in inst.qubits):
        return qc
    out = QuantumCircuit(n, name=qc.name, metadata=qc.metadata)
    for creg in qc.cregs:
        out.add_register(creg)
    for inst in qc.data:
        out.append(
            inst.operation,
            [qc.find_bit(q).index for q in inst.qubits],
            list(inst.clbits),
        )
    return out


def _basis_of(backend: Any) -> list[str]:
    names = getattr(backend, "operation_names", None)
    if not names:
        return list(IONQ_BASIS)
    return [g for g in names if g not in _NOT_GATES]


def compile_for(
    backend: Any, circuits: list[QuantumCircuit], seed: int = 1234
) -> list[QuantumCircuit]:
    """Compile ``circuits`` for ``backend`` keeping each at its logical width."""
    if an.is_ionq(backend):
        # Barriers only mark the channel point for the Python decoder.
        stripped = [RemoveBarriers()(qc) for qc in circuits]
        try:
            return transpile(
                stripped, basis_gates=IONQ_BASIS, optimization_level=1,
                seed_transpiler=seed,
            )
        except Exception:  # noqa: BLE001 - fall back to the logical circuits
            return stripped
    out = []
    for qc in circuits:
        n = qc.num_qubits
        try:
            t = transpile(
                qc, backend=backend, optimization_level=1, seed_transpiler=seed,
                initial_layout=list(range(n)),
            )
            out.append(_trim(t, n))
        except Exception:  # noqa: BLE001
            out.append(
                transpile(
                    qc, basis_gates=_basis_of(backend), optimization_level=1,
                    seed_transpiler=seed,
                )
            )
    return out


def run_batch(
    backend: Any,
    circuits: list[QuantumCircuit],
    shots: int = 1000,
    seed: int = 1234,
    before_run: Callable[[], None] | None = None,
    **run_options: Any,
) -> tuple[dict[str, Counts], dict[str, dict[str, int]]]:
    """Compile and run every circuit in a single ``backend.run``.

    Returns ``(counts, compiled)`` keyed by ``circuit.name`` (unique, only
    [A-Za-z0-9_-]). ``compiled[name]`` has ``compiled_two_qubit_gates`` and
    ``compiled_depth``. ``seed`` seeds the transpiler; ``before_run`` is called right before ``backend.run``; ``run_options`` (e.g.
    ``seed_simulator``) are forwarded to ``run`` untouched.
    """
    names = [qc.name for qc in circuits]
    if len(set(names)) != len(names):
        raise ValueError("circuit names must be unique")
    for qc in circuits:
        if not re.fullmatch(r"[A-Za-z0-9_-]+", qc.name):
            raise ValueError(f"unsafe circuit name {qc.name!r}")
        # Invariant: ONE classical register per circuit, so counts keys never
        # contain spaces and clbit i is always character -1-i of the key.
        assert len(qc.cregs) == 1, f"{qc.name}: expected a single classical register"
    compiled = compile_for(backend, circuits, seed)
    if before_run is not None:
        before_run()  # called after compilation, immediately before the (single) submit
    result = backend.run(compiled, shots=shots, **run_options).result()
    counts = {name: dict(result.get_counts(i)) for i, name in enumerate(names)}
    info = {}
    for name, c in zip(names, compiled):
        ci = an.circuit_info(c)
        info[name] = {
            "compiled_two_qubit_gates": ci["two_qubit_gates"],
            "compiled_depth": ci["depth"],
        }
    return counts, info


def circuit_report(
    circuits: list[QuantumCircuit], compiled: dict[str, dict[str, int]]
) -> list[dict[str, Any]]:
    """``circuits[]`` entries: logical info plus compiled 2q count and depth."""
    return [{**an.circuit_info(qc), **compiled.get(qc.name, {})} for qc in circuits]
