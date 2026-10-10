"""Every circuit built by any build_* must measure only at the end."""

import pytest
from qiskit import QuantumCircuit
from qiskit.circuit import ControlFlowOp

from qiskit.providers.fake_provider import GenericBackendV2

from quantum import execute, links, noise, teleport

FORBIDDEN = {"reset", "initialize", "state_preparation", "if_else", "while_loop", "for_loop", "switch_case"}


def all_circuits() -> list[QuantumCircuit]:
    return [
        *links.build_link(),
        *noise.build_noise((0.95, 0.6), "teaching"),
        *noise.build_noise(mode="precision"),
        *noise.build_damping(0.3),
        *teleport.build_teleport(0.4, 1.1),
        *teleport.build_teleport(0.4, 1.1, F=0.8),
    ]


def check_measure_at_end(qc: QuantumCircuit) -> None:
    measured: set[int] = set()
    for inst in qc.data:
        op = inst.operation
        assert op.name not in FORBIDDEN and not isinstance(op, ControlFlowOp), qc.name
        assert getattr(op, "condition", None) is None, qc.name
        idx = {qc.find_bit(q).index for q in inst.qubits}
        if op.name == "barrier":
            continue
        assert not (idx & measured), f"{qc.name}: op {op.name} after measure"
        if op.name == "measure":
            measured |= idx
    assert qc.num_qubits <= 16


def test_measure_at_end_all_circuits():
    circuits = all_circuits()
    assert len(circuits) > 10
    names = [c.name for c in circuits]
    assert len(set(names)) == len(names)
    for qc in circuits:
        check_measure_at_end(qc)


def test_checker_detects_violation():
    qc = QuantumCircuit(1, 1)
    qc.measure(0, 0)
    qc.x(0)
    with pytest.raises(AssertionError):
        check_measure_at_end(qc)


def test_compiled_circuits_keep_width_and_measure_at_end():
    backend = GenericBackendV2(num_qubits=27, seed=3)
    circuits = all_circuits()
    compiled = execute.compile_for(backend, circuits, seed=1)
    for logical, qc in zip(circuits, compiled):
        assert qc.num_qubits == logical.num_qubits, qc.name
        check_measure_at_end(qc)


def test_ionq_compile_uses_basis_without_target():
    class FakeIonQ:
        name = "ionq_simulator"

    circuits = all_circuits()
    compiled = execute.compile_for(FakeIonQ(), circuits, seed=1)
    allowed = set(execute.IONQ_BASIS) | {"measure", "barrier"}
    for logical, qc in zip(circuits, compiled):
        assert qc.num_qubits == logical.num_qubits
        assert set(qc.count_ops()) <= allowed, qc.name
        check_measure_at_end(qc)
