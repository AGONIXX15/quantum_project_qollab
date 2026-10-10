"""Level 3, noise = environment: a leaking link is a link someone listens to.

Werner channel by Stinespring dilation. Two environment qubits start in
|e(F)> = sqrt(F)|00> + sqrt((1-F)/3)(|01> + |10> + |11>) and couple to Bob's
half B with CX(env0 -> B) and CZ(env1 -> B). Tracing the environment out
leaves exactly the Werner state F|Phi+><Phi+| + (1-F)/3 (I - |Phi+><Phi+|),
whose correlators are <XX> = -<YY> = <ZZ> = (4F-1)/3. The environment qubits
are never measured: the lost information is the "listener".

Environment preparation (real 2-qubit state): Schmidt form, one RY + ONE CX
+ local real rotations (see ``env_prep``). Any 2-qubit pure state needs only 1
CX. The straightforward recipe (RY on env1, X-CRY-X and CRY on env0) costs 4
CX, a multiplexed-RY version costs 2 CX, and qiskit's StatePreparation
transpiled to [rx, ry, rz, cx] costs 1-2 CX depending on F; see
``env_prep_cx_counts`` (tests assert ours <= StatePreparation).

Modes:
    - "teaching": full Stinespring circuit, 4 CX per correlator circuit
      (Bell 1 + env prep 1 + CX + CZ).
    - "precision": the ideal Bell circuits (1 CX) run on the backend and the
      Pauli error of the channel is sampled classically per shot: an error
      P_err on B only flips B's outcome when P_err anticommutes with the
      measured basis (X flips YY, ZZ; Y flips XX, ZZ; Z flips XX, YY). The
      channel is therefore SIMULATED in Python, statistically equivalent to
      the dilation, but hardware noise only touches 1 CX instead of 4 and the
      circuits are shared by every F. It is not a separate physical device.

Statistics note: in precision mode every F reuses the SAME ideal counts, so
the confidence intervals across F values are correlated (not independent).

T1 option: ``apply_damping`` implements amplitude damping gamma on B with one
environment qubit (CRY(theta) B -> env, CX env -> B, sin^2(theta/2) = gamma).
On Phi+ its fidelity is F = (1 + sqrt(1-gamma))^2 / 4 (Kraus K0 =
diag(1, sqrt(1-gamma)), K1 = sqrt(gamma)|0><1|; only K0 overlaps Phi+).

Bit order: register ``m``, clbit 0 = A, clbit 1 = B (little-endian).

References:
    - Werner, R. F. (1989). Phys. Rev. A 40:4277.
    - Nielsen & Chuang, 8.2.3 (Stinespring/operator-sum dilation).
    - Shende, Bullock, Markov (2006). IEEE TCAD 25:1000 (state/gate synthesis).
    - Wallman & Emerson (2016). Phys. Rev. A 94:052325 (Pauli twirling, so a
      noisy channel acts as a probabilistic Pauli channel).
"""

from __future__ import annotations

import math
from typing import Any, Sequence

import numpy as np
from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister, transpile
from qiskit.quantum_info import Clifford, Pauli
from qiskit.circuit.library import StatePreparation

from . import analysis as an
from .execute import circuit_report, run_batch, safe_name
from .links import BASES, BIT_ORDER, build_link, rotate_to_basis

_NOTES = {
    "teaching": ["noise realized by environment qubits (Stinespring dilation) inside the circuit"],
    "precision": [
        "noise channel sampled in Python on top of ideal-circuit counts; "
        "hardware noise only from the 1-CX Bell circuit",
        "confidence intervals across F values are correlated (shared ideal counts)",
    ],
}
_CHANNEL = {"teaching": "environment_qubits", "precision": "simulated_pauli"}
DEFAULT_FS = (0.95, 0.8, 0.6)
# Which Paulis on B flip the outcome of a measurement in each basis.
_FLIPS = {"X": (0, 0, 1, 1), "Y": (0, 1, 0, 1), "Z": (0, 1, 1, 0)}  # I, X, Y, Z


def _real_rotation(o: np.ndarray) -> tuple[float, bool]:
    """Write a real orthogonal 2x2 as RY(angle) @ (Z if det < 0)."""
    flip = np.linalg.det(o) < 0
    if flip:
        o = o @ np.diag([1.0, -1.0])
    return 2.0 * math.atan2(o[1, 0], o[0, 0]), bool(flip)


def werner_probs(F: float) -> tuple[float, float, float, float]:
    """Pauli weights (p_I, p_X, p_Y, p_Z) of the Werner(F) channel."""
    q = (1.0 - F) / 3.0
    return (F, q, q, q)


