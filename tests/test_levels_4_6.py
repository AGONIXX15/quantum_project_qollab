"""Tests for levels 4-6: swap, purify, qkd (seeded BasicSimulator)."""

import math

import numpy as np
import pytest
from qiskit.circuit.library import HGate, SGate, SdgGate
from qiskit.providers.basic_provider import BasicSimulator
from qiskit.quantum_info import Operator, Statevector

from quantum import analysis as an
from quantum import noise, purify, qkd, swap

OPTS = {"seed_simulator": 3}
PAULI = {
    "I": np.eye(2), "X": np.array([[0, 1], [1, 0]]),
    "Y": np.array([[0, -1j], [1j, 0]]), "Z": np.diag([1, -1]),
}


def within(m):
    return m["ci95"][0] <= m["theory"] <= m["ci95"][1]


def near(m, k=3.0):
    """Theory within k sigma (CI half-width scaled from 1.96)."""
    lo, hi = m["ci95"]
    half = (hi - lo) / 2 * k / 1.96
    return abs(m["value"] - m["theory"]) <= half


# ----------------------------- level 4 -------------------------------------

@pytest.mark.parametrize("mode", ["teaching", "precision"])
@pytest.mark.parametrize("F1,F2", [(0.9, 0.85), (1.0, 1.0), (0.8, 0.8)])
def test_swap_formula(mode, F1, F2):
    r = swap.run_swap(BasicSimulator(), 4000, F1, F2, mode, **OPTS)
    m = r["metrics"]["fidelity"]
    assert m["theory"] == pytest.approx(F1 * F2 + (1 - F1) * (1 - F2) / 3)
    assert within(m), (mode, F1, F2, m)
    assert r["viz"]["leak"]["source"] == ("simulated" if mode == "precision" else "circuit")


def test_swap_bell_diag_matches_formula():
    p1, p2 = noise.werner_probs(0.9), noise.werner_probs(0.7)
    assert swap.swap_bell_diag(p1, p2)[0] == pytest.approx(0.9 * 0.7 + 0.1 * 0.3 / 3)
    assert sum(swap.swap_bell_diag(p1, p2)) == pytest.approx(1.0)


def test_swap_circuit_sizes():
    for qc in swap.build_swap(0.9, 0.8, "teaching"):
        assert qc.num_qubits == 8
    assert all(qc.num_qubits == 4 for qc in swap.build_swap(mode="precision"))


# ----------------------------- level 5 -------------------------------------

def u_matrix(u, conj=False):
    mats = {"h": HGate().to_matrix(), "s": SGate().to_matrix()}
    m = np.eye(2, dtype=complex)
    for g in purify.U_SEQ[u]:
        m = mats[g] @ m
    return m.conj() if conj else m


@pytest.mark.parametrize("u", purify.U_NAMES)
def test_u_table_invariance_and_permutation(u):
    # U (x) U* leaves Phi+ invariant (Alice = qubit 0 little-endian, Bob = qubit 1)
    phi = np.array([1, 0, 0, 1]) / math.sqrt(2)
    full = np.kron(u_matrix(u, conj=True), u_matrix(u))
    assert np.allclose(full @ phi, phi)
    # circuit gates agree with the matrices
    qc = purify.QuantumCircuit(2)
    purify.apply_u(qc, 0, 1, u)
    assert np.allclose(Operator(qc).data, full) or Operator(qc).equiv(Operator(full))
    ub = u_matrix(u, conj=True)
    for e in "XYZ":
        out = ub @ PAULI[e] @ ub.conj().T
        target = PAULI[purify.U_PERM[u][e]]
        assert np.allclose(out, target) or np.allclose(out, -target)


@pytest.mark.parametrize("spec", [
    noise.werner_spec(0.8), noise.pauli_spec((0.8, 0, 0.2, 0)),
    noise.pauli_spec((0.7, 0.1, 0.05, 0.15)), noise.damping_spec(0.2),
])
@pytest.mark.parametrize("u", ["I", "S", "SH"])
def test_dejmps_map_matches_density_matrix(spec, u):
    f_ex, ps_ex = purify.exact_purify(spec, u)
    th = purify.theory_purify(spec, u)
    if spec["kind"] != "damping":
        p, ps = purify.dejmps_map(purify.permute(noise.bell_diag_of(spec), u))
        assert p[0] == pytest.approx(f_ex, abs=1e-9) and ps == pytest.approx(ps_ex, abs=1e-9)
    assert th["F_out"] == pytest.approx(f_ex, abs=1e-9)


