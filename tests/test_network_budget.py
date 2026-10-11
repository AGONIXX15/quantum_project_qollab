"""Network budget: swap fold == closed form, geo numbers, threshold logic."""
import importlib.util
import math
from pathlib import Path

from quantum import geo

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("network_budget", ROOT / "tools" / "network_budget.py")
nb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nb)


def test_fold_matches_closed_form():
    for F in (0.6, 0.8, 0.95, 0.99):
        for n in (1, 2, 3, 5, 8, 16):
            assert abs(nb.e2e_fidelity(F, n) - nb.closed_form(F, n)) < 1e-12


def test_bog_med_eta_matches_geo():
    L = geo.link_length_km("BOG", "MED")
    assert 300 < L < 320
    assert math.isclose(geo.transmissivity(L), 10 ** (-0.02 * L))
    assert math.isclose(nb.pair_rate(L, 1), 1e9 * geo.transmissivity(L))
    assert math.isclose(nb.pair_rate(L, 2), 1e9 * geo.transmissivity(L / 2))


def test_threshold_logic():
    assert nb.can_key(0.84) and not nb.can_key(0.83)
    assert nb.can_chsh(0.79) and not nb.can_chsh(0.78)
    assert abs(nb.qber(0.835) - 0.110) < 1e-3
    assert nb.key_per_pair(0.80) == 0.0 and nb.key_per_pair(0.99) > 0.4
    n = nb.max_segments_for_key(0.95)
    assert nb.can_key(nb.e2e_fidelity(0.95, n)) and not nb.can_key(nb.e2e_fidelity(0.95, n + 1))