def env_state_probs(p: Sequence[float]) -> np.ndarray:
    """Environment amplitudes for a Pauli channel p = (p_I, p_X, p_Y, p_Z).

    Index = env1*2 + env0: 00 -> I, env0=1 -> X (CX), env1=1 -> Z (CZ),
    both -> Y (up to a phase that the orthogonal env states make irrelevant).
    """
    pi, px, py, pz = (math.sqrt(max(float(v), 0.0)) for v in p)
    return np.array([pi, px, pz, py])


def env_state(F: float) -> np.ndarray:
    """Target amplitudes of |e(F)> in Qiskit order (index = env1*2 + env0)."""
    return env_state_probs(werner_probs(F))


def env_prep_probs(p: Sequence[float]) -> QuantumCircuit:
    """2-qubit circuit preparing the environment of a Pauli channel with 1 CX.

    Schmidt form: the amplitude matrix M[env1, env0] = U diag(s) V^T, so the
    state is (U x V)(s0|00> + s1|11>): one RY and one CX create the Schmidt
    pair, then local real rotations U (on env1) and V (on env0) finish it.
    """
    if abs(sum(p) - 1.0) > 1e-9 or min(p) < -1e-12:
        raise ValueError("p must be a probability vector")
    u, s, vt = np.linalg.svd(env_state_probs(p).reshape(2, 2))
    qc = QuantumCircuit(2, name="env_prep")
    qc.ry(2.0 * math.atan2(s[1], s[0]), 0)
    qc.cx(0, 1)
    for qubit, o in ((1, u), (0, vt.T)):
        angle, flip = _real_rotation(o)
        if flip:
            qc.z(qubit)
        qc.ry(angle, qubit)
    return qc


def env_prep(F: float) -> QuantumCircuit:
    """Environment preparation for the Werner(F) channel (1 CX)."""
    if not 0.0 <= F <= 1.0:
        raise ValueError("F must be in [0, 1]")
    return env_prep_probs(werner_probs(F))


def env_prep_cx_counts(F: float) -> dict[str, int]:
    """CX count after transpiling to [rx, ry, rz, cx]: ours vs StatePreparation."""
    basis = ["rx", "ry", "rz", "cx"]
    sp = QuantumCircuit(2)
    sp.append(StatePreparation(env_state(F)), [0, 1])
    out = {}
    for name, qc in (("schmidt", env_prep(F)), ("state_prep", sp)):
        t = transpile(qc, basis_gates=basis, optimization_level=3, seed_transpiler=0)
        out[name] = t.count_ops().get("cx", 0)
    return out


def apply_werner(qc: QuantumCircuit, b: Any, env0: Any, env1: Any, F: float) -> None:
    """Append the Werner(F) channel on qubit ``b`` using two env qubits."""
    qc.compose(env_prep(F), [env0, env1], inplace=True)
    qc.cx(env0, b)
    qc.cz(env1, b)


def apply_damping(qc: QuantumCircuit, b: Any, env: Any, gamma: float) -> None:
    """Append amplitude damping ``gamma`` on ``b`` (env must start in |0>)."""
    theta = 2.0 * math.asin(math.sqrt(gamma))
    qc.cry(theta, b, env)
    qc.cx(env, b)


# --------------------------------------------------------------------------
# Channel specs shared by levels 4-6. A spec is a plain dict:
#   {"kind": "werner", "F": F} | {"kind": "pauli", "p": (pI, pX, pY, pZ)}
#   | {"kind": "damping", "gamma": g}   (or None for a clean link)
# --------------------------------------------------------------------------

Spec = dict[str, Any] | None


def werner_spec(F: float) -> dict[str, Any]:
    return {"kind": "werner", "F": float(F)}


def pauli_spec(p: Sequence[float]) -> dict[str, Any]:
    return {"kind": "pauli", "p": tuple(float(v) for v in p)}


def damping_spec(gamma: float) -> dict[str, Any]:
    return {"kind": "damping", "gamma": float(gamma)}


def make_spec(
    F: float | None = None, gamma: float | None = None, p: Sequence[float] | None = None
) -> Spec:
    """Build a spec from flat keyword arguments (at most one may be given)."""
    given = [v is not None for v in (F, gamma, p)]
    if sum(given) > 1:
        raise ValueError("give only one of F, gamma, p")
    if F is not None:
        return werner_spec(F)
    if gamma is not None:
        return damping_spec(gamma)
    if p is not None:
        return pauli_spec(p)
    return None


def n_env(spec: Spec) -> int:
    """Environment qubits a spec needs in the teaching (circuit) mode."""
    if spec is None:
        return 0
    return 1 if spec["kind"] == "damping" else 2