def test_dejmps_map2_mixed_pairs_matches_density_matrix():
    s1, s2 = noise.pauli_spec((0.8, 0, 0.2, 0)), noise.werner_spec(0.7)
    f, ps = purify.exact_purify(s1, "I", s2)
    p, ps2 = purify.dejmps_map2(noise.bell_diag_of(s1), noise.bell_diag_of(s2))
    assert (p[0], ps2) == pytest.approx((f, ps), abs=1e-9)


@pytest.mark.parametrize("mode", ["teaching", "precision"])
@pytest.mark.parametrize("F", [0.8, 0.9])
def test_dejmps_formula(mode, F):
    r = purify.run_purify(BasicSimulator(), 4000, F=F, mode=mode, **OPTS)
    ps, fp = purify.werner_formula(F)
    mf, mp = r["metrics"]["fidelity_fixed"], r["metrics"]["p_s_fixed"]
    assert mf["theory"] == pytest.approx(fp) and mp["theory"] == pytest.approx(ps)
    assert within(mf) and within(mp)
    assert r["viz"]["choice"]["chosen"] == "I"  # Werner: nothing to adapt to


def test_adaptive_beats_fixed_y_error():
    for mode in ("teaching", "precision"):
        r = purify.run_purify(BasicSimulator(), 3000, p=(0.8, 0, 0.2, 0), mode=mode, **OPTS)
        fx, ad = r["metrics"]["fidelity_fixed"], r["metrics"]["fidelity_adaptive"]
        assert near(fx) and near(ad)
        assert fx["value"] < 0.72 < 0.9 < ad["value"]  # fixed makes it worse
        assert ad["ci95"][0] > fx["ci95"][1]
        assert r["metrics"]["raw_pairs_adaptive"]["theory"] == pytest.approx(2.94, abs=0.01)


def test_adaptive_beats_fixed_damping():
    th_fixed = purify.theory_purify(noise.damping_spec(0.2), "I")["F_out"]
    th_ad = purify.theory_purify(noise.damping_spec(0.2), "SH")["F_out"]
    assert th_fixed == pytest.approx(0.8972, abs=1e-3)  # unchanged: no purification
    assert th_ad == pytest.approx(0.9817, abs=1e-3)
    r = purify.run_purify(BasicSimulator(), 3000, gamma=0.2, **OPTS)
    fx, ad = r["metrics"]["fidelity_fixed"], r["metrics"]["fidelity_adaptive"]
    assert near(fx) and near(ad) and ad["ci95"][0] > fx["ci95"][1] + 0.05
    assert r["viz"]["choice"]["chosen"] in ("SH", "HSH")


def test_predicted_strategy_is_small_batch():
    r = purify.run_purify(BasicSimulator(), 1500, gamma=0.2, strategy="predicted", **OPTS)
    assert len(r["circuits"]) == 9 and r["metrics"]["fidelity_adaptive"]["u"] in ("SH", "HSH")
    r = purify.run_purify(BasicSimulator(), 1500, F=0.9, strategy="all", **OPTS)
    assert len(r["circuits"]) == 21
    assert len(purify.build_purify(noise.werner_spec(0.9), ("I",))) == 6


