# Entangle the Andes

Build Colombia's first quantum internet (Bogotá – Medellín – Cali), one Bell pair at a time.

> Work in progress — built during the Qollab × IonQ Global Quantum Hackathon 2026.

## How to run

- **On Qollab:** open the project, pick a simulator in "Select QPU" and press **Run**.
- **Locally:** `uv sync` then `uv run pytest`.

## Prior work & AI disclosure

- To prepare for the hackathon, we researched quantum networking ourselves
  (entanglement purification, repeaters, QKD). All project code, assets and text
  were written during the build window (see commit history).
- We used Claude Code to help research, write, review and test the code and
  documentation. The team reviewed and tested every change.
- Libraries: Qiskit, qiskit-ionq (Apache 2.0), [three.js](https://threejs.org) (MIT, 3D map and bloom
  post-processing; provided by the Qollab runtime, loaded by bare name, not copied into this repo).
- Map data (baked into `ui/data/` by `tools/bake_terrain.py`, nothing is fetched at runtime):
  elevation and bathymetry from [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen; sources
  include SRTM, GMTED2010 and ETOPO1, see the
  [attribution list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md));
  colour from [NASA Blue Marble](https://visibleearth.nasa.gov/images/74092) (public domain, NASA Earth Observatory);
  country borders from [Natural Earth](https://www.naturalearthdata.com/) 1:50m (public domain, simplified).
- Related prior work (not reused, no code or assets taken): QuTech's
  [Quantum Network Explorer](https://qutech.nl/2021/11/19/new-platform-opens-quantum-networking-to-everyone/)
  also opens quantum networking to everyone. We differ in that every link here is a real Qiskit circuit that
  runs on IonQ (and simulators) with 95 % confidence intervals and theory comparisons, whereas the Explorer is
  built on the NetSquid network simulator; and in our "noise is someone listening" explainer, which treats
  noise and an eavesdropper as the same mechanism.

## References & credits

Every module in `quantum/` lists its sources in its docstring (`References:`), and any
snippet adapted from documentation carries an `# Adapted from: <url>` comment.

Protocols and formulas:
- Bell pairs and teleportation — Bennett et al., *Phys. Rev. Lett.* 70, 1895 (1993).
- Werner states — Werner, *Phys. Rev. A* 40, 4277 (1989).
- Entanglement swapping / repeaters — Żukowski et al., *PRL* 71, 4287 (1993); Briegel et al., *PRL* 81, 5932 (1998).
- DEJMPS purification — Deutsch et al., *PRL* 77, 2818 (1996).
- CHSH inequality — Clauser, Horne, Shimony & Holt, *PRL* 23, 880 (1969).
- E91 / BBM92 QKD — Ekert, *PRL* 67, 661 (1991); Bennett, Brassard & Mermin, *PRL* 68, 557 (1992).
- Key rate r = 1 − 2h(Q) — Shor & Preskill, *PRL* 85, 441 (2000).

Software and docs:
- [Qiskit](https://github.com/Qiskit/qiskit) (Apache 2.0), [qiskit-ionq](https://github.com/qiskit-community/qiskit-ionq) (Apache 2.0), [three.js](https://threejs.org) (MIT).
- [Qollab docs](https://qollab.xyz/learn/docs/runtime-environment) for the JS ↔ Python bridge and backend handling.

## License

MIT — see [LICENSE](LICENSE).

---

This effort is supported by Qollab & IonQ.