def apply_channel(qc: QuantumCircuit, b: Any, env: Sequence[Any], spec: Spec) -> None:
    """Append the spec's channel on ``b`` using ``n_env(spec)`` env qubits."""
    if spec is None:
        return
    kind = spec["kind"]
    if kind == "werner":
        apply_werner(qc, b, env[0], env[1], spec["F"])
    elif kind == "pauli":
        qc.compose(env_prep_probs(spec["p"]), [env[0], env[1]], inplace=True)
        qc.cx(env[0], b)
        qc.cz(env[1], b)
    elif kind == "damping":
        apply_damping(qc, b, env[0], spec["gamma"])
    else:
        raise ValueError(f"unknown channel kind {kind!r}")


def pauli_probs(spec: Spec) -> tuple[float, float, float, float]:
    """Pauli weights of a Pauli-type spec (needed by the precision mode)."""
    if spec is None:
        return (1.0, 0.0, 0.0, 0.0)
    if spec["kind"] == "werner":
        return werner_probs(spec["F"])
    if spec["kind"] == "pauli":
        return tuple(spec["p"])  # type: ignore[return-value]
    raise ValueError("damping is not a Pauli channel; use the teaching mode")


def bell_diag_of(spec: Spec) -> tuple[float, float, float, float]:
    """Bell-diagonal weights of Phi+ through the channel (Pauli twirl for damping)."""
    if spec is None or spec["kind"] != "damping":
        return pauli_probs(spec)
    th = theory_damping(spec["gamma"])
    wrap = lambda v: {"value": v}  # noqa: E731
    return an.bell_diagonal(wrap(th["XX"]), wrap(th["YY"]), wrap(th["ZZ"]))


def spec_label(spec: Spec) -> str:
    """Short label for circuit names (sanitized later by safe_name)."""
    if spec is None:
        return "ideal"
    if spec["kind"] == "werner":
        return f"F{spec['F']:g}"
    if spec["kind"] == "damping":
        return f"g{spec['gamma']:g}"
    return "p" + "_".join(f"{v:g}" for v in spec["p"])


def build_pair(name: str, pair: str, spec: Spec) -> QuantumCircuit:
    """Bell pair + spec channel on B measured in ``pair`` (one tomography circuit)."""
    a, b = QuantumRegister(1, "A"), QuantumRegister(1, "B")
    regs = [a, b]
    env = QuantumRegister(n_env(spec), "env") if n_env(spec) else None
    if env is not None:
        regs.append(env)
    m = ClassicalRegister(2, "m")
    qc = QuantumCircuit(*regs, m, name=safe_name(name))
    qc.h(a[0])
    qc.cx(a[0], b[0])
    qc.barrier(label="channel")
    if env is not None:
        apply_channel(qc, b[0], list(env), spec)
    rotate_to_basis(qc, a[0], pair[0])
    rotate_to_basis(qc, b[0], pair[1])
    qc.measure(a[0], m[0])
    qc.measure(b[0], m[1])
    return qc


# --------------------------------------------------------------------------
# Precision-mode engine: sample the channel's Pauli error per shot in Python
# and propagate it through the (Clifford) rest of the circuit.
# --------------------------------------------------------------------------

def channel_tail(qc: QuantumCircuit) -> tuple[QuantumCircuit, dict[int, int]]:
    """Split a circuit at its ``channel`` barrier.

    Returns the unitary instructions after the barrier (as a circuit on the
    same qubit indices) and the map qubit index -> clbit index of its measures.
    """
    tail = QuantumCircuit(qc.num_qubits)
    meas: dict[int, int] = {}
    seen = False
    for inst in qc.data:
        op = inst.operation
        if op.name == "barrier":
            seen = seen or op.label == "channel"
            continue
        if not seen:
            continue
        idx = [qc.find_bit(q).index for q in inst.qubits]
        if op.name == "measure":
            meas[idx[0]] = qc.find_bit(inst.clbits[0]).index
        else:
            tail.append(op, idx)
    return tail, meas


