"""Pack several circuits side by side into ONE circuit (one IonQ job = one circuit).

Qollab's IonQ proxy only accepts single-circuit jobs (``ionq.circuit.v1``):
``qiskit_ionq`` emits ``ionq.multi-circuit.v1`` for a list of more than one
circuit, and the proxy answers ``400 Only job type ionq.circuit.v1 is
supported``. The workaround is to place the (already compiled) circuits on
DISJOINT qubits of a single wide circuit with one shared classical register and
to split the counts back in Python.

Layout and bit order. Sub-circuit ``k`` owns qubits ``[q_k, q_k + n_k)`` and
classical bits ``[c_k, c_k + m_k)`` of the packed register ``m`` (offsets are
cumulative, in the order given). Qiskit is little-endian: in a packed counts key
the rightmost character is clbit 0, so sub-circuit ``k`` is the slice of
characters ``[-(c_k + m_k) : len - c_k]`` and, once sliced, its own clbit ``j``
is again its rightmost-j-th character (the same order it has when run alone).

Because the sub-circuits never share a qubit, the packed circuit prepares the
tensor product of the individual states: each sub-circuit's counts are an
unbiased sample of what it would give alone. The shots of all sub-circuits are
the same shots (same job). Packing preserves the measure-at-end rule (no reset,
no conditionals, nothing after a measurement). On an ideal device the
distributions are identical; on real hardware crosstalk between neighbours can
differ from running them alone.

References:
    - Qollab compute backends (IonQ, one job per run):
      https://qollab.xyz/learn/docs/compute-backends
"""

from __future__ import annotations

from typing import Any, NamedTuple, Sequence

from qiskit import ClassicalRegister, QuantumCircuit

Counts = dict[str, int]
PACKED_NAME = "packed"
PACKED_REGISTER = "m"


class Slot(NamedTuple):
    """Where one sub-circuit lives in the packed circuit."""

    name: str
    qubit_offset: int
    qubits: int
    clbit_offset: int
    clbits: int


class DoesNotFit(ValueError):
    """The packed circuit would be wider than the backend allows."""

    def __init__(self, needed: int, cap: int, hint: str = "") -> None:
        self.needed, self.cap = needed, cap
        msg = f"needs {needed} qubits in one IonQ circuit but the backend allows {cap}"
        super().__init__(f"{msg}; {hint}" if hint else msg)


def pack_circuits(circuits: Sequence[QuantumCircuit]) -> tuple[QuantumCircuit, list[Slot]]:
    """Place ``circuits`` on disjoint qubits of one circuit with one shared register.

    Returns ``(packed, layout)``; ``layout[k]`` is the ``Slot`` of ``circuits[k]``.
    Names must be unique. Each sub-circuit may have any number of classical
    registers; their bits are concatenated in order.
    """
    names = [c.name for c in circuits]
    if not circuits:
        raise ValueError("nothing to pack")
    if len(set(names)) != len(names):
        raise ValueError("circuit names must be unique")
    nq = sum(c.num_qubits for c in circuits)
    nc = sum(c.num_clbits for c in circuits)
    packed = QuantumCircuit(nq, name=PACKED_NAME)
    packed.add_register(ClassicalRegister(nc, PACKED_REGISTER))
    layout: list[Slot] = []
    q0 = c0 = 0
    for c in circuits:
        packed.compose(
            c, qubits=range(q0, q0 + c.num_qubits), clbits=range(c0, c0 + c.num_clbits),
            inplace=True,
        )
        layout.append(Slot(c.name, q0, c.num_qubits, c0, c.num_clbits))
        q0, c0 = q0 + c.num_qubits, c0 + c.num_clbits
    return packed, layout


def unpack_counts(counts: dict[str, int], layout: Sequence[Slot]) -> dict[str, Counts]:
    """Split packed counts into per-sub-circuit counts (Qiskit little-endian keys).

    Spaces in keys are ignored; keys shorter than the register are left-padded
    with zeros. Each sub-circuit's counts sum to the total number of shots.
    """
    total = max((s.clbit_offset + s.clbits for s in layout), default=0)
    out: dict[str, Counts] = {s.name: {} for s in layout}
    for key, value in counts.items():
        bits = str(key).replace(" ", "").zfill(total)
        if len(bits) != total:
            raise ValueError(f"counts key {key!r} has {len(bits)} bits, expected {total}")
        for s in layout:
            lo, hi = s.clbit_offset, s.clbit_offset + s.clbits
            sub = bits[len(bits) - hi:len(bits) - lo]
            out[s.name][sub] = out[s.name].get(sub, 0) + int(value)
    return out


def layout_plain(layout: Sequence[Slot]) -> list[dict[str, Any]]:
    """JSON-friendly layout (what the result reports under ``packed.layout``)."""
    return [s._asdict() for s in layout]


def describe_layout(layout: Sequence[Slot]) -> str:
    """One line documenting the packed bit order, for the result's ``bit_order``."""
    parts = ", ".join(
        f"{s.name}: qubits {s.qubit_offset}-{s.qubit_offset + s.qubits - 1}, "
        f"clbits {s.clbit_offset}-{s.clbit_offset + s.clbits - 1}" for s in layout
    )
    return ("PACKED into one circuit (one IonQ job), register m, Qiskit little-endian "
            f"(rightmost character = clbit 0); counts are split back per sub-circuit [{parts}]")
