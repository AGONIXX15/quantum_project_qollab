"""Level 6, catch the spy: entanglement-based QKD (E91 / BBM92) with CHSH.

Alice (A) and Bob (B) share Phi+. A spy Eve (E) copies information of Bob's
half with CRY(theta) (control B, target E): with c = cos(theta/2) the pair
keeps F = (1+c)/2, QBER_Z = 0, QBER_X = (1-c)/2 (mean QBER (1-c)/4, 25 % at
theta = pi), the standard CHSH value is S = sqrt(2)(1+c) (violation only for
theta < 131.1 deg) and Eve's best guess of the key bit is
P_guess = (1 + sin(theta/2))/2 (Helstrom). Instead of Eve, a Werner(F)
channel can be used (``F``; then theta must be 0): QBER_Z = QBER_X =
2(1-F)/3 and S = 2 sqrt(2)(4F-1)/3.

Circuits (measure only at the end). Each measures A and B at angles (a, b),
meaning the observable cos(angle) Z + sin(angle) X, i.e. RY(-angle) then Z.
Eve's qubit, when present, is ALWAYS measured with the Helstrom rotation
RY(pi/2 - theta/2), so every circuit also gives P(E == A in Z) when A is
measured in Z. Bit order, register ``out`` (Qiskit little-endian):
clbit 0 = A, 1 = B, 2 = E (only with Eve).
    - ZZ: angles (0, 0): QBER_Z, key bits, Eve's guess.
    - XX: angles (pi/2, pi/2): QBER_X.
    - 4 standard CHSH circuits: Alice 0, pi/2; Bob +pi/4, -pi/4.
    - optional 4 "smart" circuits (``smart_direct=True``): same Alice
      settings, Bob +-beta.
Smart (device-informed, NOT device-independent) CHSH: for a state whose
X-Z correlation matrix is diag(T_x, T_z), Alice (0, pi/2) and Bob (+-beta)
give S = 2 (T_z cos(beta) + T_x sin(beta)), maximal 2 sqrt(T_x^2 + T_z^2) at
tan(beta) = T_x/T_z; for the CRY spy this is 2 sqrt(1 + c^2). By linearity
this value is determined by the ZZ and XX circuits, so the smart S is
computed from them with no extra circuits (the standard S is
sqrt(2)(ZZ + XX)). It is therefore NOT an independent Bell test. To avoid the
upward bias of choosing beta on the same shots, the default
``beta_source="split"`` draws a random half of the ZZ/XX shots (seeded
hypergeometric split), estimates beta = atan2(XX, ZZ) there and evaluates S on
the other half only. ``beta_source="oracle"`` uses the configured (known) spy
angle: an upper bound, labelled as such. The optional ``smart_direct``
circuits (4 extra) always use the oracle beta, since beta cannot be estimated
inside the same job.

Key rates (asymptotic, per pair), two clearly named schemes:
    - "Shor-Preskill" (``key_rate_shor_preskill``): symmetric bases keep half of
      the pairs (sifting 1/2): rate 1/2 max(0, 1 - 2h(Qbar)), Qbar = (Q_Z+Q_X)/2.
    - "LCA biased" (``key_rate_lca_biased``): almost all pairs in Z, the
      per-basis bound max(0, 1 - h(Q_Z) - h(Q_X)) (Lo-Chau-Ardehali).
``finite_key_rate`` adds a simplified Hoeffding term (e_X + sqrt(ln(1/delta)
/(2 n_test)), minus 2 log2(1/delta) bits). It is OPTIMISTIC and a toy: point
estimates, no error-correction leakage, no composable security terms. With
~1000 shots the key rate shown is only a projection.

References:
    - Ekert (1991). Phys. Rev. Lett. 67:661; Bennett, Brassard, Mermin (1992).
      Phys. Rev. Lett. 68:557.
    - Clauser, Horne, Shimony, Holt (1969). Phys. Rev. Lett. 23:880.
    - Horodecki, Horodecki, Horodecki (1995). Phys. Lett. A 200:340.
    - Helstrom (1976). Quantum Detection and Estimation Theory.
    - Shor & Preskill (2000). Phys. Rev. Lett. 85:441.
    - Lo, Chau, Ardehali (2005). J. Cryptology 18:133.
    - Hoeffding (1963). J. Am. Stat. Assoc. 58:13; Tomamichel et al. (2012).
      Nat. Commun. 3:634 (finite-key analysis).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister

from . import analysis as an
from .execute import circuit_report, run_batch, safe_name
from .noise import apply_werner

BIT_ORDER = "Qiskit little-endian; clbits: 0=A, 1=B, 2=E (Helstrom, only with Eve)"
ALICE = (0.0, math.pi / 2)
BOB_STD = (math.pi / 4, -math.pi / 4)
CHSH_SIGNS = ((0, 0, 1), (0, 1, 1), (1, 0, 1), (1, 1, -1))  # (a, b, sign)


# --------------------------------------------------------------------------
# Theory (pure functions)
# --------------------------------------------------------------------------

def smart_angle(zz: float, xx: float) -> float:
    """Bob's optimal angle beta for Alice (0, pi/2): atan2(T_x, T_z)."""
    zz, xx = max(zz, 0.0), max(xx, 0.0)
    return math.atan2(xx, zz) if (zz > 0 or xx > 0) else math.pi / 4