def error_flip_masks(qc: QuantumCircuit, qubits: Sequence[int]) -> dict[int, list[int]]:
    """Per error qubit, the clbit-flip bitmask of I, X, Y, Z injected at the barrier.

    The error is propagated forward through the Clifford tail (U P U^dagger);
    a measured qubit's bit flips iff the propagated Pauli has an X component
    there. Masks of simultaneous errors combine by XOR.
    """
    if not any(i.operation.name == "barrier" and i.operation.label == "channel" for i in qc.data):
        raise ValueError("circuit has no 'channel' barrier")
    tail, meas = channel_tail(qc)
    if not meas:
        raise ValueError("no measured qubits after the channel barrier")
    try:
        cliff = Clifford(tail)
    except Exception as exc:  # noqa: BLE001 - qiskit raises QiskitError
        raise ValueError(f"the circuit after the channel is not Clifford: {exc}") from exc
    n = qc.num_qubits
    out: dict[int, list[int]] = {}
    for q in qubits:
        masks = []
        for xb, zb in ((0, 0), (1, 0), (1, 1), (0, 1)):  # I, X, Y, Z
            x = np.zeros(n, dtype=bool)
            z = np.zeros(n, dtype=bool)
            x[q], z[q] = bool(xb), bool(zb)
            ev = Pauli((z, x)).evolve(cliff, frame="s")
            masks.append(sum(1 << c for qm, c in meas.items() if ev.x[qm]))
        out[q] = masks
    return out


def apply_pauli_flips(
    counts: dict[str, int],
    n_clbits: int,
    masks: dict[int, list[int]],
    probs: dict[int, Sequence[float]],
    rng: np.random.Generator,
) -> dict[str, int]:
    """Sample independent Pauli errors per shot on the given qubits.

    ``masks``/``probs`` are keyed by error qubit (see ``error_flip_masks``).
    Each distinct outcome's shots are split multinomially over all error
    combinations (vectorized) and the outcome is XOR-flipped by the combined
    mask. Single classical register assumed (keys without spaces).
    """
    bits, w = an.bits_from_counts(counts, n_clbits)
    vals = (bits.astype(np.int64) << np.arange(n_clbits)).sum(axis=1)
    qs = list(masks)
    combo_p = np.ones(1)
    combo_m = np.zeros(1, dtype=np.int64)
    for q in qs:
        pq = np.asarray(probs[q], dtype=float)
        combo_p = (combo_p[:, None] * pq[None, :]).ravel()
        combo_m = (combo_m[:, None] ^ np.asarray(masks[q], dtype=np.int64)[None, :]).ravel()
    split = rng.multinomial(w, combo_p / combo_p.sum())  # [K, C]
    new_vals = vals[:, None] ^ combo_m[None, :]
    uniq, inv = np.unique(new_vals.ravel(), return_inverse=True)
    tot = np.bincount(inv.ravel(), weights=split.ravel()).astype(np.int64)
    return {format(int(v), f"0{n_clbits}b"): int(t) for v, t in zip(uniq, tot) if t}


def _fkey(F: float) -> str:
    return f"{F:g}"


def _check_Fs(Fs: Sequence[float]) -> None:
    """Reject F values whose formatted keys collide (they name circuits/metrics)."""
    keys = [_fkey(F) for F in Fs]
    if len(set(keys)) != len(keys):
        raise ValueError(f"duplicate or colliding F values: {list(Fs)}")


def _cname(F: float, pair: str) -> str:
    return safe_name(f"noise_F{_fkey(F)}_{pair}")


def _noisy_pair(name: str, pair: str, channel: str, param: float) -> QuantumCircuit:
    """Bell pair + channel on B, measured in basis ``pair`` (e.g. 'XX')."""
    a, b = QuantumRegister(1, "A"), QuantumRegister(1, "B")
    env = QuantumRegister(2, "env")
    m = ClassicalRegister(2, "m")
    qc = QuantumCircuit(a, b, env, m, name=name)
    qc.h(a[0])
    qc.cx(a[0], b[0])
    if channel == "werner":
        apply_werner(qc, b[0], env[0], env[1], param)
    elif channel == "damping":
        apply_damping(qc, b[0], env[0], param)
    else:
        raise ValueError(f"unknown channel {channel!r}")
    rotate_to_basis(qc, a[0], pair[0])
    rotate_to_basis(qc, b[0], pair[1])
    qc.measure(a[0], m[0])
    qc.measure(b[0], m[1])
    return qc


def build_noise(
    Fs: Sequence[float] = DEFAULT_FS, mode: str = "teaching"
) -> list[QuantumCircuit]:
    """Circuits for level 3. Teaching: 3 per F; precision: 3 shared by all F."""
    _check_Fs(Fs)
    if mode == "precision":
        return build_link("noise_ideal")
    if mode != "teaching":
        raise ValueError("mode must be 'teaching' or 'precision'")
    return [
        _noisy_pair(_cname(F, p), p, "werner", F)
        for F in Fs
        for p in BASES
    ]


def build_damping(gamma: float, prefix: str = "damp") -> list[QuantumCircuit]:
    """XX/YY/ZZ circuits of Phi+ after amplitude damping ``gamma`` on B."""
    return [_noisy_pair(f"{prefix}_{p}", p, "damping", gamma) for p in BASES]


