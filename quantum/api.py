"""JS-facing facade: one simple function per level, plain-dict results.

Every function that runs circuits takes ``backend`` as an argument (Qollab
creates it; this module never creates or fixes one). Each returns a dict:
``{"ok": True, ...result}`` or ``{"ok": False, "error": "..."}`` so the UI
never hangs on an exception. Angles in this API are DEGREES.

IonQ allows one job per run, so on an IonQ backend the single-level functions
refuse with the stable error code ``ionq_use_full_batch`` (a click would burn
the job); ``full_batch`` sends every circuit in a single ``backend.run`` and
``rescue`` (one ``backend.run``, at most 16 circuits) is allowed as a
single-job alternative. ``decode_only`` re-decodes saved counts offline.

``run_level`` is the recommended UI entry point: on a simulator it runs the
level directly; on IonQ it runs ``full_batch`` once, caches it, and serves every
level from the cache (one job per Python execution; later IonQ jobs are refused
with the code ``ionq_job_used``).

From JS: ``import * as api from 'quantum.api'`` and call with
``.callPromisingKwargs({...})`` then ``.toJs()``.

References:
    - Qollab JS projects: https://qollab.xyz/learn/docs/js-qiskit-projects
    - Qollab compute backends: https://qollab.xyz/learn/docs/compute-backends
"""

from __future__ import annotations

import functools
import json
import math
from typing import Any, Callable

from . import analysis as an
from . import validate as V
from . import batch, geo, links, noise, purify, qkd, swap, teleport
from . import rescue as _rescue

VERSION = "0.1.0"
ATTRIBUTION = "This effort is supported by Qollab & IonQ."
IONQ_CODE = "ionq_use_full_batch"
IONQ_MESSAGE = "IonQ allows one job per run: use full_batch"
IONQ_USED_CODE = "ionq_job_used"
IONQ_USED_MESSAGE = ("IonQ allows one job per run; results above come from that job. "
                     "Press Run again to start a new job.")
RUN_LEVELS = ("link", "teleport", "noise", "swap", "purify", "qkd", "rescue")
_D = batch.DEFAULT_PARAMS  # single source of truth for every default below

_PRECISION_PURIFY_F = 0.8  # default channel of purify in precision mode

# One IonQ job per Python execution: set right before backend.run is attempted.
_IONQ_JOB_USED = False
_IONQ_CACHE: dict[str, Any] | None = None


def _reset_ionq_state() -> None:
    """Forget the IonQ job flag and cache (tests only)."""
    global _IONQ_JOB_USED, _IONQ_CACHE
    _IONQ_JOB_USED = False
    _IONQ_CACHE = None


def _cache_summary() -> dict[str, Any] | None:
    """Slim view of the cached IonQ job (level ok flags, backend, timestamp)."""
    c = _IONQ_CACHE
    if not c:
        return None
    return {"backend": c.get("backend"), "timestamp": c.get("timestamp"), "shots": c.get("shots"),
            "levels": {k: bool(v.get("ok")) for k, v in (c.get("levels") or {}).items()}}


def _ionq_used() -> dict[str, Any]:
    return {"ok": False, "code": IONQ_USED_CODE, "error": IONQ_USED_MESSAGE, "cached": _cache_summary()}


def backend_diag(backend: Any) -> dict[str, Any]:
    """Describe the backend object and the IonQ job flag (diagnostics; never raises)."""
    try:
        return {"ok": True, "module": type(backend).__module__, "name": str(getattr(backend, "name", None)),
                "is_ionq": bool(an.is_ionq(backend)), "ionq_job_used": _IONQ_JOB_USED}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

_py, _num, _shots, _choice, _spec_args = (
    V.py, V.num, V.shots, V.choice, V.spec_args)


