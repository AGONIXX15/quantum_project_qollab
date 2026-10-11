"""Sandbox: build your own quantum network and send entanglement along a route.

The user draws a small graph (2-12 nodes, 1-20 links, each link a Werner pair of
fidelity F). Python picks the best simple route src -> dst by theory fidelity
(fewer hops on ties) and runs it as a REAL chain of N entanglement swaps:

    N Bell pairs (2N qubits), a Bell measurement (CX + H, measured at the END) at
    every inner node, and the two end qubits measured in X, Y and Z (3 circuits,
    same convention as ``swap.py``).

Noise (precision mode only): the circuits are ideal and carry a
``barrier(label="channel")``; the Werner(F_i) Pauli error of each pair is sampled
PER SHOT in Python and propagated through the Clifford tail with
``noise.error_flip_masks``. Sampling is per shot (not the 4^k enumeration of
``noise.apply_pauli_flips``) so long routes stay cheap.

Qubits: pair i = (2i, 2i+1); the Werner error is applied to qubit 2i+1.
Bit order (Qiskit little-endian, register ``out`` of 2N clbits): clbit 0 = first
end node, clbit 1 = last end node, and for the inner node k = 1..N-1 (between
pair k-1 and pair k): clbit 2k = m_z (outcome of qubit 2k-1, the H-measured one),
clbit 2k+1 = m_x (outcome of qubit 2k). Pauli frame (N = 2 is exactly swap.py):
ZZ <- ZZ xor (all m_x), XX <- XX xor (all m_z), YY <- YY xor both.

Assumptions: fibre length = great-circle x ``geo.FIBER_ROUTE_FACTOR``; the
delivery rate uses ideal memories (``min`` of the link transmissivities), so
``raw_pairs_per_delivered = hops / eta_route`` is a simple upper-level
estimate (each hop worst-case at the slowest link's rate), not a simulation.
Loss changes the rate, never the fidelity. Key rates are asymptotic, per
delivered pair.

References:
    - Briegel, Dur, Cirac, Zoller (1998). Phys. Rev. Lett. 81:5932.
    - Knill (2005). Nature 434:39 (Pauli frame).
    - Werner (1989). Phys. Rev. A 40:4277.
"""

from __future__ import annotations

import math
import re
from typing import Any

import numpy as np
from qiskit import ClassicalRegister, QuantumCircuit, QuantumRegister

from . import analysis as an
from . import geo
from . import validate as V
from .execute import circuit_report, ionq_max_qubits, run_batch, run_packed
from .links import BASES, rotate_to_basis
from .noise import error_flip_masks, werner_probs
from .pack import DoesNotFit
from .rescue import _q, _rate_metrics, _theory_q
from .swap import swap_bell_diag

MAX_NODES = 12
MAX_LINKS = 20
MAX_HOPS_SIM = 6
BBOX = {"lat": [-8.0, 16.0], "lon": [-92.0, -58.0]}
F_RANGE = (0.5, 1.0)
_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,12}")
QUBITS_PER_HOP_PACKED = 6  # 3 circuits x 2 qubits per hop

# Same thresholds as classifyFidelity in ui/scene.js.
_HEALTHY, _DEGRADED = 0.9, 0.6

PRESET_CITIES: tuple[tuple[str, str, float, float], ...] = (
    ("BOG", "Bogotá", 4.711, -74.072), ("MED", "Medellín", 6.244, -75.581),
    ("CAL", "Cali", 3.452, -76.532), ("CTG", "Cartagena", 10.391, -75.479),
    ("BAQ", "Barranquilla", 10.964, -74.796), ("BGA", "Bucaramanga", 7.119, -73.123),
    ("PSO", "Pasto", 1.214, -77.281), ("LET", "Leticia", -4.215, -69.941),
    ("CCS", "Caracas", 10.480, -66.904), ("MAR", "Maracaibo", 10.654, -71.640),
    ("UIO", "Quito", -0.180, -78.468), ("GYE", "Guayaquil", -2.171, -79.922),
    ("PTY", "Panama City", 8.983, -79.517), ("SJO", "San José (CR)", 9.928, -84.091),
    ("MGA", "Managua", 12.136, -86.251),
)  # Kingston (17.97 N) is outside the baked map region, so it is not offered.