def theory_werner(F: float) -> dict[str, float]:
    """Werner(F) correlators and fidelity."""
    c = (4.0 * F - 1.0) / 3.0
    return {"XX": c, "YY": -c, "ZZ": c, "F": F}


def theory_damping(gamma: float) -> dict[str, float]:
    """Amplitude-damped Phi+ correlators and fidelity (derived in the docstring)."""
    s = math.sqrt(1.0 - gamma)
    return {"XX": s, "YY": -s, "ZZ": 1.0 - gamma, "F": (1.0 + s) ** 2 / 4.0}


def pauli_error_counts(
    counts: dict[str, int], basis: str, F: float, rng: np.random.Generator
) -> dict[str, int]:
    """Apply a sampled Werner(F) Pauli error on B to ideal counts (precision mode).

    Each shot draws I/X/Y/Z with weights F, (1-F)/3 x3 (multinomial per
    distinct outcome); B's bit (clbit 1) flips when the error anticommutes with
    ``basis`` ('X', 'Y' or 'Z').
    """
    bits, w = an.bits_from_counts(counts, 2)
    p = np.array([F] + [(1.0 - F) / 3.0] * 3)
    split = rng.multinomial(w, p / p.sum())  # [K, 4]
    flipped = split @ np.array(_FLIPS[basis])  # shots whose B bit flips
    out: dict[str, int] = {}
    for row, (n_flip, n_all) in enumerate(zip(flipped, w)):
        for flip, n in ((0, n_all - n_flip), (1, n_flip)):
            if n:
                a_bit, b_bit = int(bits[row, 0]), int(bits[row, 1]) ^ flip
                key = f"{b_bit}{a_bit}"
                out[key] = out.get(key, 0) + int(n)
    return out


def decode_noise(
    counts_by_id: dict[str, dict[str, int]],
    Fs: Sequence[float] = DEFAULT_FS,
    mode: str = "teaching",
    seed: int = 0,
) -> dict[str, Any]:
    """Measured F versus configured F (with CI) and the viz payload."""
    _check_Fs(Fs)
    rng = np.random.default_rng(seed)
    metrics: dict[str, Any] = {}
    links, samples = {}, {}
    for F in Fs:
        per_basis = {}
        for p in BASES:
            if mode == "precision":
                ideal = counts_by_id[f"noise_ideal_{p}"]
                per_basis[p] = pauli_error_counts(ideal, p[0], F, rng)
            else:
                per_basis[p] = counts_by_id[_cname(F, p)]
        corr = {p: an.correlator(c, [0, 1]) for p, c in per_basis.items()}
        fid = an.bell_fidelity(corr["XX"], corr["YY"], corr["ZZ"])
        key = _fkey(F)
        metrics[f"fidelity@{key}"] = an.metric(
            fid["value"], fid["ci95"], F, raw=fid["raw"], configured=F
        )
        th = theory_werner(F)
        for p, c in corr.items():
            metrics[f"corr_{p}@{key}"] = an.metric(c["value"], c["ci95"], th[p])
        links[key] = {"F": fid["value"], "ci95": fid["ci95"]}
        samples[key] = an.sample_parity(per_basis["ZZ"], [0, 1], seed=seed)
    viz = {
        "samples": samples,
        "leak": {
            "by_F": {_fkey(F): 1.0 - F for F in Fs},
            "source": "simulated" if mode == "precision" else "circuit",
        },
        "notes": list(_NOTES[mode]),
        "links": links,
        "bloch": {"theory": [0.0, 0.0, 0.0]},
    }
    return {"metrics": metrics, "viz": viz}


def run_noise(
    backend: Any,
    shots: int = 1000,
    Fs: Sequence[float] = DEFAULT_FS,
    mode: str = "teaching",
    seed: int = 0,
    **run_options: Any,
) -> dict[str, Any]:
    """Run level 3 with a single ``backend.run``; returns the JSON contract."""
    circuits = build_noise(Fs, mode)
    counts, compiled = run_batch(backend, circuits, shots, **run_options)
    dec = decode_noise(counts, Fs, mode, seed)
    dec["viz"]["steps"] = {qc.name: an.circuit_steps(qc) for qc in circuits}
    return an.make_result(
        "noise", "live", an.backend_name(backend), shots,
        {"Fs": list(Fs), "mode": mode, "channel": _CHANNEL[mode]}, BIT_ORDER, dec["metrics"],
        circuit_report(circuits, compiled), counts, viz=dec["viz"],
    )
