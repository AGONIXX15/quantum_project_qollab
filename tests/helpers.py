"""Shared test doubles."""

from __future__ import annotations

from qiskit.providers.basic_provider import BasicSimulator


class Counting(BasicSimulator):
    """BasicSimulator that counts ``run`` calls in the class attribute ``runs``."""

    runs = 0

    def run(self, *a, **k):
        type(self).runs += 1
        return super().run(*a, **k)


def ionq_counting() -> Counting:
    """A counting backend that the API treats as IonQ (runs reset to 0)."""
    be = Counting()
    be.name = "ionq_simulator"
    Counting.runs = 0
    return be