def chsh_from_zz_xx(zz: float, xx: float, beta: float) -> float:
    """S for Alice (0, pi/2) and Bob (+beta, -beta) with diagonal correlations."""
    return 2.0 * (math.cos(beta) * zz + math.sin(beta) * xx)


def theory_qkd(theta: float = 0.0, F: float | None = None) -> dict[str, float | None]:
    """Theoretical values for the spy CRY(theta) or the Werner(F) link."""
    if F is None:
        c = math.cos(theta / 2.0)
        zz, xx = 1.0, c
        extra = {"F": (1 + c) / 2, "P_guess": (1 + math.sin(theta / 2.0)) / 2}
    else:
        zz = xx = (4.0 * F - 1.0) / 3.0
        extra = {"F": F, "P_guess": None}
    qz, qx = (1 - zz) / 2, (1 - xx) / 2
    beta = smart_angle(zz, xx)
    return {
        "ZZ": zz, "XX": xx, "qber_Z": qz, "qber_X": qx, "qber_mean": (qz + qx) / 2,
        "S_std": chsh_from_zz_xx(zz, xx, math.pi / 4),
        "beta": beta, "S_smart": chsh_from_zz_xx(zz, xx, beta),
        "rate_shor_preskill": 0.5 * an.key_rate_bb84((qz + qx) / 2),
        "rate_lca_biased": an.key_rate_per_basis(qz, qx),
        **extra,
    }


def _h_vec(q: np.ndarray) -> np.ndarray:
    q = np.clip(q, 1e-15, 1 - 1e-15)
    return -q * np.log2(q) - (1 - q) * np.log2(1 - q)


def finite_key_rate(
    n: float, qz: float, qx: float, delta: float = 1e-10, f: float | None = None
) -> dict[str, float]:
    """Simplified finite-size key per pair for ``n`` pairs (Hoeffding bound).

    A fraction f of pairs is used to test the X error (``f=None`` optimizes f,
    the biased case; ``f=0.5`` is the symmetric choice). Key bits =
    n(1-f)(1 - h(qz) - h(e_X)) - 2 log2(1/delta), e_X = qx + sqrt(ln(1/delta)/(2 f n)).
    Illustration only: it omits error-correction leakage and e_Z estimation.
    """
    fs = np.linspace(0.005, 0.5, 400) if f is None else np.array([f], dtype=float)
    ex = np.minimum(qx + np.sqrt(math.log(1 / delta) / (2 * fs * n)), 0.5)
    bits = n * (1 - fs) * (1 - _h_vec(np.array(qz)) - _h_vec(ex)) - 2 * math.log2(1 / delta)
    i = int(np.argmax(bits))
    return {"rate": max(0.0, float(bits[i])) / n, "f": float(fs[i])}


def min_pairs_for_key(
    qz: float, qx: float, delta: float = 1e-10, f: float | None = None
) -> float | None:
    """Smallest n (log grid, 1e2..1e9) with a positive finite-size rate."""
    for n in np.logspace(2, 9, 141):
        if finite_key_rate(float(n), qz, qx, delta, f)["rate"] > 0:
            return float(n)
    return None


