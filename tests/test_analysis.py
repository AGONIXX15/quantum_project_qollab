"""Unit tests for quantum.analysis with hand-made counts."""

import json

import numpy as np
from qiskit import ClassicalRegister, QuantumRegister
from qiskit.providers.basic_provider import BasicSimulator
import pytest
from qiskit import QuantumCircuit

from quantum import analysis as an


def test_bit_order_little_endian():
    bits, w = an.bits_from_counts({"01": 5}, 2)
    assert bits[0, 0] == 1 and bits[0, 1] == 0 and w[0] == 5


def test_bits_spaces_and_hex():
    bits, _ = an.bits_from_counts({"1 01": 1, "0x3": 1}, 3)
    assert bits[0].tolist() == [1, 0, 1]
    assert bits[1].tolist() == [1, 1, 0]


def test_parity():
    bits, _ = an.bits_from_counts({"011": 1, "101": 1}, 3)
    assert an.parity(bits, [0, 1]).tolist() == [0, 1]
    assert an.parity(bits, []).tolist() == [0, 0]


def test_correlator_correlated_and_anti():
    c = an.correlator({"00": 500, "11": 500}, [0, 1])
    assert c["value"] == 1.0 and c["var"] == 0.0 and c["shots"] == 1000
    a = an.correlator({"01": 300, "10": 700}, [0, 1])
    assert a["value"] == -1.0
    assert a["ci95"][1] < -0.98


def test_correlator_variance():
    c = an.correlator({"00": 750, "01": 250}, [0])
    assert c["value"] == pytest.approx(0.5)
    assert c["var"] == pytest.approx(4 * 0.25 * 0.75 / 1000)
    assert c["ci95"][0] < 0.5 < c["ci95"][1]


def test_flips_xor():
    counts = {"00": 10, "01": 10}  # clbit0 random, clbit1 = 0
    assert an.correlator({"11": 10, "00": 10}, [0], flips=[1])["value"] == 1.0
    assert an.correlator({"10": 10}, [0], flips=[1])["value"] == -1.0
    assert an.correlator(counts, [0], flips=[1])["value"] == 0.0


def test_postselection():
    counts = {"00": 40, "11": 40, "01": 20}
    c = an.correlator(counts, [0], postselect=[(0, 1)])
    assert c["accepted"] == 80 and c["total"] == 100
    assert c["p_s"] == pytest.approx(0.8)
    assert c["p_s_ci95"][0] < 0.8 < c["p_s_ci95"][1]
    assert c["shots"] == 80


def test_wilson_bounds():
    lo, hi = an.wilson(0, 100)
    assert lo == 0.0 and 0 < hi < 0.05
    lo, hi = an.wilson(50, 100)
    assert lo < 0.5 < hi and 0 <= lo and hi <= 1
    assert an.wilson(0, 0) == (0.0, 1.0)
    lo, hi = an.normal_ci(0.5, 100)
    assert lo == pytest.approx(0.5 - 1.96 * 0.05)


def test_bell_fidelity_ideal():
    p = lambda v: {"value": v, "var": 0.0}  # noqa: E731
    f = an.bell_fidelity(p(1.0), p(-1.0), p(1.0))
    assert f["value"] == 1.0 and f["ci95"] == [1.0, 1.0]
    over = an.bell_fidelity(p(1.1), p(-1.0), p(1.0))
    assert over["value"] == 1.0 and over["raw"] > 1.0


def test_bell_fidelity_from_counts():
    xx = an.correlator({"00": 500, "11": 500}, [0, 1])
    yy = an.correlator({"01": 500, "10": 500}, [0, 1])
    zz = an.correlator({"00": 500, "11": 500}, [0, 1])
    assert an.bell_fidelity(xx, yy, zz)["value"] == 1.0


def test_bell_diagonal_sums_to_one():
    p = lambda v: {"value": v, "var": 0.0}  # noqa: E731
    d = an.bell_diagonal(p(0.6), p(-0.3), p(0.5))
    assert sum(d) == pytest.approx(1.0)
    assert an.bell_diagonal(p(1), p(-1), p(1)) == (1.0, 0.0, 0.0, 0.0)


def test_entropy_and_key_rates():
    assert an.binary_entropy(0) == 0 and an.binary_entropy(1) == 0
    assert an.binary_entropy(0.5) == pytest.approx(1.0)
    assert an.key_rate_bb84(0.0) == 1.0
    assert an.key_rate_bb84(0.11) == pytest.approx(0.0, abs=0.01)
    assert an.key_rate_bb84(0.25) == 0.0
    assert an.key_rate_per_basis(0.0, 0.0) == 1.0
    assert an.key_rate_per_basis(0.0, 0.25) == pytest.approx(1 - an.binary_entropy(0.25))
    assert an.key_rate_per_basis(0.11, 0.11) == pytest.approx(0.0, abs=0.01)
    assert an.key_rate_per_basis(0.05, 0.05) == pytest.approx(an.key_rate_bb84(0.05))