def test_choose_u_and_rounds():
    assert purify.choose_u((0.8, 0.0667, 0.0667, 0.0667))[0] == "I"
    assert purify.choose_u((0.8, 0, 0.2, 0))[0] in ("S", "HS", "SH", "HSH")
    p = (0.8, 0, 0.2, 0)
    fixed = purify.rounds_to_target(p, 0.95, "fixed")
    ad = purify.rounds_to_target(p, 0.95, "adaptive")
    assert fixed["reachable"] and ad["reachable"] and ad["raw_pairs"] < fixed["raw_pairs"]
    assert fixed["raw_pairs"] == pytest.approx(20.1, abs=0.2) and ad["raw_pairs"] == pytest.approx(6.6, abs=0.1)
    # fixed circuit first makes Y errors worse: 0.68, 0.819, 0.953, 0.998
    traj = purify.rounds_to_target(p, 0.99, "fixed")["trajectory"]
    assert traj[1:] == pytest.approx([0.68, 0.8190, 0.9530, 0.9980], abs=1e-3)
    # twirled damping 0.2 -> 0.98
    pd = noise.bell_diag_of(noise.damping_spec(0.2))
    f2, a2 = (purify.rounds_to_target(pd, 0.98, s) for s in ("fixed", "adaptive"))
    assert f2["raw_pairs"] == pytest.approx(5.45, abs=0.1) and a2["raw_pairs"] == pytest.approx(2.44, abs=0.05)
    w = (0.9,) + (0.1 / 3,) * 3
    auto = purify.rounds_to_target(w, 0.95, "auto")
    assert auto["reachable"] and auto["raw_pairs"] <= purify.rounds_to_target(w, 0.95, "adaptive")["raw_pairs"]
    assert purify.rounds_to_target(w, 0.5, "fixed")["rounds"] == 0
    # Werner 0.7 cannot be pumped to 0.99: reported unreachable (fixed point)
    r = purify.rounds_to_target((0.7,) + (0.1,) * 3, 0.999, "pumping", max_rounds=30)
    assert not r["reachable"] and r["raw_pairs"] == math.inf


def test_choose_u_stable_under_shot_noise():
    hits = 0
    for seed in range(20):
        rng = np.random.default_rng(seed)
        v = (4 * 0.9 - 1) / 3
        c = {}
        for b, sgn in (("XX", 1), ("YY", -1), ("ZZ", 1)):
            q = rng.binomial(300, (1 - sgn * v) / 2) / 300
            c[b] = {"value": 1 - 2 * q, "var": 0.0}
        p_hat = an.bell_diagonal(c["XX"], c["YY"], c["ZZ"])
        hits += purify.choose_u(p_hat, shots=300)[0] == "I"
    assert hits >= 18


def test_damping_choice_is_the_argmax_set():
    spec = noise.damping_spec(0.2)
    pd = noise.bell_diag_of(spec)
    gains = {u: purify.dejmps_map2(purify.permute(pd, u), purify.permute(pd, u))[0][0] for u in purify.U_NAMES}
    best = max(gains.values())
    argmax = {u for u, g in gains.items() if g > best - 1e-9}
    assert argmax == {"SH", "HSH"}
    assert purify.choose_u(pd)[0] in argmax
    exact = {u: purify.exact_purify(spec, u)[0] for u in purify.U_NAMES}
    assert {u for u, f in exact.items() if f > max(exact.values()) - 1e-9} == argmax
    r = purify.run_purify(BasicSimulator(), 3000, gamma=0.2, **OPTS)
    assert r["viz"]["choice"]["chosen"] in argmax


class Counting(BasicSimulator):
    """BasicSimulator that counts backend.run calls."""

    runs = 0

    def run(self, *a, **k):
        type(self).runs += 1
        return super().run(*a, **k)


def test_single_backend_run_per_level():
    be = Counting()
    for fn in (
        lambda: swap.run_swap(be, 200, 0.9, 0.8, **OPTS),
        lambda: purify.run_purify(be, 200, F=0.8, **OPTS),
        lambda: purify.run_purify(be, 200, p=(0.8, 0, 0.2, 0), strategy="predicted", **OPTS),
        lambda: qkd.run_qkd(be, 200, 1.0, smart_direct=True, **OPTS),
    ):
        Counting.runs = 0
        fn()
        assert Counting.runs == 1


def test_error_flip_masks_validation():
    qc = purify.QuantumCircuit(2, 2)
    qc.h(0)
    qc.measure([0, 1], [0, 1])
    with pytest.raises(ValueError, match="channel"):
        noise.error_flip_masks(qc, [0])
    qc2 = purify.QuantumCircuit(2, 2)
    qc2.barrier(label="channel")
    qc2.ry(0.3, 0)  # not Clifford
    qc2.measure([0, 1], [0, 1])
    with pytest.raises(ValueError, match="Clifford"):
        noise.error_flip_masks(qc2, [0])
    qc3 = purify.QuantumCircuit(2, 2)
    qc3.barrier(label="channel")
    qc3.h(0)
    with pytest.raises(ValueError, match="measured"):
        noise.error_flip_masks(qc3, [0])