def _guard(needs_backend: bool = True, ionq_ok: bool = False) -> Callable:
    """Wrap an API function: refuse IonQ if needed, catch everything."""
    def deco(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> dict[str, Any]:
            try:
                backend = args[0] if args else kwargs.get("backend")
                if needs_backend:
                    if backend is None:
                        raise ValueError("a backend is required")
                    if an.is_ionq(backend) and not ionq_ok:
                        return {"ok": False, "error": IONQ_MESSAGE, "code": IONQ_CODE}
                out = fn(*args, **kwargs)
                return {"ok": True, **an.to_plain(out)}
            except Exception as exc:  # noqa: BLE001 - the UI must never hang
                msg = str(exc) if isinstance(exc, ValueError) else f"{type(exc).__name__}: {exc}"
                return {"ok": False, "error": msg}
        return wrapper
    return deco


# --------------------------------------------------------------------------
# Info
# --------------------------------------------------------------------------

def _p(lo, hi, default, unit=""):
    return {"min": lo, "max": hi, "default": default, "unit": unit}


def info() -> dict[str, Any]:
    """Static description of the game: levels, parameter ranges, geography.

    Defaults come from ``batch.DEFAULT_PARAMS`` (single source of truth).
    """
    d = batch.DEFAULT_PARAMS
    shots = _p(10, 20000, 1000)
    modes = {"options": ["teaching", "precision"]}
    levels = [
        {"id": "link", "title": "First link", "function": "level_link",
         "summary": "Bell pair measured in X, Y, Z: F from three correlators.",
         "params": {"shots": shots}},
        {"id": "teleport", "title": "Teleportation", "function": "level_teleport",
         "summary": "Teleport a qubit over a (noisy) link; Pauli frame in Python.",
         "params": {"shots": shots, "theta_deg": _p(0, 180, d["teleport"]["theta_deg"], "deg"),
                    "phi_deg": _p(-360, 360, d["teleport"]["phi_deg"], "deg"),
                    "F": _p(0.25, 1, d["teleport"]["F"])}},
        {"id": "noise", "title": "Noise is someone listening", "function": "level_noise",
         "summary": "Werner noise from environment qubits: measured F vs configured F.",
         "params": {"shots": shots, "Fs": {"default": d["noise"]["Fs"], "min": 0.25, "max": 1, "length": [1, 5]},
                    "mode": {**modes, "default": d["noise"]["mode"]}}},
        {"id": "swap", "title": "Repeater (swapping)", "function": "level_swap",
         "summary": "Join two links with a Bell measurement; F = F1 F2 + (1-F1)(1-F2)/3.",
         "params": {"shots": shots, "F1": _p(0.25, 1, d["swap"]["F1"]), "F2": _p(0.25, 1, d["swap"]["F2"]),
                    "mode": {**modes, "default": d["swap"]["mode"]}}},
        {"id": "purify", "title": "Distillation", "function": "level_purify",
         "summary": "DEJMPS, fixed vs adaptive. Give at most one of F, gamma or p "
                    "(none: the default channel, gamma).",
         "params": {"shots": shots, "F": _p(0.25, 1, None), "gamma": _p(0, 1, d["purify"]["gamma"]),
                    "p": {"default": None, "length": 4},
                    "strategy": {"options": ["all", "predicted"], "default": d["purify"]["strategy"]},
                    "mode": {**modes, "default": d["purify"]["mode"]}}},
        {"id": "qkd", "title": "Catch the spy", "function": "level_qkd",
         "summary": "E91/BBM92 with a spy: QBER, CHSH, key rate.",
         "params": {"shots": shots, "theta_deg": _p(0, 180, d["qkd"]["theta_deg"], "deg"),
                    "F": _p(0.25, 1, None), "smart_direct": {"default": d["qkd"]["smart_direct"]},
                    "beta_source": {"options": ["split", "oracle"], "default": d["qkd"]["beta_source"]}}},
        {"id": "rescue", "title": "Save the Quantum Network", "function": "rescue",
         "summary": "Repair a damaged link: direct, reroute or purify (one job, IonQ allowed).",
         "params": {"shots": shots, "broken": {"options": list(geo.LINK_IDS), "default": d["rescue"]["broken"]},
                    "damage_kind": {"options": ["werner", "damping", "spy"], "default": d["rescue"]["damage"]["kind"]},
                    "damage_F": _p(0.25, 1, d["rescue"]["damage"].get("F", 0.7)),
                    "damage_gamma": _p(0, 1, 0.2), "damage_theta_deg": _p(0, 180, 180, "deg"),
                    "healthy_F": _p(0.25, 1, d["rescue"]["healthy_F"]),
                    "target_F": _p(0.3, 1, d["rescue"]["target_F"]),
                    "mode": {**modes, "default": d["rescue"]["mode"]}}},
    ]
    return {
        "ok": True, "version": VERSION, "attribution": ATTRIBUTION, "levels": levels,
        "run_level": {"function": "run_level", "levels": list(RUN_LEVELS),
                      "summary": "Recommended UI entry point: run_level(backend, level, **params). "
                                 "Simulators run the level live; IonQ runs one cached full_batch."},
        "full_batch": {
            "function": "full_batch", "recommended_entry": "run_level", "max_circuits": batch.MAX_BATCH,
            "default_shots": 1000, "ionq_shots": 500,
            "params_schema": "dict level -> dict of that level's parameters; angles in degrees; "
                             "unknown keys are rejected; all values validated before anything runs",
            "default_params": d,
        },
        "decode_only": {"function": "decode_only", "levels": list(batch.DECODED_LEVELS)},
        "geo": geo.geo_info(),
    }


# --------------------------------------------------------------------------
# Levels
# --------------------------------------------------------------------------

@_guard()
def level_link(backend: Any, shots: int = 1000, seed: int = 0) -> dict[str, Any]:
    return links.run_link(backend, _shots(shots), seed=int(seed))


@_guard()
def level_teleport(
    backend: Any, shots: int = 1000, theta_deg: float = _D["teleport"]["theta_deg"],
    phi_deg: float = _D["teleport"]["phi_deg"], F: float | None = _D["teleport"]["F"], seed: int = 0,
) -> dict[str, Any]:
    return teleport.run_teleport(
        backend, _shots(shots), math.radians(_num("theta_deg", theta_deg, 0, 180)),
        math.radians(_num("phi_deg", phi_deg, -360, 360)),
        None if F is None else _num("F", F, 0.25, 1.0), seed=int(seed),
    )


@_guard()
def level_noise(
    backend: Any, shots: int = 1000, Fs: Any = tuple(_D["noise"]["Fs"]),
    mode: str = _D["noise"]["mode"], seed: int = 0,
) -> dict[str, Any]:
    fs = V.f_list("F", Fs)
    mode = _choice("mode", mode, ("teaching", "precision"))
    return noise.run_noise(backend, _shots(shots), fs, mode, int(seed))


@_guard()
def level_swap(
    backend: Any, shots: int = 1000, F1: float = _D["swap"]["F1"],
    F2: float = _D["swap"]["F2"], mode: str = _D["swap"]["mode"], seed: int = 0,
) -> dict[str, Any]:
    return swap.run_swap(
        backend, _shots(shots), _num("F1", F1, 0.25, 1.0), _num("F2", F2, 0.25, 1.0),
        _choice("mode", mode, ("teaching", "precision")), int(seed),
    )


@_guard()
def level_purify(
    backend: Any, shots: int = 1000, F: float | None = None, gamma: float | None = None,
    p: Any = None, strategy: str = _D["purify"]["strategy"], mode: str = _D["purify"]["mode"],
    seed: int = 0,
) -> dict[str, Any]:
    """Channel choice: ``p`` > ``F`` > ``gamma``.

    A given ``F`` or ``p`` overrides ``gamma`` (so the advertised default
    gamma never conflicts). Giving both ``F`` and ``p`` is an error. With no
    channel: ``gamma`` 0.2 in teaching mode, ``F`` 0.8 in precision mode (which
    only supports Pauli channels).
    """
    mode = _choice("mode", mode, ("teaching", "precision"))
    if F is not None or p is not None:
        gamma = None
    elif gamma is None:
        if mode == "precision":
            F = _PRECISION_PURIFY_F
        else:
            gamma = _D["purify"]["gamma"]
    spec = _spec_args(F, gamma, p)
    if mode == "precision" and "gamma" in spec:
        raise ValueError("precision mode only supports Pauli channels (F or p); use teaching for gamma")
    return purify.run_purify(
        backend, _shots(shots), strategy=_choice("strategy", strategy, ("all", "predicted")),
        mode=mode, seed=int(seed), **spec,
    )


@_guard()
def level_qkd(
    backend: Any, shots: int = 1000, theta_deg: float = _D["qkd"]["theta_deg"], F: float | None = None,
    smart_direct: bool = _D["qkd"]["smart_direct"], beta_source: str = _D["qkd"]["beta_source"], seed: int = 0,
) -> dict[str, Any]:
    theta = math.radians(_num("theta_deg", theta_deg, 0, 180))
    if F is not None and theta != 0.0:
        raise ValueError("use either a spy (theta_deg) or Werner noise (F), not both")
    return qkd.run_qkd(
        backend, _shots(shots), theta, None if F is None else _num("F", F, 0.25, 1.0),
        bool(smart_direct), int(seed), _choice("beta_source", beta_source, ("split", "oracle")),
    )


@_guard(ionq_ok=True)
def rescue(
    backend: Any, shots: int = 1000, broken: str = _D["rescue"]["broken"],
    damage_kind: str = _D["rescue"]["damage"]["kind"], damage_F: float = _D["rescue"]["damage"]["F"],
    damage_gamma: float = 0.2, damage_theta_deg: float = 180.0,
    healthy_F: float = _D["rescue"]["healthy_F"], target_F: float = _D["rescue"]["target_F"],
    mode: str = _D["rescue"]["mode"], seed: int = 0,
) -> dict[str, Any]:
    kind = _choice("damage_kind", damage_kind, ("werner", "damping", "spy"))
    damage = {"kind": kind}
    if kind == "werner":
        damage["F"] = _num("damage_F", damage_F, 0.25, 1.0)
    elif kind == "damping":
        damage["gamma"] = _num("damage_gamma", damage_gamma, 0.0, 1.0)
    else:
        damage["theta"] = math.radians(_num("damage_theta_deg", damage_theta_deg, 0, 180))
    args = (
        _shots(shots), geo.normalize_link(broken), damage,
        _num("healthy_F", healthy_F, 0.25, 1.0), _num("target_F", target_F, 0.3, 1.0),
        _choice("mode", mode, ("teaching", "precision")), int(seed),
    )
    if an.is_ionq(backend):
        if _IONQ_JOB_USED:
            return _ionq_used()
        return _rescue.run_rescue(backend, *args, before_run=_mark_ionq_used)
    return _rescue.run_rescue(backend, *args)


def _mark_ionq_used() -> None:
    global _IONQ_JOB_USED
    _IONQ_JOB_USED = True


def _run_batch_once(backend: Any, shots: int | None, seed: int, params: Any) -> dict[str, Any]:
    """``batch.run_full_batch`` with the IonQ one-job guard and cache (plain dict result)."""
    global _IONQ_CACHE
    n = None if shots is None else _shots(shots)
    ionq = an.is_ionq(backend)
    if ionq:
        if _IONQ_JOB_USED:
            return _ionq_used()
        batch.resolve_params(_py(params))  # validate first: a typo must not burn the job
        # the flag is set right before backend.run (compile errors do not burn the job)
        out = an.to_plain(batch.run_full_batch(backend, n, int(seed), _py(params),
                                               before_run=_mark_ionq_used))
    else:
        out = an.to_plain(batch.run_full_batch(backend, n, int(seed), _py(params)))
    if ionq:
        _IONQ_CACHE = out
    return out


@_guard(ionq_ok=True)
def full_batch(
    backend: Any, shots: int | None = None, seed: int = 0, params: Any = None,
) -> dict[str, Any]:
    """Whole experiment in ONE job (allowed on IonQ once per execution; validates every parameter first)."""
    return _run_batch_once(backend, shots, seed, params)


def _batch_params(level: str, p: dict[str, Any]) -> dict[str, Any]:
    """Map the flat API arguments of one level to ``full_batch`` ``params[level]``."""
    p = dict(p)
    if level == "qkd" and p.get("F") is not None:
        raise ValueError("on IonQ the spy level (qkd) does not support Werner noise F; use theta_deg")
    if level == "qkd":
        p.pop("F", None)
    if level == "purify":
        p = {k: v for k, v in p.items() if v is not None}
    if level == "rescue":
        kind = p.pop("damage_kind", None)
        dmg = {k[len("damage_"):]: p.pop(k) for k in ("damage_F", "damage_gamma", "damage_theta_deg") if k in p}
        if kind is not None or dmg:
            kind = kind or _D["rescue"]["damage"]["kind"]
            keep = {"werner": "F", "damping": "gamma", "spy": "theta_deg"}.get(kind)
            p["damage"] = {"kind": kind, **({keep: dmg[keep]} if keep in dmg else {})}
    return p


@_guard(ionq_ok=True)
def run_level(backend: Any, level: str, params: Any = None, **kw: Any) -> dict[str, Any]:
    """Recommended UI entry point: run one level, safe to click on any backend.

    ``level`` is one of ``RUN_LEVELS``; ``params`` (a dict, positional from JS) and keyword
    arguments are that level's usual
    arguments (``shots``, ``seed`` and the level's own, degrees for angles).
    Simulators call the level function directly. On IonQ the first call runs
    ``full_batch`` once (the level's ``params`` replace its defaults; other
    levels use defaults), caches it and returns this level's result with
    ``source: "ionq_batch_cache"`` and ``batch_ok``; later calls are served from
    the cache without any new job (their ``params`` are ignored and flagged by
    ``params_ignored``). Known limit: ``F`` for qkd is not available on IonQ.
    """
    level = _choice("level", level, RUN_LEVELS)
    params = {**(_py(params) or {}), **kw}  # positional dict (JS) merged with keyword arguments
    if not an.is_ionq(backend):
        return LEVEL_FUNCS[level](backend, **params)
    shots, seed = params.pop("shots", None), params.pop("seed", 0)
    fresh = _IONQ_CACHE is None
    if fresh:
        bp = _batch_params(level, params)
        res = _run_batch_once(backend, shots, seed, {level: bp} if bp else None)
        if res.get("ok") is False:
            return res
    else:
        res = _IONQ_CACHE
    lv = res["levels"].get(level)
    out = {"ok": True, "source": "ionq_batch_cache", "batch_ok": all(
        v.get("ok") for v in res["levels"].values()), "cached_run": not fresh}
    if not fresh and (params or shots is not None):
        out["params_ignored"] = True
    if not lv or not lv.get("ok"):
        return {**out, "ok": False, "error": (lv or {}).get("error", f"level {level} missing from the batch")}
    return {**out, **{k: v for k, v in lv.items() if k != "ok"}}


LEVEL_FUNCS: dict[str, Callable[..., dict[str, Any]]] = {
    "link": level_link, "teleport": level_teleport, "noise": level_noise, "swap": level_swap,
    "purify": level_purify, "qkd": level_qkd, "rescue": rescue,
}


# --------------------------------------------------------------------------
# Offline decoding and files
# --------------------------------------------------------------------------

@_guard(needs_backend=False)
def decode_only(
    level: str, counts: Any, params: Any = None, seed: int = 0, backend_name: str = "unknown",
    shots: int | None = None, timestamp: str | None = None, mode: str = "batch",
    readout_counts: Any = None,
) -> dict[str, Any]:
    """Re-decode saved counts of one level without a backend.

    Use it after an IonQ job to change decoding parameters (for example the
    rescue ``target_F``). ``counts`` is the level's ``counts`` field.
    """
    return batch.decode_only(
        _choice("level", level, batch.DECODED_LEVELS), _py(counts), _py(params), int(seed),
        str(backend_name), None if shots is None else int(shots), timestamp,
        _choice("mode", mode, ("live", "batch", "recorded")), _py(readout_counts),
    )


# Qollab forbids f-strings / os.path.join for file paths, so every recorded run
# is opened by its own function with a LITERAL path, registered here by name.
# To add a recording: write `def _open_<name>(): return open("data/recorded/<name>.json", encoding="utf-8")`
# and add it to RECORDED_OPENERS.
def _open_basic_simulator_full():
    return open("data/recorded/basic_simulator_full.json", encoding="utf-8")


RECORDED_OPENERS: dict[str, Callable[[], Any]] = {
    "basic_simulator_full": _open_basic_simulator_full,
}


def _mark_recorded(result: Any) -> Any:
    """Label a loaded result (and its per-level results) as ``recorded`` for the UI."""
    if isinstance(result, dict):
        result["mode"] = "recorded"
        for lv in (result.get("levels") or {}).values():
            if isinstance(lv, dict) and "mode" in lv:
                lv["mode"] = "recorded"
    return result


@_guard(needs_backend=False)
def load_recorded() -> dict[str, Any]:
    """Load the recorded runs. ``ok`` is False if any listed file fails."""
    runs, errors = [], []
    for name, opener in RECORDED_OPENERS.items():
        try:
            with opener() as fh:
                runs.append({"name": name, "result": _mark_recorded(json.load(fh))})
        except (OSError, ValueError) as exc:
            errors.append({"file": name, "error": str(exc)})
    if errors:
        return {"ok": False, "error": f"{len(errors)} recorded file(s) failed", "recorded": runs,
                "errors": errors, "files": list(RECORDED_OPENERS)}
    return {"recorded": runs, "errors": [], "files": list(RECORDED_OPENERS)}


MAX_EXPORT_BYTES = 2_000_000


@_guard(needs_backend=False)
def export_result(result: Any, filename: str = "entangle-the-andes-result.json") -> dict[str, Any]:
    """Send a result to the browser as a download (no-op outside Qollab)."""
    if not isinstance(filename, str) or not filename.endswith(".json") or "/" in filename or not filename[:-5]:
        raise ValueError("filename must be a plain name ending in .json")
    data = json.dumps(an.to_plain(_py(result)), indent=2)
    size = len(data.encode("utf-8"))
    if size > MAX_EXPORT_BYTES:
        raise ValueError(f"result is {size} bytes; the Qollab file limit is 2 MB")
    try:
        from js import sendFile  # type: ignore[import-not-found]
    except ImportError:
        return {"exported": False, "reason": "not running in Qollab", "bytes": size}
    sendFile(filename, "application/json", data)
    return {"exported": True, "bytes": size}