def sandbox_presets() -> dict[str, Any]:
    """City presets inside the map region, plus a small example graph."""
    return {
        "cities": [{"id": i, "name": n, "lat": la, "lon": lo} for i, n, la, lo in PRESET_CITIES],
        "bbox": BBOX,
        "example": {
            "nodes": ["BOG", "MED", "CAL", "CTG"],
            "links": [{"a": "BOG", "b": "MED", "F": 0.95}, {"a": "MED", "b": "CAL", "F": 0.9},
                      {"a": "BOG", "b": "CAL", "F": 0.7}, {"a": "MED", "b": "CTG", "F": 0.92}],
            "src": "BOG", "dst": "CAL",
        },
    }


def sandbox_info() -> dict[str, Any]:
    """Limits of the sandbox (for ``api.info``)."""
    return {"function": "sandbox", "max_nodes": MAX_NODES, "max_links": MAX_LINKS,
            "max_hops_sim": MAX_HOPS_SIM, "bbox": BBOX, "F_range": list(F_RANGE), "F_min": F_RANGE[0], "F_max": F_RANGE[1],
            "presets_function": "sandbox_presets"}


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

def _dict(name: str, v: Any) -> dict[str, Any]:
    if not isinstance(v, dict):
        raise V.InputError(f"{name} must be an object")
    return v


def _node_id(name: str, v: Any) -> str:
    if not isinstance(v, str) or not _ID_RE.fullmatch(v):
        raise V.InputError(f"{name} must match [A-Za-z0-9_-]{{1,12}} (got {v!r})")
    return v


def validate_graph(graph: Any) -> dict[str, Any]:
    """Return a clean copy of ``graph`` or raise ``V.InputError`` (before any job)."""
    g = _dict("graph", V.py(graph))
    nodes_raw, links_raw = V.py(g.get("nodes")), V.py(g.get("links"))
    if not isinstance(nodes_raw, (list, tuple)) or not isinstance(links_raw, (list, tuple)):
        raise V.InputError("graph needs a 'nodes' list and a 'links' list")
    if not 2 <= len(nodes_raw) <= MAX_NODES:
        raise V.InputError(f"the network needs 2 to {MAX_NODES} nodes (got {len(nodes_raw)})")
    if not 1 <= len(links_raw) <= MAX_LINKS:
        raise V.InputError(f"the network needs 1 to {MAX_LINKS} links (got {len(links_raw)})")
    nodes: dict[str, dict[str, Any]] = {}
    for raw in nodes_raw:
        n = _dict("node", V.py(raw))
        nid = _node_id("node id", n.get("id"))
        if nid in nodes:
            raise V.InputError(f"duplicate node id {nid!r}")
        name = n.get("name", nid)
        nodes[nid] = {
            "id": nid, "name": str(name)[:40] if name is not None else nid,
            "lat": V.num(f"{nid} lat", n.get("lat"), *BBOX["lat"]),
            "lon": V.num(f"{nid} lon", n.get("lon"), *BBOX["lon"]),
        }
    links: list[dict[str, Any]] = []
    seen: set[frozenset[str]] = set()
    for raw in links_raw:
        lk = _dict("link", V.py(raw))
        a, b = _node_id("link endpoint a", lk.get("a")), _node_id("link endpoint b", lk.get("b"))
        if a not in nodes or b not in nodes:
            raise V.InputError(f"link {a}-{b} uses an unknown node")
        if a == b:
            raise V.InputError(f"link {a}-{b} connects a node to itself")
        key = frozenset((a, b))
        if key in seen:
            raise V.InputError(f"duplicate link {a}-{b}")
        seen.add(key)
        links.append({"a": a, "b": b, "F": V.num(f"link {a}-{b} F", lk.get("F"), *F_RANGE)})
    src, dst = _node_id("src", g.get("src")), _node_id("dst", g.get("dst"))
    if src not in nodes or dst not in nodes:
        raise V.InputError("src and dst must be nodes of the network")
    if src == dst:
        raise V.InputError("src and dst must be different nodes")
    if not simple_paths(links, src, dst, len(nodes)):
        raise V.InputError(f"there is no route from {src} to {dst}: connect them with links")
    return {"nodes": list(nodes.values()), "links": links, "src": src, "dst": dst}


# --------------------------------------------------------------------------
# Geometry and route choice (pure)
# --------------------------------------------------------------------------