def exact_distribution(qc, n_clbits):
    """Exact outcome distribution of a circuit (clbit i measures qubit map[i])."""
    meas = {c: q for q, c in noise.channel_tail(qc)[1].items()}
    bare = qc.remove_final_measurements(inplace=False)
    sv = Statevector(bare)
    probs = sv.probabilities_dict(qargs=[meas[i] for i in range(n_clbits)])
    return {int(k, 2): v for k, v in probs.items()}


def flip_mixture(ideal, masks, probs):
    """Exact distribution after independent Pauli errors with the given masks."""
    out = {}
    combos = [(1.0, 0)]
    for q in masks:
        combos = [(pc * probs[q][e], mc ^ masks[q][e]) for pc, mc in combos for e in range(4)]
    for v, pv in ideal.items():
        for pc, mc in combos:
            out[v ^ mc] = out.get(v ^ mc, 0.0) + pv * pc
    return out


@pytest.mark.parametrize("which", ["swap", "purify"])
def test_precision_equals_teaching_exactly(which):
    if which == "swap":
        s1, s2 = noise.werner_spec(0.85), noise.pauli_spec((0.7, 0.1, 0.15, 0.05))
        tea = swap._swap_circuit("t", "XX", s1, s2)
        ide = swap._swap_circuit("i", "XX", None, None)
        errs = {1: s1, 2: s2}
    else:
        s1 = noise.pauli_spec((0.7, 0.05, 0.2, 0.05))
        tea = purify._purify_circuit("t", "YY", s1, s1, "SH")
        ide = purify._purify_circuit("i", "YY", None, None, "SH", ideal=True)
        errs = {1: s1, 3: s1}
    masks = noise.error_flip_masks(ide, list(errs))
    probs = {q: noise.pauli_probs(s) for q, s in errs.items()}
    expected = flip_mixture(exact_distribution(ide, 4), masks, probs)
    got = exact_distribution(tea, 4)
    for k in set(expected) | set(got):
        assert got.get(k, 0.0) == pytest.approx(expected.get(k, 0.0), abs=1e-9), k


def test_make_spec_validation():
    with pytest.raises(ValueError):
        noise.make_spec(F=0.8, gamma=0.1)
    with pytest.raises(ValueError):
        purify.run_purify(BasicSimulator(), 100)


# ----------------------------- level 6 -------------------------------------

def test_chsh_ideal():
    r = qkd.run_qkd(BasicSimulator(), 4000, 0.0, **OPTS)
    m = r["metrics"]["chsh_standard"]
    assert abs(m["value"] - 2 * math.sqrt(2)) < 3 * m["sigma"]
    assert m["significance_sigma"] > 3
    assert r["metrics"]["qber_Z"]["value"] < 0.01 and r["metrics"]["qber_X"]["value"] < 0.01


def test_eve_full_intercept():
    r = qkd.run_qkd(BasicSimulator(), 4000, math.pi, **OPTS)
    m = r["metrics"]
    mean = (m["qber_Z"]["value"] + m["qber_X"]["value"]) / 2
    assert abs(mean - 0.25) < 0.02
    assert m["chsh_standard"]["ci95"][0] <= math.sqrt(2) <= m["chsh_standard"]["ci95"][1]
    assert m["chsh_standard"]["value"] < 2
    assert m["eve_guess"]["value"] > 0.99
    assert m["key_rate_lca_biased"]["value"] < 0.01 and m["key_rate_shor_preskill"]["value"] < 0.01


