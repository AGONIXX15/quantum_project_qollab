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

**AI disclosure.**
- We used **Claude Code** (Anthropic; model Claude Opus 5.5) throughout: research support, code,
  UI, tests, code review and documentation. A human teammate directed, reviewed and tested every
  change, and verified the app on the real Qollab platform.
- The 3D web frontend (first version) was also built with AI assistance during development; the
  running app calls no AI model and needs no API key.
- Design guidance for the UI (layout, typography and accessibility checklists) came partly from
  the *UI/UX Pro Max* skill for Claude Code (a local design-rules database; no assets copied).

**Third-party software** (none of it is copied into this repo unless stated):
- [Qiskit](https://github.com/Qiskit/qiskit) (Apache 2.0) and [qiskit-ionq](https://github.com/qiskit-community/qiskit-ionq) (Apache 2.0) — circuits, transpilation, IonQ backend.
- [NumPy](https://numpy.org) (BSD-3) — statistics and decoding.
- [three.js](https://threejs.org) 0.186.1 (MIT) and its addons `OrbitControls`, `EffectComposer`,
  `RenderPass`, `UnrealBloomPass`, `OutputPass`, `CSS2DRenderer` — 3D map, bloom and labels.
  Provided by the Qollab runtime and imported by bare name; the local dev page loads the same
  version from the jsDelivr CDN.
- Fonts from Google Fonts, loaded at runtime with a system-font fallback:
  [Exo 2](https://fonts.google.com/specimen/Exo+2) and [Inter](https://fonts.google.com/specimen/Inter)
  (SIL Open Font License 1.1), [Roboto Mono](https://fonts.google.com/specimen/Roboto+Mono) (Apache 2.0).
- [Pillow](https://python-pillow.org) (HPND) — only in the offline `tools/bake_terrain.py` script.
- Status icons in `ui/icons.js` are simple inline SVG paths drawn for this project.

**Map data** (baked into `ui/data/` by `tools/bake_terrain.py`; nothing is fetched at runtime):
- Elevation and bathymetry: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
  (Mapzen “terrarium” tiles, zoom 6). Underlying sources include SRTM, GMTED2010 and ETOPO1 —
  full list in the [attribution file](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
- Colour: [NASA Blue Marble: Next Generation](https://visibleearth.nasa.gov/images/74092)
  (July 2004, 5400×2700; NASA Earth Observatory, public domain).
- Country borders: [Natural Earth](https://www.naturalearthdata.com/) 1:50m admin-0 countries
  (public domain), via the [natural-earth-vector GeoJSON](https://github.com/nvkelso/natural-earth-vector), simplified.
- City coordinates (Bogotá, Medellín, Cali, Cartagena) are public geographic facts.

**Related prior work** (not reused; no code or assets taken): QuTech's
[Quantum Network Explorer](https://qutech.nl/2021/11/19/new-platform-opens-quantum-networking-to-everyone/)
also opens quantum networking to everyone. We differ in that every link here is a real Qiskit
circuit that runs on IonQ (and simulators) with 95 % confidence intervals and theory
comparisons, whereas the Explorer is built on the NetSquid network simulator; and in our
"noise is someone listening" explainer, which treats noise and an eavesdropper as the same
mechanism.

## References & credits

Every module in `quantum/` lists its sources in its docstring (`References:`); the UI's
physics (`ui/leak.js`) lists its formulas and sources in its header comment.

Protocols, states and bounds:
- Teleportation — Bennett, Brassard, Crépeau, Jozsa, Peres & Wootters, *Phys. Rev. Lett.* 70, 1895 (1993); classical 2/3 bound — Massar & Popescu, *PRL* 74, 1259 (1995).
- Pauli-frame tracking — Knill, *Nature* 434, 39 (2005).
- Werner states — Werner, *Phys. Rev. A* 40, 4277 (1989).
- Bell-diagonal states, fidelity from correlators, BBPSSW purification — Bennett, DiVincenzo, Smolin & Wootters, *PRA* 54, 3824 (1996); Bennett et al., *PRL* 76, 722 (1996).
- DEJMPS purification — Deutsch, Ekert, Jozsa, Macchiavello, Popescu & Sanpera, *PRL* 77, 2818 (1996); entanglement pumping and recursion — Dür & Briegel, *Rep. Prog. Phys.* 70, 1381 (2007).
- Entanglement swapping — Żukowski, Zeilinger, Horne & Ekert, *PRL* 71, 4287 (1993).
- Quantum repeaters — Briegel, Dür, Cirac & Zoller, *PRL* 81, 5932 (1998); Dür, Briegel, Cirac & Zoller, *PRA* 59, 169 (1999); Munro, Azuma, Tamaki & Nemoto, *IEEE JSTQE* 21, 6400112 (2015).
- CHSH inequality — Clauser, Horne, Shimony & Holt, *PRL* 23, 880 (1969); maximal violation for a given state — Horodecki, Horodecki & Horodecki, *Phys. Lett. A* 200, 340 (1995).
- E91 / BBM92 QKD — Ekert, *PRL* 67, 661 (1991); Bennett, Brassard & Mermin, *PRL* 68, 557 (1992).
- Key rate r = 1 − 2h(Q) — Shor & Preskill, *PRL* 85, 441 (2000); biased bases — Lo, Chau & Ardehali, *J. Cryptology* 18, 133 (2005); finite-key effects — Hoeffding, *JASA* 58, 13 (1963); Tomamichel, Lim, Gisin & Renner, *Nat. Commun.* 3, 634 (2012).
- Eavesdropper's guessing probability — Helstrom, *Quantum Detection and Estimation Theory* (1976).
- Concurrence — Wootters, *PRL* 80, 2245 (1998); monogamy of entanglement (CKW) — Coffman, Kundu & Wootters, *PRA* 61, 052306 (2000). Used by the "noise is someone listening" chapter.
- Environment as a dilation (Stinespring) — Nielsen & Chuang, *Quantum Computation and Quantum Information*, §8.2.3; state synthesis — Shende, Bullock & Markov, *IEEE TCAD* 25, 1000 (2006); Clifford action on Paulis — Gottesman, arXiv:quant-ph/9807006 (1998).
- Pauli twirling — Wallman & Emerson, *PRA* 94, 052325 (2016); readout-error mitigation — Bravyi, Sheldon, Kandala, McKay & Gambetta, *PRA* 103, 042605 (2021).

Statistics and geography:
- Score interval — Wilson, *JASA* 22, 209 (1927); Agresti & Coull, *Am. Stat.* 52, 119 (1998).
- Fibre loss ≈ 0.2 dB/km at 1550 nm — ITU-T Recommendation G.652; great-circle distance — Sinnott, *Sky and Telescope* 68, 159 (1984).

Platform documentation (Qollab):
- [Runtime environment](https://qollab.xyz/learn/docs/runtime-environment), [JS + Qiskit projects](https://qollab.xyz/learn/docs/js-qiskit-projects), [compute backends](https://qollab.xyz/learn/docs/compute-backends), [primitives](https://qollab.xyz/learn/docs/primitives), [publishing](https://qollab.xyz/learn/docs/publish).
- [Qiskit bit ordering](https://quantum.cloud.ibm.com/docs/guides/bit-ordering) and [transpiler](https://quantum.cloud.ibm.com/docs/api/qiskit/transpiler).
- Platform behaviour we found by testing (and a Qollab mentor confirmed the first point): an IonQ
  job accepts one circuit and each Run one job, so the app packs one level into one circuit
  (`quantum/pack.py`); IonQ submission only works while `main.js` top-level code is still running,
  so `main.js` ends with a pending `await`.

## License

MIT — see [LICENSE](LICENSE).

---

This effort is supported by Qollab & IonQ.
