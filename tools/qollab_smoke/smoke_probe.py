"""Throwaway IonQ submit probe for the smoke harness (never part of the final upload).

``ionq_probe(backend, n)`` sends ONE job and reports exactly what happened:
``n == 0`` sends a single raw Bell circuit (no project code involved);
``n > 0`` sends the first ``n`` circuits of the project's full batch, compiled
the same way as ``quantum.execute``.
"""

from __future__ import annotations

import time
import traceback
from typing import Any


def _info(backend: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"name": getattr(backend, "name", "?"), "module": type(backend).__module__}
    try:
        import qiskit_ionq
        out["qiskit_ionq"] = getattr(qiskit_ionq, "__version__", "?")
    except Exception as exc:  # noqa: BLE001
        out["qiskit_ionq"] = f"import failed: {exc!r}"
    try:
        out["options"] = {k: repr(v)[:80] for k, v in dict(backend.options.__dict__).items()}
    except Exception as exc:  # noqa: BLE001
        out["options"] = repr(exc)
    return out


def ionq_probe(backend: Any, n: int = 0, shots: int = 100) -> dict[str, Any]:
    """Send ONE job (see module docstring) and return a diagnostic dict."""
    from qiskit import QuantumCircuit

    n, shots = int(n), int(shots)
    out: dict[str, Any] = {"ok": False, "n": n, "shots": shots, "backend": _info(backend)}
    t0 = time.time()
    stage = "build"
    try:
        if n == 0:
            qc = QuantumCircuit(2, 2, name="probe_bell")
            qc.h(0)
            qc.cx(0, 1)
            qc.measure([0, 1], [0, 1])
            circuits = [qc]
        else:
            from quantum import batch, execute
            qcs, _ = batch.build_full_batch()
            circuits = execute.compile_for(backend, qcs[:n])
        out["circuits"] = len(circuits)
        try:
            from qiskit_ionq.helpers import qiskit_to_ionq
            out["payload_bytes"] = len(qiskit_to_ionq(circuits, backend, passed_args={"shots": shots}))
        except Exception as exc:  # noqa: BLE001 - size is informative only
            out["payload_bytes"] = f"unknown: {exc!r}"
        stage = "submit"
        job = backend.run(circuits if len(circuits) > 1 else circuits[0], shots=shots)
        out["job_id"] = str(getattr(job, "job_id", lambda: "?")())
        stage = "result"
        res = job.result()
        out["counts_first"] = dict(res.get_counts(0) if len(circuits) > 1 else res.get_counts())
        out["ok"] = True
    except BaseException as exc:  # noqa: BLE001 - report everything
        out["stage"] = stage
        out["error_type"] = f"{type(exc).__module__}.{type(exc).__name__}"
        out["error"] = repr(exc)[:600]
        out["cause"] = repr(exc.__cause__ or exc.__context__)[:600]
        out["traceback"] = traceback.format_exc()[-2500:]
    out["elapsed_s"] = round(time.time() - t0, 3)
    return out


# --- Packing probe: Qollab's IonQ proxy accepts only ionq.circuit.v1 (ONE circuit per job). ---
# Several compiled circuits are placed side by side on disjoint qubits, with one shared
# classical register; sub-circuit k owns clbits [off_k, off_k + n_k). Counts are split back
# per sub-circuit in Python (Qiskit little-endian: rightmost character = clbit 0).

PACK_GROUPS = {"link_readout": ("link_", "readout_"), "teleport": ("tele_",), "qkd": ("qkd_",)}


def pack(circuits: list[Any]) -> tuple[Any, list[tuple[str, int, int]]]:
    """Return (packed circuit, [(name, clbit offset, clbit count), ...])."""
    from qiskit import ClassicalRegister, QuantumCircuit

    nq = sum(c.num_qubits for c in circuits)
    nc = sum(c.num_clbits for c in circuits)
    big = QuantumCircuit(nq, name="packed")
    creg = ClassicalRegister(nc, "m")
    big.add_register(creg)
    layout, q0, c0 = [], 0, 0
    for c in circuits:
        big.compose(c, qubits=range(q0, q0 + c.num_qubits), clbits=range(c0, c0 + c.num_clbits), inplace=True)
        layout.append((c.name, c0, c.num_clbits))
        q0, c0 = q0 + c.num_qubits, c0 + c.num_clbits
    return big, layout


def unpack(counts: dict[str, int], layout: list[tuple[str, int, int]]) -> dict[str, dict[str, int]]:
    """Split packed counts into per-circuit counts (keys keep Qiskit bit order)."""
    out: dict[str, dict[str, int]] = {name: {} for name, _, _ in layout}
    for key, v in counts.items():
        bits = key.replace(" ", "")[::-1]  # bits[i] = clbit i
        for name, off, n in layout:
            sub = bits[off:off + n][::-1]
            out[name][sub] = out[name].get(sub, 0) + int(v)
    return out


def ionq_pack_probe(backend: Any, group: str = "link_readout", shots: int = 100) -> dict[str, Any]:
    """Send ONE packed circuit (one level) as a single ionq.circuit.v1 job."""
    shots = int(shots)
    out: dict[str, Any] = {"ok": False, "group": group, "shots": shots, "backend": getattr(backend, "name", "?")}
    t0 = time.time()
    stage = "build"
    try:
        from quantum import batch, execute
        qcs, _ = batch.build_full_batch()
        sel = [q for q in qcs if q.name.startswith(PACK_GROUPS[group])]
        compiled = execute.compile_for(backend, sel)
        big, layout = pack(compiled)
        out.update(qubits=big.num_qubits, clbits=big.num_clbits, subcircuits=[n for n, _, _ in layout],
                   two_qubit_gates=sum(v for k, v in big.count_ops().items() if k in ("cx", "cz", "ms", "zz")))
        stage = "submit"
        job = backend.run(big, shots=shots)
        out["job_id"] = str(job.job_id())
        stage = "result"
        counts = dict(job.result().get_counts())
        out["result_s"] = round(time.time() - t0, 3)
        out["per_circuit"] = unpack(counts, layout)
        out["ok"] = True
    except BaseException as exc:  # noqa: BLE001 - report everything
        out["stage"] = stage
        out["error_type"] = f"{type(exc).__module__}.{type(exc).__name__}"
        out["error"] = repr(exc)[:600]
        out["traceback"] = traceback.format_exc()[-1500:]
    out["elapsed_s"] = round(time.time() - t0, 3)
    return out