def test_smart_beats_standard_at_120_degrees():
    r = qkd.run_qkd(BasicSimulator(), 4000, math.radians(120), smart_direct=True, **OPTS)
    m = r["metrics"]
    th = qkd.theory_qkd(math.radians(120))
    assert th["S_std"] == pytest.approx(2.1213, abs=1e-3) and th["S_smart"] == pytest.approx(2.2361, abs=1e-3)
    assert m["chsh_smart"]["value"] > m["chsh_standard"]["value"]
    assert m["chsh_smart"]["significance_sigma"] > m["chsh_standard"]["significance_sigma"]
    for k in ("chsh_standard", "chsh_smart", "chsh_smart_direct", "qber_X", "eve_guess"):
        assert near(m[k]), k
    assert len(r["circuits"]) == 10
    # the biased-basis rate beats the standard one where the standard gives 0
    assert m["key_rate_lca_biased"]["theory"] > 0.15 and m["key_rate_shor_preskill"]["theory"] == 0


def test_werner_option():
    r = qkd.run_qkd(BasicSimulator(), 4000, 0.0, F=0.9, **OPTS)
    m = r["metrics"]
    for k in ("qber_Z", "qber_X", "chsh_standard", "chsh_smart"):
        assert near(m[k]), k
    assert "eve_guess" not in m and len(r["circuits"]) == 6
    with pytest.raises(ValueError):
        qkd.build_qkd(1.0, F=0.9)


def test_shots_for_chsh_matches_research():
    c = 0.5
    assert qkd.shots_for_chsh(1.0, c, qkd.BOB_STD) == pytest.approx(1682, abs=3)
    b = math.atan(c)
    assert qkd.shots_for_chsh(1.0, c, (b, -b)) == pytest.approx(372, abs=2)
    assert qkd.shots_for_chsh(1.0, 0.0, qkd.BOB_STD) == math.inf


def test_key_rate_theory_and_finite_size():
    th = qkd.theory_qkd(0.0)
    assert th["rate_shor_preskill"] == 0.5 and th["rate_lca_biased"] == 1.0
    assert qkd.theory_qkd(math.pi)["rate_lca_biased"] == 0.0
    r1 = qkd.finite_key_rate(1e4, 0.03, 0.03)["rate"]
    r2 = qkd.finite_key_rate(1e6, 0.03, 0.03)["rate"]
    asym = qkd.theory_qkd(0.0, F=0.955)["rate_lca_biased"]
    assert 0 < r1 < r2 < asym
    assert qkd.min_pairs_for_key(0.03, 0.03) < qkd.min_pairs_for_key(0.06, 0.06)
    assert qkd.min_pairs_for_key(0.2, 0.2) is None
    assert qkd.finite_key_rate(1e6, 0.03, 0.03)["rate"] >= qkd.finite_key_rate(1e6, 0.03, 0.03, f=0.5)["rate"]


def test_smart_split_vs_oracle_and_labels():
    sp = qkd.run_qkd(BasicSimulator(), 4000, math.radians(120), seed=1, **OPTS)["metrics"]["chsh_smart"]
    orc = qkd.run_qkd(BasicSimulator(), 4000, math.radians(120), beta_source="oracle", **OPTS)["metrics"]["chsh_smart"]
    assert sp["beta_source"] == "split" and "held-out" in sp["label"] and "not device-independent" in sp["note"]
    assert orc["beta_source"] == "oracle" and "upper bound" in orc["label"]
    assert near(sp) and near(orc) and sp["significance_sigma"] > 3
    assert orc["sigma"] < sp["sigma"]  # the split uses half of the shots
    assert sp["beta"] == pytest.approx(math.atan(0.5), abs=0.1)
    with pytest.raises(ValueError):
        qkd.decode_qkd({}, 0.0, beta_source="bad")


def test_smart_split_has_no_spurious_violation_without_entanglement():
    m = qkd.run_qkd(BasicSimulator(), 2000, math.pi, seed=4, **OPTS)["metrics"]["chsh_smart"]
    assert m["significance_sigma"] < 3
    assert "shots_note" in qkd.run_qkd(BasicSimulator(), 300, 0.0, **OPTS)["viz"]["finite_size"]


def test_correlators_from_bell_diagonal_roundtrip():
    p = (0.55, 0.2, 0.15, 0.1)
    xx, yy, zz = an.correlators_from_bell_diagonal(p)
    back = an.bell_diagonal({"value": xx}, {"value": yy}, {"value": zz})
    assert back == pytest.approx(p)