def shots_for_chsh(
    zz: float, xx: float, bob: tuple[float, float], nsigma: float = 3.0
) -> float:
    """Shots per CHSH configuration for an ``nsigma`` violation (diagonal T).

    E(a0,b) = cos(b) ZZ, E(a1,b) = sin(b) XX; N = nsigma^2 sum(1-E^2)/(S-2)^2.
    Returns inf if S <= 2.
    """
    es = [math.cos(bob[0]) * zz, math.cos(bob[1]) * zz,
          math.sin(bob[0]) * xx, -math.sin(bob[1]) * xx]
    s = sum(es)
    if s <= 2.0:
        return math.inf
    return nsigma**2 * sum(1 - e * e for e in es) / (s - 2.0) ** 2


# --------------------------------------------------------------------------
# Circuits
# --------------------------------------------------------------------------

def _label(theta: float, F: float | None) -> str:
    if F is not None:
        return safe_name(f"F{F:g}")
    return safe_name(f"th{math.degrees(theta):.4g}")


def _circuit(name: str, a: float, b: float, theta: float, F: float | None, meta: dict) -> QuantumCircuit:
    qa, qb = QuantumRegister(1, "A"), QuantumRegister(1, "B")
    regs = [qa, qb]
    eve = F is None
    qe = QuantumRegister(1, "E") if eve else None
    env = QuantumRegister(2, "env") if F is not None else None
    regs += [r for r in (qe, env) if r is not None]
    out = ClassicalRegister(3 if eve else 2, "out")
    qc = QuantumCircuit(*regs, out, name=name, metadata=meta)
    qc.h(qa[0])
    qc.cx(qa[0], qb[0])
    if env is not None:
        apply_werner(qc, qb[0], env[0], env[1], F)
    if eve:
        qc.cry(theta, qb[0], qe[0])
    if a:
        qc.ry(-a, qa[0])
    if b:
        qc.ry(-b, qb[0])
    if eve:
        qc.ry(math.pi / 2 - theta / 2, qe[0])  # Helstrom measurement
    qc.measure(qa[0], out[0])
    qc.measure(qb[0], out[1])
    if eve:
        qc.measure(qe[0], out[2])
    return qc


def build_qkd(
    theta: float = 0.0,
    F: float | None = None,
    beta: float | None = None,
    smart_direct: bool = False,
) -> list[QuantumCircuit]:
    """ZZ, XX, 4 standard CHSH circuits (+4 smart ones with ``smart_direct``).

    ``beta`` is Bob's smart angle (default: from the configured link).
    """
    if F is not None and theta != 0.0:
        raise ValueError("use either an eavesdropper (theta) or Werner noise (F)")
    lab = _label(theta, F)
    circuits = [
        _circuit(f"qkd_{lab}_ZZ", 0.0, 0.0, theta, F, {"role": "ZZ"}),
        _circuit(f"qkd_{lab}_XX", math.pi / 2, math.pi / 2, theta, F, {"role": "XX"}),
    ]
    sets = [("chsh", BOB_STD)]
    if smart_direct:
        bt = theory_qkd(theta, F)["beta"] if beta is None else beta
        sets.append(("smart", (bt, -bt)))
    for kind, bob in sets:
        for i, j, _ in CHSH_SIGNS:
            circuits.append(_circuit(
                f"qkd_{lab}_{kind}_a{i}_b{j}", ALICE[i], bob[j], theta, F,
                {"role": kind, "a": i, "b": j},
            ))
    return circuits


# --------------------------------------------------------------------------
# Decoding
# --------------------------------------------------------------------------

def _q_from_corr(c: dict[str, Any]) -> tuple[float, list[float]]:
    """QBER and its CI from a correlator dict: q = (1 - <PP>)/2."""
    return (1 - c["value"]) / 2, [(1 - c["ci95"][1]) / 2, (1 - c["ci95"][0]) / 2]


def _chsh_metric(terms: list[tuple[float, dict[str, Any]]], theory: float | None, **extra: Any) -> dict[str, Any]:
    s = sum(sign * c["value"] for sign, c in terms)
    var = sum(an.ac_var(c) for _, c in terms)  # Agresti-Coull: never 0 at the edges
    half = 1.96 * math.sqrt(var)
    sigma = math.sqrt(var)
    return an.metric(
        s, [s - half, s + half], theory, sigma=sigma,
        significance_sigma=(s - 2.0) / sigma if sigma > 0 else None,
        classical_bound=2.0, **extra,
    )


