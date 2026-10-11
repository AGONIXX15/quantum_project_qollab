"""Who is listening? A hidden culprit (environment noise or a spy) and a fingerprint detector.

From a seed, a hidden culprit is drawn:
    - "noise": a Werner(F) channel (environment qubits, ``noise.apply_werner``);
    - "spy":   Eve's CRY(theta) from Bob (``qkd``), with theta chosen so that the
               fidelity of the pair is drawn from the SAME range as the noise case.
Both have F in [F_LO, F_HI], so the total fidelity cannot tell them apart. What
differs is the fingerprint of the errors (``qkd`` docstring):
    - Werner(F): QBER_Z = QBER_X = 2(1-F)/3;
    - spy:       QBER_Z = 0, QBER_X = (1-c)/2 = 1-F, c = cos(theta/2), F = (1+c)/2.

Circuits: the ZZ and XX circuits of ``qkd.build_qkd`` (the existing builders, measured
only at the end), renamed ``mystery_ZZ`` / ``mystery_XX`` and made structurally identical
for both culprits so nothing but the data hints at the kind: both have ``N_QUBITS`` = 4
qubits (the spy circuit gets an idle padding qubit; Eve's own Helstrom rotation and
measurement are dropped, they are not needed here) and a 2-bit register ``out``.
Bit order (Qiskit little-endian): clbit 0 = A, 1 = B. QBER = fraction of shots where
clbit 0 XOR clbit 1 is 1. On IonQ both circuits go out packed in ONE circuit and ONE job
(8 qubits for either kind). Gate counts and depth still differ between the kinds; the UI
never shows them (the bridge strips ``circuits``, ``counts``, ``truth`` and ``params``
until the player has guessed).

Fidelity: only Z and X are measured, so F = (1 + <ZZ> + 2<XX>)/4. This uses <YY> = -<XX>,
which holds for both candidates (Werner and the CRY spy). It is a model-based estimate
(it is not a Y measurement); its variance is (var ZZ + 4 var XX)/16.

Detector: two-proportion z-test of QBER_X against QBER_Z with pooled variance,
z = (q_X - q_Z)/sqrt(p(1-p)(1/n_Z + 1/n_X)), p = (k_Z + k_X)/(n_Z + n_X); two-sided
p-value from the normal distribution. Verdict, at the 95 % level (|z| < 1.96):
    - "spy":       z >= 1.96 and the Wilson upper bound of q_Z is below q_X (Z is clean,
                   X is spoiled); confidence = 1 - p_value;
    - "noise":     |z| < 1.96 and the Wilson lower bound of q_Z is above 0 (errors
                   in both bases and no sign that they differ); confidence = p_value,
                   which is a COMPATIBILITY level (how well equal QBERs fit the data),
                   not a probability that "noise" is true;
    - "undecided": anything else (no errors seen, Z worse than X, or a mixed pattern).
The detector knows nothing about the hidden truth.

Error rates of the test (nominal, one-sided): under noise, z >= 1.96 happens with
probability 2.5 % (about 1 case in 40), so that is the false-"spy" rate; the test_mystery
accuracy test measures it at the UI's real shot counts (1000, 500 on IonQ). A spy is
missed ("noise" or "undecided") when the leak or the shot count is too small.

References:
    - Ekert (1991). Phys. Rev. Lett. 67:661; Bennett, Brassard, Mermin (1992).
    - Werner (1989). Phys. Rev. A 40:4277.
    - Wilson (1927). J. Am. Stat. Assoc. 22:209.
"""

from __future__ import annotations

import math
import secrets
from typing import Any

import numpy as np
from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister

from . import analysis as an
from .execute import circuit_report, run_batch, run_packed
from .qkd import build_qkd, theory_qkd

F_LO, F_HI = 0.80, 0.97  # fidelity range of both culprits
Z_CRIT = 1.96  # 95 % two-sided
KINDS = ("noise", "spy")
IDS = ("mystery_ZZ", "mystery_XX")
MAX_SEED = 2**31 - 1
N_QUBITS = 4  # A, B + 2 environment qubits (noise) or Eve + 1 idle qubit (spy)
BIT_ORDER = "Qiskit little-endian; clbits: 0=A, 1=B"


def draw_seed() -> int:
    """A fresh seed for the hidden culprit."""
    return secrets.randbelow(MAX_SEED + 1)


def draw_culprit(seed: int) -> dict[str, Any]:
    """The hidden truth for ``seed``: ``{kind, F, theta, theta_deg}`` (theta = 0 for noise).

    ``F`` is uniform in [F_LO, F_HI] for both kinds; for the spy,
    theta = 2 arccos(2F - 1) so that F = (1 + cos(theta/2))/2.
    """
    rng = np.random.default_rng(int(seed))
    kind = KINDS[int(rng.integers(0, 2))]
    F = float(rng.uniform(F_LO, F_HI))
    theta = 2.0 * math.acos(2.0 * F - 1.0) if kind == "spy" else 0.0
    return {"kind": kind, "F": F, "theta": theta, "theta_deg": math.degrees(theta)}


def _uniform(src: QuantumCircuit, name: str, drop_eve: bool) -> QuantumCircuit:
    """Copy ``src`` onto N_QUBITS qubits and a 2-bit ``out`` register (Eve's gates dropped if asked)."""
    qc = QuantumCircuit(QuantumRegister(N_QUBITS, "q"), ClassicalRegister(2, "out"), name=name,
                        metadata={"role": name[-2:]})
    for inst in src.data:
        qs = [src.find_bit(q).index for q in inst.qubits]
        if drop_eve and qs == [2]:  # Eve's Helstrom rotation and measurement
            continue
        qc.append(inst.operation, qs, [src.find_bit(c).index for c in inst.clbits])
    return qc


