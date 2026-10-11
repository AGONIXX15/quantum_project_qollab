# Entangle the Andes

![Entangle the Andes: the 3D map of Colombia with the Bogotá–Medellín–Cali quantum network. The Bogotá–Cali link is damaged, and the results panel recommends rerouting through Medellín, based on live circuit results.](https://raw.githubusercontent.com/AGONIXX15/quantum_project_qollab/main/docs/img/cover.jpg)

**Build Colombia's first quantum internet (Bogotá – Medellín – Cali), one Bell pair at a time.**

Entangle the Andes is a game-like lab for quantum networking. You play on a 3D map of Colombia,
and every link, teleportation, repeater and eavesdropper you see is a **real Qiskit circuit**
that runs when you press **Run**. Each result comes with its 95 % confidence interval and the
value theory predicts, so you can see exactly where the quantum network is working and where it
is falling apart.

> **The key idea: noise is someone listening.** When a link gets noisy, information about the
> pair is leaking into the outside world. A spy works the same way: information about the pair
> leaks to the spy. Entanglement is *monogamous*: the more a third party is correlated with
> Bob, the less Alice can be. The app makes this one mechanism visible, with one dial.

![Two panels against the spy angle θ. Left: the Bell-pair fidelity falls the same way for a spy and for environmental noise, while the error rates differ (the spy leaves the Z basis untouched). Right: CHSH S for the spy and for the environment, with the classical bound S = 2. The measured point at θ = 120° lies on the spy curve.](https://raw.githubusercontent.com/AGONIXX15/quantum_project_qollab/main/docs/img/noise_is_someone_listening.png)

*Theory curves from the formulas in the app (`ui/leak.js`). The dots are measured circuit results at θ = 120° (Built-in simulator, 1000 shots, 95 % CI). The fidelity is the same, but the fingerprint differs: the spy breaks CHSH later (131.1°) than environmental noise of the same fidelity (111.8°).*

Theme: **Quantum Unlocked** · Qollab × IonQ Global Quantum Hackathon 2026 · Colombia node.

## Beyond the tutorial: what is new here

1. **One mechanism for noise and eavesdropping.** The environment and the spy are both a
   third qubit that gets correlated with Bob (a Stinespring dilation). The same circuit
   family gives Werner noise and an intercept attack, so learners can see that they cost the
   same fidelity but leave different fingerprints (QBER per basis, where CHSH breaks).
2. **Adaptive purification that works where the textbook protocol fails.** Under amplitude
   damping, standard DEJMPS does not improve the pair (0.900 → 0.890 in our run). Choosing a
   local twist $U\otimes U^*$ from measured XX/YY/ZZ correlators does (→ 0.980).
3. **Your own network, run as real circuits.** In chapter 9 you place cities on the map, wire
   links and pick two endpoints. The app chooses the best route and runs a real N-hop
   entanglement-swapping chain, with the Pauli frame applied over every intermediate Bell
   measurement.
4. **IonQ-ready by construction.** Measurement happens only at the end, and corrections are
   applied as a classical Pauli frame. Each chapter is packed into **one circuit for one job**
   (`quantum/pack.py`, reusable in any project). Chapter 1 was also run on the real IonQ
   Forte 1 QPU.

## Why it matters

Quantum networks are the next step after single quantum computers. They can send qubits
between labs, link small processors into bigger ones, and distribute keys that are secure by
physics. Entanglement does not survive long fibres, though. Over the real Bogotá–Medellín
distance (~310 km of fibre), only about **6 in 10 million** photons arrive. So a working
network needs repeaters, purification and eavesdropper checks, and those ideas are usually
taught with equations, not hands-on.

Entangle the Andes turns them into something you can run and break yourself:

- **Learners** see each building block of a quantum network as a circuit they can run, with
  the theory beside the measurement.
- **Teachers** get 9 self-contained chapters, in English and Spanish, that run in the browser
  with no installation.
- **Developers** can fork the Python modules. Each protocol is a small, tested, documented
  `build_*` / `decode_*` pair.

For a ready-made 50-minute lesson plan with guided questions and a sandbox exercise, see the
[teaching guide](https://github.com/AGONIXX15/quantum_project_qollab/blob/main/docs/teaching_guide.md).

### What a real Bogotá–Medellín–Cali network would need

`tools/network_budget.py` (in the source repository) applies the app's own models, `geo.py`
for fibre loss and `swap.py` for swapping, to the real route. It assumes a source of 10⁹ pair
attempts per second, ideal quantum memories and deterministic swaps, so the rates are upper
bounds.

- **Direct fibre does not work.** Over the 736 km Bogotá–Medellín–Cali route, η ≈ 1.9 × 10⁻¹⁵,
  which is about one pair every 6 days.
- **One repeater in Medellín** (2 segments of 368 km) gives about 43 pairs/s. The end-to-end
  F is 0.980 with links of F = 0.99 (≈ 17 key bits/s), or 0.903 with links of F = 0.95
  (≈ 7 key bits/s).
- **Repeaters trade fidelity for rate.** Each extra segment multiplies the rate but lowers F.
  With F = 0.95 links, more than 3 segments push F below the key threshold (0.835). With
  F = 0.99 links, up to 18 segments (~41 km each) still allow a key, at only 0.008 bits per
  pair. This is why the app pairs repeaters with purification (chapters 5, 6 and 8).

![Left: pair rate vs number of segments on the 736 km route, rising from about 10⁻⁶ to 10⁸ pairs/s. Right: end-to-end fidelity falling with the number of segments for link fidelities 0.99 and 0.95, with the key threshold 0.835 and the CHSH line 0.7803.](https://raw.githubusercontent.com/AGONIXX15/quantum_project_qollab/main/docs/img/network_budget.png)

## What you can do (9 chapters)

| # | Chapter | Circuit | What you measure | Theory it is checked against |
|---|---|---|---|---|
| 1 | **First link** | Bell pair (H + CX), 2 qubits | ⟨XX⟩, ⟨YY⟩, ⟨ZZ⟩ → fidelity | $F = \tfrac14(1+\langle XX\rangle-\langle YY\rangle+\langle ZZ\rangle) = 1$ |
| 2 | **Teleportation** | 3 qubits + 2 environment qubits | Bob's Bloch vector (tomography, Pauli frame) | $F_\text{tel} = \tfrac{2F+1}{3}$; classical limit $\tfrac23$ |
| 3 | **Noise is someone listening** (lab) | 2 + 2 environment qubits | Measured vs configured fidelity | Werner state of fidelity $F$ |
| 4 | **Noise is someone listening** (explainer) | One dial: how much leaks to a third qubit | F and CHSH S, environment vs spy | Same fidelity loss, different fingerprint |
| 5 | **Repeater (swapping)** | 4 + up to 4 environment qubits | A–C correlators after a Bell measurement | $F = F_1F_2 + \tfrac{(1-F_1)(1-F_2)}{3}$ |
| 6 | **Distillation** | DEJMPS, fixed vs **adaptive** | Success probability and output fidelity | $p_s$ and $F'$ (DEJMPS) |
| 7 | **Catch the spy** | E91/BBM92 + 1 spy qubit | QBER per basis, CHSH S, key rate | $S=\sqrt2(1+\cos\tfrac\theta2)$, $Q_X=\tfrac{1-\cos(\theta/2)}{2}$ |
| 8 | **Save the Quantum Network** | Capstone: a link breaks | Direct vs reroute vs purify, pairs used and key | Picks the cheapest strategy that reaches the target |
| 9 | **Build your own network** | Sandbox: your cities, links and fidelities | End-to-end F of the best route, fibre loss, raw pairs, key rate | $N$-hop swapping: Bell-diagonal convolution of the links |

The spy entangles itself with Bob's qubit through a controlled rotation $CR_Y(\theta)$. At
$\theta = 0$ nobody is listening. At $\theta=\pi$ the spy intercepts everything: the average
QBER rises to 25 % and CHSH falls to $S=\sqrt2$, below the classical bound of 2. In the
distillation chapter, the **adaptive** strategy picks a local twist $U\otimes U^*$,
$U\in\{I,H,S,HS,SH,HSH\}$, from the measured noise. Under amplitude damping, the textbook
DEJMPS round does not purify (0.90 → 0.89 in the run below), and the adaptive round does
(0.90 → 0.98).

![Bar chart: input pair F = 0.900, textbook DEJMPS F = 0.890, adaptive DEJMPS (U = SH) F = 0.980, each with a 95 % CI and the exact theory value.](https://raw.githubusercontent.com/AGONIXX15/quantum_project_qollab/main/docs/img/purification_adaptive.png)

*Amplitude damping γ = 0.2, environment qubits in the circuit, Built-in simulator, 1000 shots. The y axis starts at 0.80. The adaptive round costs more raw pairs per output (2.44 vs 2.21) but is the only one that improves the pair.*

![Chapter 9: a user-built network of seven links between Quito, Cali, Medellín, Bogotá, Cartagena and Caracas. The app chose the 4-hop route Quito–Cali–Medellín–Bogotá–Caracas and ran it as a real swapping circuit; the panel lists the alternative routes and the measured correlators against theory.](https://raw.githubusercontent.com/AGONIXX15/quantum_project_qollab/main/docs/img/sandbox.jpg)

*Chapter 9 on the Built-in simulator. The chosen route has a theory fidelity of 0.778, against
0.756 and 0.642 for the alternatives. The fibre-loss numbers (η ≈ 10⁻²⁷ over 2,654 km with no
intermediate repeaters) show why real networks need repeaters every few tens of kilometres.*

## How it works

```
 JS (three.js map, panels, tour)  ──callPromising──▶  quantum/api.py  ──▶  build_* circuits
         ▲                                                  │                 │
         └──────────── JSON (value, CI 95 %, theory) ◀── decode_* ◀── counts ◀┘ backend.run
```

- **Measure only at the end.** No mid-circuit measurement, `reset` or classically controlled
  gates. Teleportation and swapping corrections are applied in Python as a **Pauli frame**: an X
  outcome flips Z-basis bits, a Z outcome flips X-basis bits, and both flip Y. Postselection
  (distillation) is also done in Python. This makes every circuit valid on every backend,
  including IonQ.
- **Noise as qubits.** Noise is built from environment qubits (a Stinespring dilation), not
  added by a black-box simulator. The environment starts in
  $\sqrt F|00\rangle + \sqrt{\tfrac{1-F}{3}}(|01\rangle+|10\rangle+|11\rangle)$ and then acts on Bob
  through CX and CZ, giving an exact Werner state. The same picture gives the spy.
  Teleportation (chapter 2) always uses environment qubits. Chapters 3, 5, 6 and 8 offer two modes. *Teaching* puts the environment qubits inside the circuit, as
  described above. *Precision* runs the ideal circuit and applies the same Pauli channel to the
  measured bits in Python, which isolates the configured noise from hardware noise. The recorded
  results below use precision for chapters 3, 5 and 8, and teaching for distillation (damping is
  not a Pauli channel).
- **Statistics on every number.** $\langle PP\rangle = 1-2q$ with variance $4q(1-q)/N$. Every
  metric shows its value, a Wilson / normal 95 % interval, the theoretical value, the backend,
  the shot count and the timestamp.
- **Real geography.** City coordinates, great-circle distance × 1.3 fibre-route factor, and
  0.2 dB/km at 1550 nm ($\eta = 10^{-0.02L}$). Loss changes the *rate* of pairs, not their
  fidelity.
- **Bit order is documented** in every result (Qiskit little-endian: the rightmost character
  is clbit 0).

### Backends

| Backend | How the app uses it |
|---|---|
| **Built-in simulator** (default, free) | Every chapter runs live, each as a list of 3–9 circuits, 1000 shots each. |
| AWS Braket local / IBM noise models | Same as above, with realistic hardware noise. |
| **IonQ Aria / Forte simulators** (free) | IonQ accepts one circuit per job and one job per Run. The app **packs all circuits of a chapter side by side on disjoint qubits into one circuit** (`quantum/pack.py`) and splits the counts in Python. One Run = one chapter live; the other chapters show a clearly labelled *recorded* result. Distillation and rescue are reduced on narrow backends and marked as such. |

The app never creates or fixes a backend: it always uses the one chosen in *Select QPU*.

## On real quantum hardware: IonQ Forte 1

We ran chapter 1 (the first link) on the **IonQ Forte 1 trapped-ion quantum computer** through
Qollab on 11 Oct 2026. It was one packed circuit with 1000 shots, the same code path as the free
IonQ simulators: three 2-qubit Bell circuits (XX, YY, ZZ bases) plus two 4-qubit readout
calibration blocks, side by side on 14 qubits.

| Quantity | Measured on IonQ Forte 1 (95 % CI) | Theory (ideal) |
|---|---|---|
| ⟨XX⟩ / ⟨YY⟩ / ⟨ZZ⟩ | 0.984 / −0.984 / 0.970 | 1 / −1 / 1 |
| Bell-pair fidelity | **0.984** [0.979, 0.990] | 1 |
| Fidelity with readout mitigation | **0.990** [0.986, 0.995] | 1 |

The raw packed counts are stored in `data/recorded/ionq_qpu_forte1_link_raw.json`.
`tools/replay_ionq_recording.py` (in the [source repository](https://github.com/AGONIXX15/quantum_project_qollab)) decodes them with the project's own decoder into
`data/recorded/ionq_qpu_link.json`, so anyone can check the numbers. The app shows this result
next to chapter 1, labelled *recorded*. All other chapters were run on simulators only.

## Results (Built-in simulator, 1000 shots, 10 Oct 2026)

These come from `data/recorded/basic_simulator_full.json` (the app shows them as **recorded**
whenever a live run is not possible). Each value is shown with its 95 % confidence interval.

| Chapter | Quantity | Measured (95 % CI) | Theory |
|---|---|---|---|
| First link | Fidelity | 1.000 [0.998, 1.000] | 1 |
| Teleportation (link F = 0.8) | Teleported fidelity | 0.875 [0.847, 0.902] | 0.867 (> 2/3 classical) |
| Noise | F configured 0.95 / 0.80 / 0.60 | 0.947 / 0.795 / 0.613 | 0.95 / 0.80 / 0.60 |
| Repeater (F₁ = 0.95, F₂ = 0.90) | End-to-end fidelity | 0.860 [0.844, 0.875] | 0.857 |
| Distillation (damping γ = 0.2) | Fixed DEJMPS / adaptive (U = SH) | 0.890 / **0.980** [0.972, 0.987] | 0.897 / 0.982 |
| Catch the spy (θ = 120°) | QBER Z / QBER X | 0.000 / 0.264 [0.238, 0.292] | 0 / 0.25 |
| | CHSH S (standard / device-informed angles) | 2.20 / 2.24 | 2.12 / 2.23 |
| | Key rate: Shor–Preskill / biased bases | 0 / 0.17 | 0 / 0.19 |
| Save the network (BOG–CAL damaged to F = 0.7, target 0.85) | Direct / reroute via Medellín | F 0.70 (no key) / **0.91** (key 0.18 per raw pair) | 0.70 / 0.90 |

![Measured vs theory for every chapter, with 95 % CIs. Triangles: IonQ Forte 1 noise-model simulator; chapter 1 also shows the real IonQ Forte 1 QPU.](https://raw.githubusercontent.com/AGONIXX15/quantum_project_qollab/main/docs/img/results_vs_theory.png)

*Generated from `data/recorded/*.json` by `tools/make_figures.py` (in the source repository).*

On the ideal simulator, every measured value agrees with theory within its 95 % interval, apart
from statistical fluctuation at the 1–2σ level. The green triangles (IonQ noise model) are
discussed below.

### Same chapters on IonQ's Forte 1 noise model

Every chapter was also run once on Qollab's free **IonQ Forte 1 noise-model simulator**
(backend `ionq_simulator`, 1000 shots, 11 Oct 2026, default parameters, one packed circuit per
level), so the numbers include IonQ's device noise model.

| Chapter | Metric | Simulator | IonQ Forte 1 noise model (95 % CI) | Theory |
|---|---|---|---|---|
| First link | Fidelity | 1.000 | 0.988 [0.983, 0.993] | 1 |
| Teleportation | Teleported fidelity | 0.875 | 0.820 [0.792, 0.848] | 0.867 |
| Noise | F at 0.95 / 0.80 / 0.60 | 0.947 / 0.794 / 0.613 | 0.937 / 0.796 / 0.598 | 0.95 / 0.80 / 0.60 |
| Repeater | End-to-end fidelity | 0.860 | 0.809 [0.791, 0.827] | 0.857 |
| Distillation | Adaptive fidelity (input F: 0.900 / 0.865) | 0.980 | 0.928 [0.914, 0.941] | 0.982 |
| Catch the spy | QBER X | 0.264 | 0.272 [0.245, 0.300] | 0.250 |
| | CHSH S, standard angles | 2.204 | 1.954 [1.849, 2.059] | 2.121 |
| | CHSH S, device-informed angles | 2.239 | 2.110 [2.027, 2.194] | 2.236 |
| Save the network | Direct link fidelity | 0.701 | 0.697 [0.675, 0.719] | 0.700 |

How to read it (one run per chapter, 1000 shots, so treat differences of one or two
intervals with care):

- Gate noise in the noise model lowers the multi-qubit chapters (teleportation, repeater,
  distillation) by about 0.05, below their theory values.
- Where the result is set by noise we configure ourselves (the noise lab, the damaged direct
  link), the two backends are close; at F = 0.95 the IonQ value (0.937) sits just below theory.
- Spy chapter: QBER X matches theory, while QBER Z rises from 0 to 0.016 [0.010, 0.026] (device
  noise). The biased key rate drops from 0.167 to 0.037 [0.000, 0.116]. Both CHSH values lose
  about 0.13–0.17. With standard angles the interval [1.849, 2.059] no longer excludes 2; with
  device-informed angles it still does, narrowly ([2.027, 2.194]). The difference between the
  two methods is not statistically conclusive in a single run.
- On IonQ, distillation and the rescue chapter were reduced to fit 29 qubits, so there is no
  fixed-DEJMPS baseline and no reroute point (the figure leaves them empty).

The raw packed counts are in `data/recorded/ionq_sim_forte1_raw.json`;
`tools/replay_ionq_sim.py` (in the source repository) decodes them with the project's own decoder
into `data/recorded/ionq_sim_forte1.json`, so anyone can reproduce the numbers. These files are
repo-only evidence: the app does not load them.

## How to run

**On Qollab (no install):** open the project, keep **Built-in simulator** in *Select QPU*,
and press **Run**. The first link runs on its own. Then open any chapter from the side panel,
change its parameters and press its run button. Use **Intro** for the guided tour and **EN/ES**
to switch language.

> **First load takes about 1–2 minutes.** Qollab loads Python and Qiskit inside your browser
> (Pyodide), and the preview may stay blank until the app's loading screen appears. Later runs
> in the same session are fast.

**Accessibility.** Everything works with the keyboard: chapter selector, city buttons, the
sandbox form (typed coordinates work as an alternative to clicking the map) and a modal tour
with focus trap. Status is never shown by colour alone. Text and field borders meet WCAG AA
contrast, motion respects `prefers-reduced-motion`, and every label is in English and Spanish.

**IonQ:** choose *IonQ Forte 1* or *Aria 1* (simulator, free). IonQ accepts one job per Run, so
nothing runs by itself. Pick a chapter, including your own network in chapter 9, and press Run
(~13 s plus queue). Press Stop → Run to try another chapter. Chapters that are not live show a
labelled recorded result.

**Locally** (source code: [github.com/AGONIXX15/quantum_project_qollab](https://github.com/AGONIXX15/quantum_project_qollab)):

```bash
uv sync            # Python 3.14, Qiskit 2.5.2, qiskit-ionq 1.0.2 (same versions as Qollab)
uv run pytest      # 295 tests, BasicSimulator with fixed seeds
python3 -m http.server 8123   # then open http://localhost:8123/dev/index.html (UI with mock data)
```

## Testing

295 tests (`tests/`) check every circuit against theory. They include: Bell fidelity ≥ 0.98;
teleportation of 6 states; Werner noise at F = 0.6 / 0.8 / 0.95 within the confidence interval;
the swapping and DEJMPS formulas; ideal CHSH within 3σ of $2\sqrt2$; full interception giving
QBER ≈ 25 % and S ≈ √2; a structural check that **no circuit measures before the end**; bit
order; a fake IonQ backend that asserts **one `run` call with one packed circuit per Run**; and the
chapter 9 chain checked against the swapping formula for 1, 2 and 5 hops.

## How to extend it

- **Add a protocol:** write `build_<name>(...) -> list[QuantumCircuit]` and
  `decode_<name>(counts, ...) -> dict` in a new `quantum/<name>.py`, return metrics in the
  shared JSON contract (`value`, `ci95`, `theory`), and register it in `quantum/api.py`
  (`RUN_LEVELS`). The UI shows any level that follows the contract.
- **Change the map:** cities live in `quantum/geo.py`. Add a node and its fibre links, then
  re-bake the terrain with `tools/bake_terrain.py` (in the [source repository](https://github.com/AGONIXX15/quantum_project_qollab)).
- **Swap the noise model:** `quantum/noise.py` builds noise from environment qubits. Any Pauli
  channel or amplitude damping plugs into every chapter.
- **Reuse the IonQ packer:** `quantum/pack.py` is independent of this project. It packs any
  list of measured circuits into one, for backends that take one circuit per job.

### Fork it for your region

- City presets and the map box live in `quantum/sandbox.py` (`PRESET_CITIES`, `BBOX`: lon −92..−58, lat −8..16).
  Edit those, and `quantum/geo.py` for the three main cities, to use your own nodes.
- The 3D terrain is baked for the current region only. A new region also needs
  `python3 tools/bake_terrain.py [--cache DIR]` (Pillow + numpy, downloads the map data) with its
  `BBOX` edited (the UI reads the box from the baked data), and the same box in `quantum/sandbox.py`.

| Module | Role |
|---|---|
| `quantum/links.py` | Bell pair and correlators (chapter 1) |
| `quantum/teleport.py` | Teleportation with Pauli frame |
| `quantum/noise.py` | Environment-qubit noise (Werner, damping, Pauli) |
| `quantum/swap.py` | Entanglement swapping |
| `quantum/purify.py` | DEJMPS, fixed and adaptive |
| `quantum/qkd.py` | E91/BBM92, spy, CHSH, key rates |
| `quantum/rescue.py` | Capstone strategy search |
| `quantum/sandbox.py` | Chapter 9: graph validation, route choice, N-hop swapping chain |
| `quantum/analysis.py` | Correlators, confidence intervals, key rates |
| `quantum/batch.py`, `pack.py`, `execute.py` | Batching, IonQ packing, backend handling |
| `quantum/geo.py` | Cities, fibre lengths, loss |
| `ui/` | three.js map, panels, tour, glossary, i18n |

## Honest limits

- This is a **teaching lab, not a network simulator**. Photons, timing, memories and
  classical communication are modelled analytically (fibre loss sets rates). They are not
  simulated physically.
- Noise is **injected** through environment qubits with chosen parameters. On the noiseless
  simulator, the fidelities you see are the ones you configured. On noisy backends, hardware
  noise adds to them.
- Key rates are **asymptotic** (Shor–Preskill and biased bases). A real finite key needs
  thousands of pairs. "Device-informed" CHSH uses known angles, so it is **not**
  device-independent security.
- On IonQ, only one chapter runs live per Run, and distillation and rescue are reduced to fit
  25–29 qubits. Recorded results are always labelled with their backend and date.
- Real hardware covers only chapter 1, from a single run of 1000 shots. Our readout mitigation
  assumes the identity logical-to-physical qubit mapping and does not propagate calibration
  uncertainty, so the mitigated value is indicative.
- Chapter 9 treats each link as a single fibre span between two cities. Noise is a Werner
  channel per link, applied in precision mode. "Raw pairs per delivered pair" is the number of
  pairs generated while waiting for the slowest link (hops / η_min, ideal memories). The app
  runs at most 6 hops on simulators and 4 on IonQ.
- Nothing here claims a quantum advantage. The goal is understanding.

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
