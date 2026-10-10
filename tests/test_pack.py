"""Packing several circuits into one (Qollab's IonQ proxy takes single-circuit jobs only)."""

from __future__ import annotations

import json

import pytest
from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister
from qiskit.providers.basic_provider import BasicSimulator

from quantum import api, batch, execute, links, pack
from tests.helpers import FakeIonQ
from tests.test_measure_at_end import check_measure_at_end


def _circ(name: str, nq: int, nc: int) -> QuantumCircuit:
    qc = QuantumCircuit(QuantumRegister(nq, "q"), ClassicalRegister(nc, "c"), name=name)
    return qc


def test_pack_layout_and_unpack_hand_made_bitstrings():
    a, b, c = _circ("a", 2, 2), _circ("b", 3, 3), _circ("c", 1, 1)
    big, layout = pack.pack_circuits([a, b, c])
    assert big.num_qubits == 6 and big.num_clbits == 6
    assert [(s.name, s.qubit_offset, s.clbit_offset, s.clbits) for s in layout] == [
        ("a", 0, 0, 2), ("b", 2, 2, 3), ("c", 5, 5, 1)]
    # the key lists clbit 5 first and clbit 0 last (little-endian)
    clbits = {0: 1, 1: 0, 2: 1, 3: 1, 4: 0, 5: 1}
    key = "".join(str(clbits[i]) for i in range(5, -1, -1))
    out = pack.unpack_counts({key: 7, "000000": 3}, layout)
    assert out["a"] == {"01": 7, "00": 3}  # a's clbit1 = 0, clbit0 = 1 -> "01"
    assert out["b"] == {"011": 7, "000": 3}  # clbits 2,3,4 = 1,1,0 -> "011"
    assert out["c"] == {"1": 7, "0": 3}
    for counts in out.values():
        assert sum(counts.values()) == 10


def test_unpack_ignores_spaces_pads_and_rejects_bad_keys():
    _, layout = pack.pack_circuits([_circ("a", 1, 1), _circ("b", 1, 1)])
    assert pack.unpack_counts({"1 0": 4, "1": 2}, layout) == {"a": {"0": 4, "1": 2}, "b": {"1": 4, "0": 2}}
    with pytest.raises(ValueError):
        pack.unpack_counts({"1010": 1}, layout)
    with pytest.raises(ValueError):
        pack.pack_circuits([_circ("a", 1, 1), _circ("a", 1, 1)])
    with pytest.raises(ValueError):
        pack.pack_circuits([])


def test_packed_circuit_keeps_measure_at_end_and_describes_bit_order():
    circuits = batch.level_circuits("link", batch.resolve_params(None)[1]) + batch.build_readout()
    compiled = execute.compile_for(FakeIonQ(), circuits)
    big, layout = pack.pack_circuits(compiled)
    check_measure_at_end(big, max_qubits=big.num_qubits)
    assert big.num_qubits == 14 and big.num_clbits == 14
    text = pack.describe_layout(layout)
    assert "rightmost character = clbit 0" in text and "link_XX" in text


def _tvd(p: dict[str, int], q: dict[str, int]) -> float:
    n, m = sum(p.values()), sum(q.values())
    return 0.5 * sum(abs(p.get(k, 0) / n - q.get(k, 0) / m) for k in set(p) | set(q))


def test_packed_matches_separate_runs_on_link_plus_readout():
    # 6 + 4 qubits: the link circuits and one readout circuit, small enough for BasicSimulator
    circuits = links.build_link() + batch.build_readout()[1:]
    be, shots = BasicSimulator(), 4000
    separate, _ = execute.run_batch(be, circuits, shots, seed_simulator=3)
    packed_counts, _, info = execute.run_packed(be, circuits, shots, seed_simulator=4)
    assert info["circuit"]["qubits"] == 10 and info["circuit"]["id"] == "packed"
    for qc in circuits:
        assert sum(packed_counts[qc.name].values()) == shots
        assert _tvd(separate[qc.name], packed_counts[qc.name]) < 0.06, qc.name
    assert packed_counts["readout_1111"] == {"1111": shots}


def test_run_packed_refuses_wide_circuits_before_submitting():
    be = FakeIonQ(num_qubits=5)
    with pytest.raises(pack.DoesNotFit) as exc:
        execute.run_packed(be, links.build_link(), 100)
    assert exc.value.needed == 6 and exc.value.cap == 5 and not be.runs


def test_ionq_max_qubits():
    assert execute.ionq_max_qubits(FakeIonQ(29)) == 29
    assert execute.ionq_max_qubits(object()) == execute.IONQ_DEFAULT_QUBITS


@pytest.mark.parametrize("level", api.RUN_LEVELS)
def test_default_levels_send_one_ionq_circuit_v1_within_the_cap(level):
    from qiskit_ionq import IonQProvider
    from qiskit_ionq.helpers import qiskit_to_ionq

    real = IonQProvider(token="x").get_backend("simulator")  # offline: only builds the payload
    cap = real.num_qubits
    fake = FakeIonQ(num_qubits=cap)
    api._reset_ionq_state()
    out = api.run_level(fake, level, shots=100)
    assert out["ok"], out.get("error")
    assert len(fake.runs) == 1 and len(fake.runs[0]) == 1
    circuit = fake.runs[0][0]
    payload = json.loads(qiskit_to_ionq(circuit, real, {"shots": 100}))
    assert payload["type"] == "ionq.circuit.v1"
    assert payload["input"]["qubits"] <= cap and circuit.num_qubits <= cap
    assert out["circuits"][-1]["qubits"] == circuit.num_qubits


def test_default_packed_qubit_counts_are_stable():
    ip = batch.resolve_params(None)[1]
    got = {lv: sum(c.num_qubits for c in batch.plan_packed(lv, ip, 29)[0]) for lv in batch.DECODED_LEVELS}
    assert got == {"link": 14, "teleport": 15, "noise": 14, "swap": 12, "purify": 27, "qkd": 18, "rescue": 18}
    wide = {lv: sum(c.num_qubits for c in batch.plan_packed(lv, ip, 36)[0]) for lv in ("purify", "rescue")}
    assert wide == {"purify": 27, "rescue": 30}


def test_plan_raises_when_nothing_fits():
    ip = batch.resolve_params(None)[1]
    with pytest.raises(pack.DoesNotFit):
        batch.plan_packed("purify", ip, 25)
    with pytest.raises(pack.DoesNotFit):
        batch.plan_packed("qkd", ip, 10)