def simple_paths(links: list[dict[str, Any]], src: str, dst: str, max_hops: int) -> list[list[str]]:
    """All simple paths src -> dst with at most ``max_hops`` links (tiny graphs)."""
    adj: dict[str, list[str]] = {}
    for lk in links:
        adj.setdefault(lk["a"], []).append(lk["b"])
        adj.setdefault(lk["b"], []).append(lk["a"])
    out: list[list[str]] = []

    def walk(path: list[str]) -> None:
        here = path[-1]
        if here == dst:
            out.append(list(path))
            return
        if len(path) - 1 >= max_hops:
            return
        for nxt in sorted(adj.get(here, [])):
            if nxt not in path:
                path.append(nxt)
                walk(path)
                path.pop()

    walk([src])
    return out


def link_geometry(graph: dict[str, Any]) -> dict[frozenset[str], dict[str, Any]]:
    """Per link: great-circle km, fibre km, eta, loss dB and F, keyed by the endpoint set."""
    pos = {n["id"]: n for n in graph["nodes"]}
    out = {}
    for lk in graph["links"]:
        a, b = pos[lk["a"]], pos[lk["b"]]
        gc = geo.haversine_coords(a["lat"], a["lon"], b["lat"], b["lon"])
        length = gc * geo.FIBER_ROUTE_FACTOR
        eta = geo.transmissivity(length)
        out[frozenset((lk["a"], lk["b"]))] = {
            "great_circle_km": gc, "length_km": length, "eta": eta,
            "loss_db": geo.loss_db(eta), "F": lk["F"],
        }
    return out


def route_theory(Fs: list[float]) -> dict[str, Any]:
    """End-to-end Bell-diagonal weights, fidelity and XX/YY/ZZ of a chain of Werner links."""
    p = werner_probs(Fs[0])
    for F in Fs[1:]:
        p = swap_bell_diag(p, werner_probs(F))
    xx, yy, zz = an.correlators_from_bell_diagonal(p)
    return {"p": p, "F": p[0], "XX": xx, "YY": yy, "ZZ": zz}


