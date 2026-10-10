"""Statistics, decoding and result-packaging helpers shared by every level.

All functions are pure and NumPy-vectorized (no per-shot Python loops) so they
stay fast inside Pyodide. Counts follow Qiskit's little-endian convention:
the rightmost character of a bitstring is classical bit 0.

References:
    - Wilson, E. B. (1927). Probable inference, the law of succession, and
      statistical inference. JASA 22(158):209-212 (score interval).
    - Bennett, DiVincenzo, Smolin, Wootters (1996). Mixed-state entanglement
      and quantum error correction. Phys. Rev. A 54:3824 (Bell-diagonal
      states, fidelity from correlators).
    - Shor, P. W. & Preskill, J. (2000). Simple proof of security of the BB84
      quantum key distribution protocol. Phys. Rev. Lett. 85:441 (r = 1 - 2h(Q)).
    - Agresti, A. & Coull, B. A. (1998). Approximate is better than "exact"
      for interval estimation of binomial proportions. Am. Stat. 52:119.
    - Qiskit bit ordering: https://quantum.cloud.ibm.com/docs/guides/bit-ordering
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Iterable, Sequence

import numpy as np
from numpy.typing import NDArray

Counts = dict[str, int]
Metric = dict[str, Any]


# --------------------------------------------------------------------------
# Bit-order helpers
# --------------------------------------------------------------------------

def _key_to_int(key: str) -> int:
    """Parse a counts key: binary (spaces allowed) or hex ('0x3')."""
    k = key.replace(" ", "")
    if k.lower().startswith("0x"):
        return int(k, 16)
    return int(k, 2)


def bits_from_counts(
    counts: Counts, n_clbits: int
) -> tuple[NDArray[np.uint8], NDArray[np.int64]]:
    """Parse counts once into a bit matrix and per-row weights.

    Multi-register keys are space-separated with the FIRST register added to
    the circuit rightmost; stripping spaces yields one little-endian string.

    Returns ``(bits, weights)`` with ``bits`` of shape [K, n_clbits] where
    column ``j`` is classical bit ``j`` (the rightmost character of the key),
    and ``weights`` the number of shots of each distinct outcome.
    """
    keys = list(counts)
    values = np.array([_key_to_int(k) for k in keys], dtype=np.int64)
    weights = np.array([int(counts[k]) for k in keys], dtype=np.int64)
    shifts = np.arange(n_clbits, dtype=np.int64)
    bits = ((values[:, None] >> shifts[None, :]) & 1).astype(np.uint8)
    return bits, weights


def parity(bits: NDArray[np.uint8], indices: Iterable[int]) -> NDArray[np.uint8]:
    """XOR of the selected columns of a bit matrix (one value per row)."""
    idx = list(indices)
    if not idx:
        return np.zeros(bits.shape[0], dtype=np.uint8)
    return np.bitwise_xor.reduce(bits[:, idx], axis=1)


# --------------------------------------------------------------------------
# Confidence intervals
# --------------------------------------------------------------------------

def wilson(k: float, n: float, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval for a binomial proportion k/n (n=0 gives [0, 1])."""
    if n <= 0:
        return 0.0, 1.0
    p = k / n
    z2 = z * z
    denom = 1.0 + z2 / n
    centre = (p + z2 / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def normal_ci(p: float, n: float, z: float = 1.96) -> tuple[float, float]:
    """Normal-approximation interval p +/- z*sqrt(p(1-p)/n), clipped to [0, 1]."""
    if n <= 0:
        return 0.0, 1.0
    half = z * math.sqrt(max(p * (1 - p), 0.0) / n)
    return max(0.0, p - half), min(1.0, p + half)


# --------------------------------------------------------------------------
# Correlators
# --------------------------------------------------------------------------

def correlator(
    counts: Counts,
    indices: Sequence[int],
    flips: Sequence[int] | None = None,
    postselect: Sequence[tuple[int, int]] | None = None,
) -> Metric:
    """Estimate <PP> = 1 - 2q from the parity of the selected clbits.

    q is the fraction of (accepted) shots where the XOR of ``indices`` and of
    the optional ``flips`` clbits equals 1; ``flips`` implements Pauli-frame
    correction. ``postselect`` is a list of ``(i, j)`` pairs; only shots with
    bit i == bit j for every pair are kept.

    Returns ``{value, var, ci95, shots}`` where ``var = 4q(1-q)/N`` and ci95
    is the Wilson interval on q mapped to the correlator. When postselecting,
    also returns ``accepted``, ``total``, ``p_s`` and ``p_s_ci95``.
    """
    all_idx = list(indices) + list(flips or [])
    ps_idx = [i for pair in (postselect or []) for i in pair]
    n_bits = max(all_idx + ps_idx + [0]) + 1
    bits, w = bits_from_counts(counts, n_bits)
    total = int(w.sum())

    if postselect:
        keep = np.ones(bits.shape[0], dtype=bool)
        for i, j in postselect:
            keep &= bits[:, i] == bits[:, j]
        bits, w = bits[keep], w[keep]
    n = int(w.sum())

    odd = parity(bits, all_idx).astype(bool)
    q = float(w[odd].sum() / n) if n > 0 else 0.5
    lo, hi = wilson(float(w[odd].sum()), n)
    out: Metric = {
        "empty": n == 0,
        "value": 1.0 - 2.0 * q,
        "var": 4.0 * q * (1.0 - q) / n if n > 0 else 1.0,
        "ci95": [1.0 - 2.0 * hi, 1.0 - 2.0 * lo],
        "shots": n,
    }
    if postselect:
        p_lo, p_hi = wilson(n, total)
        out.update(
            accepted=n,
            total=total,
            p_s=n / total if total else 0.0,
            p_s_ci95=[p_lo, p_hi],
        )
    return out


# --------------------------------------------------------------------------
# Bell-state figures of merit
# --------------------------------------------------------------------------

def ac_var(c: Metric) -> float:
    """Agresti-Coull variance of a correlator dict (falls back to c['var'])."""
    n = c.get("shots")
    if not n:
        return float(c["var"])
    k = n * (1.0 - c["value"]) / 2.0
    q = (k + 2.0) / (n + 4.0)
    return 4.0 * q * (1.0 - q) / (n + 4.0)


def bell_fidelity(xx: Metric, yy: Metric, zz: Metric) -> Metric:
    """Fidelity with Phi+ from correlators: F = (1 + XX - YY + ZZ) / 4.

    ``value`` is the raw estimate clipped to [0, 1] (unclipped in ``raw``).
    For the CI, each correlator variance uses the Agresti-Coull plug-in
    q~ = (k+2)/(N+4) (Agresti & Coull 1998), so it never collapses to 0 when
    q is 0 or 1; var = (var_XX + var_YY + var_ZZ) / 16 with
    var_P = 4 q~(1-q~)/(N+4). Correlators without ``shots`` keep their ``var``.
    """
    raw = (1.0 + xx["value"] - yy["value"] + zz["value"]) / 4.0
    var = sum(ac_var(c) for c in (xx, yy, zz)) / 16.0
    half = 1.96 * math.sqrt(var)
    clip = lambda x: min(1.0, max(0.0, x))  # noqa: E731
    return {
        "value": clip(raw),
        "raw": raw,
        "var": var,
        "ci95": [clip(raw - half), clip(raw + half)],
    }


def bell_diagonal(xx: Metric, yy: Metric, zz: Metric) -> tuple[float, float, float, float]:
    """Bell-diagonal weights (p_I, p_X, p_Y, p_Z), Phi+ convention.

    Ideal Phi+ has <XX>=1, <YY>=-1, <ZZ>=1. Values are raw estimates (may be
    slightly outside [0, 1] from shot noise) and always sum to 1.
    """
    x, y, z = xx["value"], yy["value"], zz["value"]
    return (
        (1 + x - y + z) / 4,
        (1 + x + y - z) / 4,
        (1 - x - y - z) / 4,
        (1 - x + y + z) / 4,
    )


def correlators_from_bell_diagonal(p: Sequence[float]) -> tuple[float, float, float]:
    """(<XX>, <YY>, <ZZ>) of a Bell-diagonal state with weights (p_I, p_X, p_Y, p_Z).

    Inverse of ``bell_diagonal``: Phi+ = (1,-1,1), Psi+ (X error) = (1,1,-1),
    Psi- (Y error) = (-1,-1,-1), Phi- (Z error) = (-1,1,1).
    """
    pi, px, py, pz = p
    return (
        pi + px - py - pz,
        -pi + px - py + pz,
        pi - px - py + pz,
    )


# --------------------------------------------------------------------------
# Key rates
# --------------------------------------------------------------------------

def binary_entropy(q: float) -> float:
    """Binary Shannon entropy h(q) in bits; h(0) = h(1) = 0.

    Raises ValueError for NaN or q outside [-1e-12, 1+1e-12]; tiny float
    error inside that tolerance is clipped to [0, 1].
    """
    if math.isnan(q) or q < -1e-12 or q > 1.0 + 1e-12:
        raise ValueError(f"probability out of range: {q}")
    q = min(1.0, max(0.0, q))
    if q <= 0.0 or q >= 1.0:
        return 0.0
    return -q * math.log2(q) - (1 - q) * math.log2(1 - q)


def key_rate_bb84(q: float) -> float:
    """Asymptotic Shor-Preskill rate max(0, 1 - 2h(Q)) for a symmetric QBER."""
    return max(0.0, 1.0 - 2.0 * binary_entropy(q))


def key_rate_per_basis(qz: float, qx: float) -> float:
    """Asymmetric rate max(0, 1 - h(Q_Z) - h(Q_X)) with per-basis QBERs."""
    return max(0.0, 1.0 - binary_entropy(qz) - binary_entropy(qx))


# --------------------------------------------------------------------------
# Result packaging
# --------------------------------------------------------------------------

def _plain(obj: Any) -> Any:
    """Recursively convert NumPy scalars/arrays and tuples to plain JSON types."""
    if isinstance(obj, dict):
        return {str(k): _plain(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_plain(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return _plain(obj.tolist())
    if isinstance(obj, np.generic):
        return _plain(obj.item())
    if isinstance(obj, float) and not math.isfinite(obj):
        return None
    return obj


def metric(
    value: float, ci95: Sequence[float], theory: float | None = None, **extra: Any
) -> Metric:
    """Build a metric entry: value, 95 % CI, optional theory plus extras."""
    out: Metric = {"value": value, "ci95": list(ci95), "theory": theory}
    out.update(extra)
    return _plain(out)


def make_result(
    level: str,
    mode: str,
    backend_name: str,
    shots: int,
    params: dict[str, Any],
    bit_order: str,
    metrics: dict[str, Any],
    circuits: list[dict[str, Any]],
    counts: dict[str, Counts],
    viz: dict[str, Any] | None = None,
    timestamp: str | None = None,
) -> dict[str, Any]:
    """Assemble the Python -> JS JSON contract (plain JSON types only).

    Keys: level, mode, backend, timestamp, shots, params, bit_order, metrics,
    circuits, counts, plus the optional ``viz`` (visualization payload for the
    3D/2.5D UI, omitted when None). ``timestamp`` defaults to now (ISO-8601
    UTC); pass it explicitly to preserve the date of a recorded run.
    """
    result: dict[str, Any] = {
        "level": level,
        "mode": mode,
        "backend": backend_name,
        "timestamp": timestamp
        or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "shots": shots,
        "params": params,
        "bit_order": bit_order,
        "metrics": metrics,
        "circuits": circuits,
        "counts": counts,
    }
    if viz is not None:
        result["viz"] = viz
    return _plain(result)


# --------------------------------------------------------------------------
# Circuit / backend helpers
# --------------------------------------------------------------------------

def circuit_info(qc: Any) -> dict[str, Any]:
    """Summarize a QuantumCircuit: name, qubits, depth, multi-qubit gate count.

    Pre-transpile: counts instructions acting on >= 2 qubits (barrier and
    measure excluded) as written, not after basis-gate decomposition.
    """
    two_q = sum(
        1
        for inst in qc.data
        if len(inst.qubits) >= 2 and inst.operation.name not in ("barrier", "measure")
    )
    return {
        "id": qc.name,
        "qubits": qc.num_qubits,
        "depth": qc.depth(),
        "two_qubit_gates": two_q,
    }


def is_ionq(backend: Any) -> bool:
    """True for qiskit-ionq backends (by module or by name)."""
    return type(backend).__module__.startswith("qiskit_ionq") or "ionq" in (
        backend_name(backend).lower()
    )


def backend_name(backend: Any) -> str:
    """Backend name whether ``name`` is an attribute or a method (v1/v2 API)."""
    name = getattr(backend, "name", None)
    if callable(name):
        name = name()
    return str(name) if name else type(backend).__name__


# --------------------------------------------------------------------------
# Visualization payload helpers
# --------------------------------------------------------------------------

def sample_parity(
    counts: Counts,
    indices: Sequence[int],
    flips: Sequence[int] | None = None,
    k: int = 40,
    seed: int = 0,
    postselect: Sequence[tuple[int, int]] | None = None,
) -> list[int]:
    """Draw ``k`` individual shots (reproducibly) and return their parity bits.

    The parity covers ``indices`` XOR ``flips`` (Pauli-frame corrected), so the
    UI can animate photons that arrive "equal" (0) or "different" (1). With a
    single index and flips it is just one corrected bit. ``postselect`` keeps
    only shots with bit i == bit j for every pair. The draws are an
    i.i.d. resample of the counts for animation, NOT the real shot order.
    """
    all_idx = list(indices) + list(flips or [])
    if not counts:
        return []
    ps_idx = [i for pair in (postselect or []) for i in pair]
    bits, w = bits_from_counts(counts, max(all_idx + ps_idx + [0]) + 1)
    if postselect:
        keep = np.ones(bits.shape[0], dtype=bool)
        for i, j in postselect:
            keep &= bits[:, i] == bits[:, j]
        bits, w = bits[keep], w[keep]
        if w.sum() == 0:
            return []
    rng = np.random.default_rng(seed)
    rows = rng.choice(bits.shape[0], size=min(k, int(w.sum())), p=w / w.sum())
    return [int(v) for v in parity(bits[rows], all_idx)]


def circuit_steps(qc: Any) -> list[dict[str, Any]]:
    """Serialize ``qc.data`` as a gate list: ``{name, qubits, clbits, params}``.

    Barriers are skipped. Parameters are plain floats where numeric.
    """
    steps = []
    for inst in qc.data:
        op = inst.operation
        if op.name == "barrier":
            continue
        params = []
        for p in op.params:
            try:
                params.append(float(p))
            except (TypeError, ValueError):
                params.append(str(p))
        steps.append(
            {
                "name": op.name,
                "qubits": [qc.find_bit(q).index for q in inst.qubits],
                "clbits": [qc.find_bit(c).index for c in inst.clbits],
                "params": params,
            }
        )
    return steps
