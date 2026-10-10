"""Tests for levels 1-3: links, noise, teleport (seeded BasicSimulator)."""

import math

import numpy as np
import pytest
from qiskit.providers.basic_provider import BasicSimulator
from qiskit.quantum_info import DensityMatrix, Operator, Statevector, partial_trace

from quantum import analysis as an
from quantum import links, noise, teleport

SHOTS = 2000
OPTS = {"seed_simulator": 123}
STATES = {  # cardinal states: (theta, phi)
    "+z": (0.0, 0.0), "-z": (math.pi, 0.0),
    "+x": (math.pi / 2, 0.0), "-x": (math.pi / 2, math.pi),
    "+y": (math.pi / 2, math.pi / 2), "-y": (math.pi / 2, -math.pi / 2),
}


def within(metric):
    lo, hi = metric["ci95"]
    return lo <= metric["theory"] <= hi


def phi_plus_dm():
    v = np.zeros(4)
    v[0] = v[3] = 1 / math.sqrt(2)
    return DensityMatrix(Statevector(v))


def test_link_ideal():
    r = links.run_link(BasicSimulator(), SHOTS, **OPTS)
    assert r["metrics"]["fidelity"]["value"] >= 0.98
    assert within(r["metrics"]["corr_XX"]) and r["metrics"]["corr_YY"]["value"] < -0.95
    assert r["viz"]["leak"] == 0.0 and len(r["viz"]["samples"]) == 40
    assert all(c["two_qubit_gates"] == 1 for c in r["circuits"])


@pytest.mark.parametrize("F", [0.0, 0.3, 0.6, 0.8, 0.95, 1.0])
def test_env_prep_statevector(F):
    sv = Statevector(env_circ := noise.env_prep(F))
    assert sv.equiv(Statevector(noise.env_state(F)))
    assert env_circ.count_ops().get("cx", 0) == 1


def test_env_prep_cx_not_worse_than_state_prep():
    for F in (0.6, 0.8, 0.95):
        c = noise.env_prep_cx_counts(F)
        assert c["schmidt"] <= c["state_prep"]


@pytest.mark.parametrize("F", [0.25, 0.6, 0.8, 0.95])
def test_reduced_state_is_werner(F):
    qc = noise._noisy_pair("w", "ZZ", "werner", F)
    qc.remove_final_measurements()
    # qubits: A, B, env0, env1 -> trace out env
    rho = partial_trace(DensityMatrix(qc), [2, 3])
    pp = phi_plus_dm()
    expected = F * pp.data + (1 - F) / 3 * (np.eye(4) - pp.data)
    assert np.allclose(rho.data, expected, atol=1e-9)


@pytest.mark.parametrize("gamma", [0.0, 0.2, 0.5, 1.0])
def test_damping_theory(gamma):
    qc = noise._noisy_pair("d", "ZZ", "damping", gamma)
    qc.remove_final_measurements()
    rho = partial_trace(DensityMatrix(qc), [2])  # env0 only; env1 unused
    rho = partial_trace(rho, [2])
    th = noise.theory_damping(gamma)
    pp = phi_plus_dm().data
    f = float(np.real(np.trace(pp @ rho.data)))
    assert f == pytest.approx(th["F"], abs=1e-9)
    zz = float(np.real(np.trace(Operator.from_label("ZZ").data @ rho.data)))
    xx = float(np.real(np.trace(Operator.from_label("XX").data @ rho.data)))
    assert zz == pytest.approx(th["ZZ"], abs=1e-9)
    assert xx == pytest.approx(th["XX"], abs=1e-9)


@pytest.mark.parametrize("mode", ["teaching", "precision"])
def test_werner_noise(mode):
    r = noise.run_noise(BasicSimulator(), SHOTS, mode=mode, seed=5, **OPTS)
    for F in (0.95, 0.8, 0.6):
        m = r["metrics"][f"fidelity@{F:g}"]
        assert within(m), (mode, F, m)
        assert r["viz"]["leak"]["by_F"][f"{F:g}"] == pytest.approx(1 - F)
    assert r["params"]["channel"] == ("simulated_pauli" if mode == "precision" else "environment_qubits")
    assert r["viz"]["leak"]["source"] == ("simulated" if mode == "precision" else "circuit")
    assert r["viz"]["notes"]
    assert all("compiled_two_qubit_gates" in c for c in r["circuits"])
    n_circ = 9 if mode == "teaching" else 3
    assert len(r["circuits"]) == n_circ


def test_precision_uses_shared_ideal_circuits():
    assert all(c.count_ops().get("cx") == 1 for c in noise.build_noise(mode="precision"))


def test_pauli_error_counts_conserves_shots():
    rng = np.random.default_rng(0)
    out = noise.pauli_error_counts({"00": 600, "11": 400}, "Z", 0.8, rng)
    assert sum(out.values()) == 1000


def test_teleport_ideal_six_states():
    for label, (th, ph) in STATES.items():
        r = teleport.run_teleport(BasicSimulator(), SHOTS, th, ph, **OPTS)
        m = r["metrics"]["fidelity"]
        assert m["value"] >= 0.98 and m["ci95"][0] > 2 / 3, (label, m)


def test_teleport_noisy():
    r = teleport.run_teleport(BasicSimulator(), SHOTS, math.pi / 3, 0.7, F=0.8, **OPTS)
    m = r["metrics"]["fidelity"]
    assert m["theory"] == pytest.approx(0.86667, abs=1e-4)
    assert within(m) and m["classical_bound"] == pytest.approx(2 / 3)
    assert r["viz"]["leak"] == pytest.approx(0.2)


def test_duplicate_F_rejected():
    with pytest.raises(ValueError):
        noise.build_noise((0.8, 0.8000001))


def test_circuit_names_sanitized():
    names = [c.name for c in noise.build_noise((0.8,))]
    assert "noise_F0p8_XX" in names
    assert teleport.build_teleport(F=0.8)[0].name == "tele_psi_F0p8_X"


def test_pauli_error_flip_rates():
    F, n = 0.7, 200_000
    ideal = {
        "X": {"00": n // 2, "11": n // 2},
        "Y": {"01": n // 2, "10": n // 2},
        "Z": {"00": n // 2, "11": n // 2},
    }
    th = noise.theory_werner(F)
    rng = np.random.default_rng(9)
    for p in "XYZ":
        c = an.correlator(noise.pauli_error_counts(ideal[p], p, F, rng), [0, 1])
        assert c["ci95"][0] <= th[p + p] <= c["ci95"][1], (p, c)