def build_mystery(truth: dict[str, Any]) -> list[QuantumCircuit]:
    """The ZZ and XX circuits of the hidden culprit, identical in width for both kinds."""
    spy = truth["kind"] == "spy"
    pair = build_qkd(theta=truth["theta"])[:2] if spy else build_qkd(F=truth["F"])[:2]
    return [_uniform(qc, name, spy) for qc, name in zip(pair, IDS)]


def _errors(counts: dict[str, int]) -> tuple[int, int]:
    """(k, n): shots with clbit 0 XOR clbit 1 equal to 1, and total shots."""
    c = an.correlator(counts, [0, 1])
    n = int(c["shots"])
    return int(round(n * (1.0 - c["value"]) / 2.0)), n


def _normal_two_sided_p(z: float) -> float:
    return math.erfc(abs(z) / math.sqrt(2.0))


def detect(kz: int, nz: int, kx: int, nx: int) -> dict[str, Any]:
    """Verdict "noise" / "spy" / "undecided" from error counts in Z and X (see module docs)."""
    if min(nz, nx) <= 0:
        return {"verdict": "undecided", "z": 0.0, "p_value": 1.0, "confidence": 0.0,
                "reason": "no_data", "alpha": 0.05}
    qz, qx = kz / nz, kx / nx
    pooled = (kz + kx) / (nz + nx)
    se = math.sqrt(pooled * (1.0 - pooled) * (1.0 / nz + 1.0 / nx))
    z = (qx - qz) / se if se > 0 else 0.0
    p = _normal_two_sided_p(z)
    z_lo, z_hi = an.wilson(kz, nz)
    if z >= Z_CRIT and z_hi < qx:
        verdict, conf, why = "spy", 1.0 - p, "z_clean_x_spoiled"
    elif abs(z) < Z_CRIT and z_lo > 0.0:
        verdict, conf, why = "noise", p, "z_equals_x"
    else:
        verdict, conf = "undecided", 0.0
        why = "no_errors" if kz == 0 and kx == 0 else "z_worse_than_x" if z <= -Z_CRIT else "mixed"
    return {"verdict": verdict, "z": z, "p_value": p, "confidence": conf, "reason": why,
            "alpha": 0.05, "statistic": "two-proportion z (QBER_X vs QBER_Z), pooled variance"}


def decode_mystery(counts_by_id: dict[str, dict[str, int]], truth: dict[str, Any]) -> dict[str, Any]:
    """Metrics (qber_Z, qber_X, fidelity with CI and theory) and the detector verdict."""
    th = theory_qkd(truth["theta"]) if truth["kind"] == "spy" else theory_qkd(F=truth["F"])
    zz = an.correlator(counts_by_id["mystery_ZZ"], [0, 1])
    xx = an.correlator(counts_by_id["mystery_XX"], [0, 1])
    q = lambda c: ((1 - c["value"]) / 2, [(1 - c["ci95"][1]) / 2, (1 - c["ci95"][0]) / 2])  # noqa: E731
    (qz, qz_ci), (qx, qx_ci) = q(zz), q(xx)
    f = (1.0 + zz["value"] + 2.0 * xx["value"]) / 4.0
    half = 1.96 * math.sqrt((an.ac_var(zz) + 4.0 * an.ac_var(xx)) / 16.0)
    metrics = {
        "qber_Z": an.metric(qz, qz_ci, th["qber_Z"]),
        "qber_X": an.metric(qx, qx_ci, th["qber_X"]),
        "fidelity": an.metric(f, [max(0.0, f - half), min(1.0, f + half)], th["F"],
                              method="(1 + ZZ + 2 XX)/4, assumes YY = -XX; normal CI on Agresti-Coull variances (not degenerate when q_Z = 0)"),
    }
    (kz, nz), (kx, nx) = _errors(counts_by_id["mystery_ZZ"]), _errors(counts_by_id["mystery_XX"])
    return {"metrics": metrics, "detector": detect(kz, nz, kx, nx)}


def run_mystery(
    backend: Any, seed: int, shots: int = 1000,
    before_run: Any = None, on_submit_error: Any = None, **run_options: Any,
) -> dict[str, Any]:
    """Draw the culprit, run its 2 circuits with ONE ``backend.run``; JSON contract.

    On IonQ the circuits go out packed in ONE circuit (``DoesNotFit`` is raised before
    ``before_run`` if the width is not enough). The result carries ``truth``; the UI
    reveals it only after the player guesses.
    """
    truth = draw_culprit(seed)
    circuits = build_mystery(truth)
    ionq = an.is_ionq(backend)
    if ionq:
        counts, compiled, _ = run_packed(backend, circuits, shots, before_run=before_run,
                                         on_submit_error=on_submit_error, **run_options)
    else:
        counts, compiled = run_batch(backend, circuits, shots, before_run=before_run, **run_options)
    dec = decode_mystery(counts, truth)
    th = {"kind": truth["kind"], "F": truth["F"]}
    if truth["kind"] == "spy":
        th.update(theta=truth["theta"], theta_deg=truth["theta_deg"], c=math.cos(truth["theta"] / 2.0))
    return an.make_result(
        "mystery", "batch" if ionq else "live", an.backend_name(backend), shots,
        {"seed": int(seed), "F_range": [F_LO, F_HI]}, BIT_ORDER,
        dec["metrics"], circuit_report(circuits, compiled), counts,
        viz={"detector": dec["detector"]},
    ) | {"truth": an.to_plain(th), "detector": an.to_plain(dec["detector"])}