def test_make_result_json_with_numpy():
    m = an.metric(np.float64(0.9), np.array([0.8, 1.0]), theory=np.float32(1.0))
    r = an.make_result(
        "link", "live", "basic_simulator", np.int64(1000), {"F": np.float64(0.9)},
        "Qiskit little-endian", {"fidelity": m},
        [{"id": "x", "qubits": np.int64(2), "depth": 2, "two_qubit_gates": 1}],
        {"x": {"00": np.int64(5)}},
        viz={"v": np.arange(3)},
        timestamp="2026-10-10T12:00:00+00:00",
    )
    s = json.dumps(r)
    back = json.loads(s)
    assert back["level"] == "link" and back["shots"] == 1000
    assert back["timestamp"] == "2026-10-10T12:00:00+00:00"
    assert back["viz"]["v"] == [0, 1, 2]


def test_circuit_info():
    qc = QuantumCircuit(3, 2, name="t")
    qc.h(0)
    qc.cx(0, 1)
    qc.cx(1, 2)
    qc.barrier()
    qc.measure([0, 1], [0, 1])
    info = an.circuit_info(qc)
    assert info == {"id": "t", "qubits": 3, "depth": qc.depth(), "two_qubit_gates": 2}


def test_is_ionq_and_name():
    class Fake:
        name = "ionq_simulator"

    class Other:
        def name(self):
            return "basic_simulator"

    assert an.is_ionq(Fake()) and not an.is_ionq(Other())
    assert an.backend_name(Fake()) == "ionq_simulator"
    assert an.backend_name(Other()) == "basic_simulator"


def test_make_result_default_timestamp():
    r = an.make_result("l", "live", "b", 1, {}, "o", {}, [], {})
    assert r["timestamp"].endswith("+00:00") and "viz" not in r


def test_bell_fidelity_ci_nondegenerate_at_edge():
    xx = an.correlator({"00": 20}, [0, 1])
    yy = an.correlator({"01": 20}, [0, 1])
    zz = an.correlator({"00": 20}, [0, 1])
    assert xx["var"] == 0.0
    f = an.bell_fidelity(xx, yy, zz)
    assert f["value"] == 1.0
    assert f["ci95"][0] < 0.99 and f["ci95"][1] == 1.0


def test_correlator_empty():
    c = an.correlator({}, [0])
    assert c["empty"] is True and c["shots"] == 0
    c = an.correlator({"01": 10, "10": 10}, [0], postselect=[(0, 1)])
    assert c["empty"] is True and c["accepted"] == 0 and c["p_s"] == 0.0
    assert an.correlator({"00": 1}, [0])["empty"] is False


def test_binary_entropy_validation():
    assert an.binary_entropy(1 + 1e-13) == 0.0
    for bad in (-0.1, 1.1, float("nan")):
        with pytest.raises(ValueError):
            an.binary_entropy(bad)


def test_two_register_circuit_parsing():
    qr = QuantumRegister(2)
    a = ClassicalRegister(1, "a")
    b = ClassicalRegister(1, "b")
    qc = QuantumCircuit(qr, a, b)
    qc.x(0)  # a (clbit 0) = 1, b (clbit 1) = 0
    qc.measure(0, a[0])
    qc.measure(1, b[0])
    res = BasicSimulator().run(qc, shots=50, seed_simulator=1).result()
    counts = res.get_counts()
    assert list(counts) == ["0 1"]  # first register rightmost
    bits, _ = an.bits_from_counts(counts, 2)
    assert bits[0].tolist() == [1, 0]


def test_flips_and_postselect_combined():
    # clbit2 is a flip bit, bit0 == bit1 required; parity of clbit0 only
    counts = {"001": 10, "101": 10, "011": 5, "100": 5}
    c = an.correlator(counts, [0], flips=[2], postselect=[(0, 1)])
    # accepted: "001"? bit0=1,bit1=0 -> rejected; "101": bit0=1,bit1=0 rejected
    # "011": bit0=1,bit1=1 kept, flip 0 -> parity 1; "100": bit0=0,bit1=0, flip 1 -> 1
    assert c["accepted"] == 10 and c["value"] == -1.0


def test_bell_diagonal_other_bell_states():
    p = lambda v: {"value": v, "var": 0.0}  # noqa: E731
    # (XX, YY, ZZ): Psi+ = (1,1,-1), Psi- = (-1,-1,-1), Phi- = (-1,1,1)
    assert an.bell_diagonal(p(1), p(1), p(-1)) == (0.0, 1.0, 0.0, 0.0)
    assert an.bell_diagonal(p(-1), p(-1), p(-1)) == (0.0, 0.0, 1.0, 0.0)
    assert an.bell_diagonal(p(-1), p(1), p(1)) == (0.0, 0.0, 0.0, 1.0)


def test_is_ionq_by_module():
    class Fake:
        __module__ = "qiskit_ionq.ionq_backend"
        name = "whatever"

    assert an.is_ionq(Fake())