def decode_qkd(
    counts_by_id: dict[str, dict[str, int]],
    theta: float = 0.0,
    F: float | None = None,
    beta: float | None = None,
    smart_direct: bool = False,
    seed: int = 0,
    beta_source: str = "split",
) -> dict[str, Any]:
    """QBERs, CHSH (standard and smart), Eve's guess, key rates, finite-size.

    ``beta_source``: "split" (default, beta estimated on one random half of the
    ZZ/XX shots and S evaluated on the other) or "oracle" (configured beta).
    """
    if beta_source not in ("split", "oracle"):
        raise ValueError("beta_source must be 'split' or 'oracle'")
    th = theory_qkd(theta, F)
    beta_cfg = th["beta"] if beta is None else beta
    circuits = build_qkd(theta, F, beta_cfg, smart_direct)
    corr = {}
    for qc in circuits:
        c = counts_by_id[qc.name]
        corr[qc.name] = (qc.metadata, an.correlator(c, [0, 1]), c)
    by_role = {m["role"]: (c, raw) for m, c, raw in corr.values() if m["role"] in ("ZZ", "XX")}
    zz, xx = by_role["ZZ"][0], by_role["XX"][0]
    qz, qz_ci = _q_from_corr(zz)
    qx, qx_ci = _q_from_corr(xx)
    metrics: dict[str, Any] = {
        "qber_Z": an.metric(qz, qz_ci, th["qber_Z"]),
        "qber_X": an.metric(qx, qx_ci, th["qber_X"]),
    }
    # CHSH from the four directly measured standard circuits.
    std = [(sg, corr[next(n for n, (m, _, _) in corr.items()
                          if m["role"] == "chsh" and m["a"] == i and m["b"] == j)][1])
           for i, j, sg in CHSH_SIGNS]
    metrics["chsh_standard"] = _chsh_metric(std, th["S_std"], method="direct_circuits")
    # Smart S from the key circuits (exact linear identity).
    if beta_source == "oracle":
        zz_e, xx_e, beta_used = zz, xx, beta_cfg
        label = "oracle β (known spy angle) — upper bound"
    else:
        rng = np.random.default_rng(seed)
        cal, ev = {}, {}
        for role in ("ZZ", "XX"):
            raw = by_role[role][1]
            keys = list(raw)
            w = np.array([raw[k] for k in keys], dtype=np.int64)
            take = rng.multivariate_hypergeometric(w, int(w.sum()) // 2)
            cal[role] = {k: int(t) for k, t in zip(keys, take) if t}
            ev[role] = {k: int(a - t) for k, a, t in zip(keys, w, take) if a - t}
        beta_used = smart_angle(
            an.correlator(cal["ZZ"], [0, 1])["value"], an.correlator(cal["XX"], [0, 1])["value"]
        )
        zz_e, xx_e = an.correlator(ev["ZZ"], [0, 1]), an.correlator(ev["XX"], [0, 1])
        label = "device-informed (β estimated on a held-out half)"
    lin = [(2 * math.cos(beta_used), zz_e), (2 * math.sin(beta_used), xx_e)]
    s_lin = sum(w * c["value"] for w, c in lin)
    sig = math.sqrt(sum(w * w * an.ac_var(c) for w, c in lin))
    half = 1.96 * sig
    metrics["chsh_smart"] = an.metric(
        s_lin, [s_lin - half, s_lin + half], chsh_from_zz_xx(th["ZZ"], th["XX"], beta_used),
        sigma=sig, significance_sigma=(s_lin - 2.0) / sig if sig > 0 else None,
        classical_bound=2.0, method="linear_from_ZZ_XX", beta=beta_used,
        beta_source=beta_source, label=label, S_max_theory=th["S_smart"],
        note="device-informed (β estimated from data), computed from ZZ/XX correlators "
        "via an exact identity; not an independent Bell test, not device-independent",
    )
    if smart_direct:
        sm = [(sg, corr[next(n for n, (m, _, _) in corr.items()
                             if m["role"] == "smart" and m["a"] == i and m["b"] == j)][1])
              for i, j, sg in CHSH_SIGNS]
        metrics["chsh_smart_direct"] = _chsh_metric(
            sm, chsh_from_zz_xx(th["ZZ"], th["XX"], beta_cfg), method="direct_circuits",
            beta=beta_cfg, beta_source="oracle", label="oracle β (known spy angle) — upper bound",
        )
    # Eve's Helstrom guess of Alice's Z bit.
    p_guess = None
    if F is None:
        e = an.correlator(by_role["ZZ"][1], [0, 2])
        p_guess = (1 + e["value"]) / 2
        metrics["eve_guess"] = an.metric(
            p_guess, [(1 + e["ci95"][0]) / 2, (1 + e["ci95"][1]) / 2], th["P_guess"]
        )
    # Key rates (monotone decreasing in each QBER: CI from the QBER CI ends).
    std_q = lambda a, b: 0.5 * an.key_rate_bb84((a + b) / 2)  # noqa: E731
    metrics["key_rate_shor_preskill"] = an.metric(
        std_q(qz, qx), [std_q(qz_ci[1], qx_ci[1]), std_q(qz_ci[0], qx_ci[0])], th["rate_shor_preskill"]
    )
    metrics["key_rate_lca_biased"] = an.metric(
        an.key_rate_per_basis(qz, qx),
        [an.key_rate_per_basis(qz_ci[1], qx_ci[1]), an.key_rate_per_basis(qz_ci[0], qx_ci[0])],
        th["rate_lca_biased"],
    )
    fin = {
        # toy finite-key model: symmetric test fraction f=0.5 vs optimized test fraction
        "n_min_pairs_lca_biased": min_pairs_for_key(qz, qx),
        "n_min_pairs_symmetric": min_pairs_for_key(qz, qx, f=0.5),
        "rate_lca_biased": {f"{n:g}": finite_key_rate(n, qz, qx)["rate"] for n in (1e4, 1e5, 1e6)},
        "rate_symmetric": {f"{n:g}": finite_key_rate(n, qz, qx, f=0.5)["rate"] for n in (1e4, 1e5, 1e6)},
        "shots_3sigma_standard": shots_for_chsh(zz["value"], xx["value"], BOB_STD),
        "shots_3sigma_smart": shots_for_chsh(zz["value"], xx["value"], (beta_used, -beta_used)),
        "shots_note": "shots per CHSH configuration given known β",
        "warning": (
            "Asymptotic rates are projections: with ~1000 shots no key is secure. "
            "The finite-key numbers are optimistic and simplified (point estimates, "
            "no error-correction leakage, toy security terms), not a security proof."
        ),
    }
    leak = (2 * p_guess - 1) if p_guess is not None else 1.0 - (th["F"] or 0.0)
    viz = {
        "samples": an.sample_parity(by_role["ZZ"][1], [0, 1], seed=seed),
        "leak": {"value": leak, "source": "circuit",
                 "kind": "eve_advantage" if p_guess is not None else "one_minus_F"},
        "finite_size": fin,
        "bloch": {"theory": [0.0, 0.0, 0.0]},
    }
    return {"metrics": metrics, "viz": viz}


def run_qkd(
    backend: Any,
    shots: int = 1000,
    theta: float = 0.0,
    F: float | None = None,
    smart_direct: bool = False,
    seed: int = 0,
    beta_source: str = "split",
    **run_options: Any,
) -> dict[str, Any]:
    """Run level 6 with a single ``backend.run``; returns the JSON contract."""
    circuits = build_qkd(theta, F, None, smart_direct)
    counts, compiled = run_batch(backend, circuits, shots, **run_options)
    dec = decode_qkd(counts, theta, F, None, smart_direct, seed, beta_source)
    dec["viz"]["steps"] = {qc.name: an.circuit_steps(qc) for qc in circuits[:2]}
    return an.make_result(
        "qkd", "live", an.backend_name(backend), shots,
        {"theta": theta, "F": F, "smart_direct": smart_direct, "beta_source": beta_source}, BIT_ORDER,
        dec["metrics"], circuit_report(circuits, compiled), counts, viz=dec["viz"],
    )