def max_hops_for(backend: Any) -> int:
    """Hop limit: 6 on simulators; on IonQ the largest N with 6N <= backend width."""
    if an.is_ionq(backend):
        return min(MAX_HOPS_SIM, ionq_max_qubits(backend) // QUBITS_PER_HOP_PACKED)
    return MAX_HOPS_SIM


def plan_route(graph: dict[str, Any], max_hops: int) -> dict[str, Any]:
    """Pick the route of highest theory F (fewer hops on ties) among those with <= max_hops.

    Returns ``{route, hops, alternatives, route_limited}``; ``route`` is None if
    no path fits the hop limit (``shortest_hops`` then says what would be needed).
    """
    geom = link_geometry(graph)
    every = simple_paths(graph["links"], graph["src"], graph["dst"], len(graph["nodes"]))

    def describe(path: list[str]) -> dict[str, Any]:
        hops = [{"a": a, "b": b, **geom[frozenset((a, b))]} for a, b in zip(path, path[1:])]
        return {"route": path, "n_hops": len(hops), "hops": hops,
                "F_theory": route_theory([h["F"] for h in hops])["F"],
                "eta": geo.reroute_eta([h["eta"] for h in hops])["ideal_memory"]}

    cands = sorted((describe(p) for p in every if len(p) - 1 <= max_hops),
                   key=lambda d: (-d["F_theory"], d["n_hops"], d["route"]))
    best_any = max((describe(p) for p in every), key=lambda d: (d["F_theory"], -d["n_hops"]))
    out: dict[str, Any] = {"shortest_hops": min(len(p) - 1 for p in every)}
    if not cands:
        return {**out, "route": None, "hops": [], "alternatives": [], "route_limited": True}
    best = cands[0]
    alts = [{"route": c["route"], "hops": c["n_hops"], "F_theory": c["F_theory"], "eta": c["eta"],
             "chosen": i == 0} for i, c in enumerate(cands[:3])]
    return {**out, "route": best["route"], "hops": best["hops"], "alternatives": alts,
            "route_limited": best_any["F_theory"] > best["F_theory"] + 1e-12}


# --------------------------------------------------------------------------
# Circuits and decoding
# --------------------------------------------------------------------------

def bit_order(n_hops: int) -> str:
    """Documented classical-bit layout for a route of ``n_hops`` hops."""
    inner = "; ".join(f"inner {k}: {2 * k}=m_z, {2 * k + 1}=m_x" for k in range(1, n_hops))
    return ("Qiskit little-endian (rightmost character = clbit 0); clbits: 0=first end, 1=last end"
            + (f"; {inner}" if inner else ""))


def frame_bits(n_hops: int) -> dict[str, list[int]]:
    """Pauli-frame clbits per basis: XX <- all m_z, ZZ <- all m_x, YY <- both."""
    mz = [2 * k for k in range(1, n_hops)]
    mx = [2 * k + 1 for k in range(1, n_hops)]
    return {"XX": mz, "ZZ": mx, "YY": mz + mx}


def build_sandbox(n_hops: int) -> list[QuantumCircuit]:
    """XX, YY, ZZ circuits of an ``n_hops``-hop swap chain (ideal, 2*n_hops qubits)."""
    if not 1 <= n_hops <= 12:
        raise ValueError("n_hops must be between 1 and 12")
    n = 2 * n_hops
    circuits = []
    for pair in BASES:
        qr = QuantumRegister(n, "q")
        out = ClassicalRegister(n, "out")
        qc = QuantumCircuit(qr, out, name=f"sandbox{n_hops}h_{pair}")
        for i in range(n_hops):
            qc.h(qr[2 * i])
            qc.cx(qr[2 * i], qr[2 * i + 1])
        qc.barrier(label="channel")  # Werner errors enter here (sampled in Python)
        for k in range(1, n_hops):
            qc.cx(qr[2 * k - 1], qr[2 * k])  # Bell measurement of inner node k
            qc.h(qr[2 * k - 1])
        rotate_to_basis(qc, qr[0], pair[0])
        rotate_to_basis(qc, qr[n - 1], pair[1])
        qc.measure(qr[0], out[0])
        qc.measure(qr[n - 1], out[1])
        for k in range(1, n_hops):
            qc.measure(qr[2 * k - 1], out[2 * k])
            qc.measure(qr[2 * k], out[2 * k + 1])
        circuits.append(qc)
    return circuits


def sample_channel_errors(
    counts: dict[str, int], n_clbits: int, masks: dict[int, list[int]],
    probs: dict[int, tuple[float, ...]], rng: np.random.Generator,
) -> dict[str, int]:
    """XOR an independently sampled Pauli flip mask per shot (cost O(shots x pairs))."""
    bits, w = an.bits_from_counts(counts, n_clbits)
    # np.repeat needs intp repeats: int64 weights fail on Pyodide (wasm32, intp = int32).
    vals = np.repeat((bits.astype(np.int64) << np.arange(n_clbits)).sum(axis=1),
                     np.asarray(w).astype(np.intp))
    for q, m in masks.items():
        idx = rng.choice(4, size=vals.size, p=np.asarray(probs[q]) / np.sum(probs[q]))
        vals ^= np.asarray(m, dtype=np.int64)[idx]
    uniq, cnt = np.unique(vals, return_counts=True)
    return {format(int(v), f"0{n_clbits}b"): int(c) for v, c in zip(uniq, cnt)}


def decode_sandbox(
    counts_by_id: dict[str, dict[str, int]], Fs: list[float], seed: int = 0,
) -> dict[str, Any]:
    """Apply the sampled channel and the Pauli frame; metrics with CI and theory."""
    n_hops = len(Fs)
    n = 2 * n_hops
    rng = np.random.default_rng(seed)
    frame = frame_bits(n_hops)
    probs = {2 * i + 1: werner_probs(F) for i, F in enumerate(Fs)}
    corr = {}
    for qc in build_sandbox(n_hops):
        pair = qc.name[-2:]
        masks = error_flip_masks(qc, list(probs))
        noisy = sample_channel_errors(counts_by_id[qc.name], n, masks, probs, rng)
        corr[pair] = an.correlator(noisy, [0, 1], flips=frame[pair])
    th = route_theory(Fs)
    fid = an.bell_fidelity(corr["XX"], corr["YY"], corr["ZZ"])
    metrics: dict[str, Any] = {
        f"corr_{p}": an.metric(c["value"], c["ci95"], th[p]) for p, c in corr.items()
    }
    metrics["fidelity"] = an.metric(fid["value"], fid["ci95"], th["F"], raw=fid["raw"])
    metrics["theory_route_F"] = an.metric(th["F"], [th["F"], th["F"]], th["F"])
    qz, qz_ci = _q(corr["ZZ"])
    qx, qx_ci = _q(corr["XX"])
    rates = _rate_metrics(qz, qz_ci, qx, qx_ci, _theory_q(th["p"]))
    metrics["key_rate_shor_preskill"] = rates["shor_preskill"]
    metrics["key_rate_lca_biased"] = rates["lca_biased"]
    return {"metrics": metrics, "fidelity": fid}


def classify_fidelity(F: float | None) -> str:
    """Link status from F (mirrors classifyFidelity in ui/scene.js)."""
    if F is None or F >= _HEALTHY:
        return "healthy"
    return "degraded" if F >= _DEGRADED else "broken"


# --------------------------------------------------------------------------
# Run
# --------------------------------------------------------------------------

def run_sandbox(
    backend: Any, graph: dict[str, Any], shots: int = 1000, seed: int = 0,
    before_run: Any = None, on_submit_error: Any = None, **run_options: Any,
) -> dict[str, Any]:
    """Validate, choose the route, run it with ONE ``backend.run``; JSON contract.

    ``graph`` must already be clean (``validate_graph``). On IonQ the 3 circuits
    go out as ONE packed circuit; if no route fits the width ``DoesNotFit`` is
    raised BEFORE ``before_run`` (the job is not spent).
    """
    cap_hops = max_hops_for(backend)
    plan = plan_route(graph, cap_hops)
    if plan["route"] is None:
        raise DoesNotFit(
            QUBITS_PER_HOP_PACKED * plan["shortest_hops"], ionq_max_qubits(backend),
            f"the shortest route has {plan['shortest_hops']} hops, this backend fits {cap_hops}")
    route, hops = plan["route"], plan["hops"]
    n_hops = len(hops)
    circuits = build_sandbox(n_hops)
    if an.is_ionq(backend):
        counts, compiled, _ = run_packed(
            backend, circuits, shots, before_run=before_run, on_submit_error=on_submit_error,
            **run_options)
    else:
        counts, compiled = run_batch(backend, circuits, shots, before_run=before_run, **run_options)
    Fs = [h["F"] for h in hops]
    dec = decode_sandbox(counts, Fs, seed)
    metrics = dec["metrics"]
    eta = geo.reroute_eta([h["eta"] for h in hops])
    metrics["eta_route"] = an.metric(eta["ideal_memory"], [eta["ideal_memory"]] * 2, eta["ideal_memory"],
                                     eta_no_memory=eta["no_memory"])
    raw = n_hops / eta["ideal_memory"]
    metrics["raw_pairs_per_delivered"] = an.metric(raw, [raw, raw], raw)
    links_viz = [{"id": f"{h['a']}-{h['b']}", "a": h["a"], "b": h["b"], "F_theory": h["F"],
                  "status": classify_fidelity(h["F"])} for h in hops]
    fid = dec["fidelity"]
    viz = {
        "links": links_viz, "route": route,
        "end_to_end": {"a": route[0], "b": route[-1], "F": fid["value"], "ci95": fid["ci95"],
                       "status": classify_fidelity(fid["value"])},
        "leak": {"value": 1.0 - fid["value"], "by_link": {v["id"]: 1.0 - v["F_theory"] for v in links_viz},
                 "source": "simulated"},
        "notes": ["Channel noise is simulated in Python (Werner Pauli errors per shot); "
                  "the circuits are ideal.",
                  "raw_pairs_per_delivered = hops / eta_route (ideal memories, slowest link sets the rate).",
                  "Key rates are asymptotic, per delivered pair."],
    }
    result = an.make_result(
        "sandbox", "live", an.backend_name(backend), shots,
        {"graph": graph, "src": graph["src"], "dst": graph["dst"], "max_hops": cap_hops,
         "mode": "precision", "channel": "Werner(F) Pauli errors sampled per shot in Python"},
        bit_order(n_hops), metrics, circuit_report(circuits, compiled), counts, viz=viz)
    result.update(route=route, hops=hops, alternatives=plan["alternatives"],
                  route_limited=plan["route_limited"])
    return an.to_plain(result)
