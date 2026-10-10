"""Shared test doubles."""

from __future__ import annotations

import numpy as np
from qiskit import QuantumCircuit
from qiskit.providers.basic_provider import BasicSimulator
from qiskit.quantum_info import Statevector


class Counting(BasicSimulator):
    """BasicSimulator that counts ``run`` calls in the class attribute ``runs``."""

    runs = 0

    def run(self, *a, **k):
        type(self).runs += 1
        return super().run(*a, **k)


def ionq_counting() -> "FakeIonQ":
    """A fast fake IonQ backend (also counted in ``Counting.runs``, reset to 0)."""
    Counting.runs = 0
    return FakeIonQ()


class FakeIonQ:
    """IonQ stand-in that records every ``run`` and simulates cheaply.

    A packed circuit is a tensor product of independent sub-circuits, so each
    connected group of qubits is simulated on its own with ``Statevector`` (a 40
    qubit packed circuit costs the same as its widest sub-circuit). Mimics the
    Qollab proxy: more than one circuit in a ``run`` raises, like the 400
    "Only job type ionq.circuit.v1 is supported".
    """

    name = "ionq_simulator"

    def __init__(self, num_qubits: int = 29, seed: int = 7) -> None:
        self.num_qubits = num_qubits
        self.runs: list[list] = []
        self._rng = np.random.default_rng(seed)

    def run(self, circuits, shots: int = 1000, **_: object):
        batch = list(circuits) if isinstance(circuits, (list, tuple)) else [circuits]
        self.runs.append(batch)
        Counting.runs += 1
        if len(batch) != 1:
            raise RuntimeError("IonQAPIError 400: Only job type ionq.circuit.v1 is supported")
        counts = self._simulate(batch[0], shots)

        class _Result:
            def get_counts(self_inner, *_a):
                return counts

        class _Job:
            def result(self_inner):
                return _Result()

        return _Job()

    def _simulate(self, qc, shots: int) -> dict[str, int]:
        parent = list(range(qc.num_qubits))

        def find(i: int) -> int:
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        measured: dict[int, int] = {}
        gates = []
        for inst in qc.data:
            op, qs = inst.operation, [qc.find_bit(q).index for q in inst.qubits]
            if op.name == "measure":
                measured[qs[0]] = qc.find_bit(inst.clbits[0]).index
            elif op.name != "barrier":
                gates.append((op, qs))
                for q in qs[1:]:
                    parent[find(q)] = find(qs[0])
        bits = np.zeros((shots, qc.num_clbits), dtype=np.uint8)
        groups: dict[int, list[int]] = {}
        for q in range(qc.num_qubits):
            groups.setdefault(find(q), []).append(q)
        for members in groups.values():
            local = {q: i for i, q in enumerate(members)}
            sub = QuantumCircuit(len(members))
            for op, qs in gates:
                if qs[0] in local:
                    sub.append(op, [local[q] for q in qs])
            probs = Statevector(sub).probabilities()
            outcome = self._rng.choice(len(probs), size=shots, p=probs / probs.sum())
            for q in members:
                if q in measured:
                    bits[:, measured[q]] = (outcome >> local[q]) & 1
        keys = ["".join(map(str, row[::-1])) for row in bits]  # rightmost char = clbit 0
        out: dict[str, int] = {}
        for k in keys:
            out[k] = out.get(k, 0) + 1
        return out
