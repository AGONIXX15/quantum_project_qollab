"""Parameter validators shared by the API and the full batch.

Every validator raises ValueError with a message the UI can show as is.
Angles are validated in DEGREES (the public unit of the API).

References:
    - Qollab JS projects: https://qollab.xyz/learn/docs/js-qiskit-projects
"""

from __future__ import annotations

import math
from typing import Any


def py(x: Any) -> Any:
    """Convert a Pyodide JsProxy to a Python object if needed."""
    return x.to_py() if hasattr(x, "to_py") else x


def num(name: str, v: Any, lo: float, hi: float) -> float:
    """A finite number in [lo, hi]."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a number") from None
    if not math.isfinite(f) or not (lo <= f <= hi):
        raise ValueError(f"{name} must be between {lo:g} and {hi:g} (got {v})")
    return f


def shots(v: Any) -> int:
    return int(num("shots", v, 10, 20000))


def choice(name: str, v: Any, options: tuple[str, ...]) -> str:
    if v not in options:
        raise ValueError(f"{name} must be one of {list(options)} (got {v!r})")
    return v


def spec_args(F: Any, gamma: Any, p: Any) -> dict[str, Any]:
    """Exactly one of F (Werner), gamma (damping) or p (Pauli weights)."""
    given = [k for k, v in (("F", F), ("gamma", gamma), ("p", p)) if v is not None]
    if len(given) != 1:
        raise ValueError("give exactly one of F, gamma or p")
    if F is not None:
        return {"F": num("F", F, 0.25, 1.0)}
    if gamma is not None:
        return {"gamma": num("gamma", gamma, 0.0, 1.0)}
    try:
        p = [float(v) for v in py(p)]
    except (TypeError, ValueError):
        raise ValueError("p must be four numbers (I, X, Y, Z)") from None
    if len(p) != 4 or not all(math.isfinite(v) for v in p) or min(p) < 0 or abs(sum(p) - 1.0) > 1e-6:
        raise ValueError("p must be four finite non-negative weights (I, X, Y, Z) summing to 1")
    return {"p": p}


def f_list(name: str, v: Any, max_len: int = 5) -> list[float]:
    fs = [num(name, f, 0.25, 1.0) for f in py(v)]
    if not 1 <= len(fs) <= max_len:
        raise ValueError(f"{name}s must have 1 to {max_len} values")
    return fs
