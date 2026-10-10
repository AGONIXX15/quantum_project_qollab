"""Geography of the network: cities, fiber lengths, transmissivity, map projection.

Pure data and functions, everything JSON-serializable.

Assumptions (stated, not measured):
    - Fiber length = great-circle (haversine) distance x 1.3. The factor is a
      rough allowance for real fiber routes following roads and terrain, NOT
      surveyed data.
    - Attenuation 0.2 dB/km at 1550 nm (standard single-mode fiber), so the
      transmissivity of ONE photon travelling L km is eta = 10^(-0.02 L). A
      link is modelled with the source at one end, so only one photon of the
      pair crosses the fiber (a midpoint source would split L in two halves).
      Loss lowers the pair RATE; it does not change the fidelity of the pairs
      that arrive.
    - Rerouting over two hops: with ideal quantum memories each hop is
      generated independently and stored, so the delivery rate is limited by
      the worse hop, eta_eff = min(eta_1, eta_2). Without memories both pairs
      must arrive in the same attempt: eta_1 * eta_2. Both are reported.
    - The map is an equirectangular projection (x east, z south) centred on
      Colombia's approximate centre and scaled so the whole country fits in
      [-1, 1]; it is for drawing only.

References:
    - ITU-T Recommendation G.652 (single-mode optical fibre, ~0.2 dB/km at
      1550 nm).
    - Sinnott, R. W. (1984). Virtues of the haversine. Sky and Telescope 68:159.
"""

from __future__ import annotations

import math
from typing import Any

from .validate import InputError

EARTH_RADIUS_KM = 6371.0088
FIBER_ROUTE_FACTOR = 1.3
LOSS_DB_PER_KM = 0.2

CITIES: dict[str, dict[str, Any]] = {
    "BOG": {"id": "BOG", "name": "Bogotá", "lat": 4.711, "lon": -74.072},
    "MED": {"id": "MED", "name": "Medellín", "lat": 6.244, "lon": -75.581},
    "CAL": {"id": "CAL", "name": "Cali", "lat": 3.452, "lon": -76.532},
    # Challenge city (not part of the three-city core network).
    "CTG": {"id": "CTG", "name": "Cartagena", "lat": 10.391, "lon": -75.479, "challenge": True},
}
LINK_IDS = ("BOG-MED", "MED-CAL", "BOG-CAL")
CENTER = (4.57, -74.30)  # approximate centre of Colombia (lat, lon)
_HALF_EXTENT_DEG = 8.8  # latitude half-extent of the country, maps to 1.0


def haversine_km(a: str, b: str) -> float:
    """Great-circle distance between two city ids."""
    ca, cb = CITIES[a], CITIES[b]
    p1, p2 = math.radians(ca["lat"]), math.radians(cb["lat"])
    dphi = p2 - p1
    dlam = math.radians(cb["lon"] - ca["lon"])
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def link_length_km(a: str, b: str) -> float:
    """Assumed fiber length: great-circle distance x FIBER_ROUTE_FACTOR."""
    return haversine_km(a, b) * FIBER_ROUTE_FACTOR


def transmissivity(length_km: float) -> float:
    """Photon survival probability eta = 10^(-0.02 L) (0.2 dB/km)."""
    return 10.0 ** (-LOSS_DB_PER_KM * length_km / 10.0)


def loss_db(eta: float) -> float:
    """Loss in dB of a transmissivity (0 dB for eta = 1)."""
    return -10.0 * math.log10(eta) if eta > 0 else math.inf


def reroute_eta(etas: list[float]) -> dict[str, float]:
    """Effective eta of a multi-hop route: ideal memories (min) and none (product)."""
    return {"ideal_memory": min(etas), "no_memory": math.prod(etas)}


def expected_pair_rate(source_rate: float, length_km: float) -> float:
    """Expected pairs per second reaching both ends: source rate x eta.

    Simplification: the source sits at one end, so ONE photon crosses L.
    """
    return source_rate * transmissivity(length_km)


def project(lat: float, lon: float) -> dict[str, float]:
    """Scene coordinates (x east, z south), the country spans about [-1, 1]."""
    k = math.cos(math.radians(CENTER[0]))
    x = (lon - CENTER[1]) * k / _HALF_EXTENT_DEG
    z = -(lat - CENTER[0]) / _HALF_EXTENT_DEG
    return {"x": x, "z": z}


def normalize_link(link_id: str) -> str:
    """Canonical id ('CAL-BOG' -> 'BOG-CAL'); ValueError if unknown."""
    parts = link_id.upper().replace("_", "-").split("-")
    if len(parts) == 2:
        for cand in LINK_IDS:
            if set(cand.split("-")) == set(parts):
                return cand
    raise InputError(f"unknown link {link_id!r}; use one of {list(LINK_IDS)}")


def third_city(link_id: str) -> str:
    """The city of the 3-city network that is not an endpoint of ``link_id``."""
    ends = set(normalize_link(link_id).split("-"))
    return next(c for c in ("BOG", "MED", "CAL") if c not in ends)


def reroute_links(link_id: str) -> tuple[str, str]:
    """The two healthy links that replace ``link_id`` through the third city."""
    a, b = normalize_link(link_id).split("-")
    t = third_city(link_id)
    return normalize_link(f"{a}-{t}"), normalize_link(f"{t}-{b}")


def links() -> list[dict[str, Any]]:
    """The three links with lengths, transmissivities and scene coordinates."""
    out = []
    for lid in LINK_IDS:
        a, b = lid.split("-")
        length = link_length_km(a, b)
        out.append({
            "id": lid, "a": a, "b": b,
            "great_circle_km": haversine_km(a, b), "length_km": length,
            "eta": transmissivity(length), "loss_db": LOSS_DB_PER_KM * length,
        })
    return out


def geo_info() -> dict[str, Any]:
    """Everything the UI needs to draw the map (JSON-serializable)."""
    cities = {k: {**v, **project(v["lat"], v["lon"])} for k, v in CITIES.items()}
    return {
        "cities": cities,
        "links": links(),
        "assumptions": {
            "fiber_route_factor": FIBER_ROUTE_FACTOR,
            "loss_db_per_km": LOSS_DB_PER_KM,
            "note": "fiber length = great-circle distance x 1.3 (assumption, not surveyed); "
                    "loss lowers the pair rate, not the fidelity",
        },
    }
