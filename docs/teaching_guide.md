# Teaching guide: a 50-minute lesson with Entangle the Andes

**Audience:** high school or first-year university, no physics background.
**Setup:** one browser per pair of students, the project open on Qollab with **Built-in simulator** selected in *Select QPU* (free, no install). The first load takes about 1-2 minutes, so open it before class. Use **Intro** for the guided tour and **EN/ES** to switch language.

**Punchline of the lesson: noise is someone listening.** When a link gets noisy, information about the pair is leaking to the outside world. A spy works the same way. Entanglement is monogamous: the more a third party is correlated with Bob, the less Alice can be. Everything in the lesson builds toward this one sentence.

Chapter numbers below are the ones in the README table. Every number in the answers comes from the formulas in `quantum/*.py` or from the README. Results from live runs vary within their 95 % confidence interval, so tell students to compare against the interval, not the exact digit. This guide makes no claim of quantum advantage: the goal is understanding.

## Timeline

| Minutes | Block |
|---|---|
| 0-5 | Hook and Intro tour |
| 5-12 | Chapter 1: First link |
| 12-20 | Chapter 2: Teleportation |
| 20-30 | Chapter 3: Noise is someone listening (lab) |
| 30-40 | Chapter 7: Catch the spy |
| 40-48 | Chapter 9: Build your own network (sandbox) |
| 48-50 | Punchline and exit question |

**Hook (0-5 min).** Ask: "How would you send a secret across Colombia if anyone could be listening?" Show the map (Bogotá, Medellín, Cali) and run the Intro tour. Explain that every link is a real Qiskit circuit and every result shows a value, a 95 % confidence interval and the theory.

## Chapter 1: First link (7 min)

**Students do:** press Run on the first link. Read the three correlators ⟨XX⟩, ⟨YY⟩, ⟨ZZ⟩ and the fidelity with its interval.

1. **What does fidelity F measure, and what value does a perfect Bell pair give?**
   Fidelity measures how close the pair is to the ideal Bell pair. It is computed from three correlators: F = (1 + ⟨XX⟩ − ⟨YY⟩ + ⟨ZZ⟩)/4. A perfect pair has ⟨XX⟩ = 1, ⟨YY⟩ = −1, ⟨ZZ⟩ = 1, so F = 1.
2. **Why does the app show an interval such as [0.998, 1.000] and not just one number?**
   Each result comes from a finite number of shots (1000 by default). The 95 % confidence interval says how much the number could move if the experiment were repeated. Theory should fall inside it.
3. **Is the real hardware result also perfect?**
   Not quite. In the README, the real IonQ Forte 1 run (1000 shots, 11 Oct 2026) measured F = 0.984 [0.979, 0.990], and 0.990 [0.986, 0.995] with readout mitigation, against an ideal 1. Real devices add noise on top of the circuit.

## Chapter 2: Teleportation (8 min)

**Students do:** set the link fidelity F (for example 0.8), run teleportation and read Bob's teleported fidelity. Try a lower F and a higher F.

1. **What does teleportation send: the qubit, or the information about it?**
   It sends the state, using the shared entangled pair plus two classical bits. The app applies the corrections in Python as a Pauli frame (an X outcome flips Z-basis bits, a Z outcome flips X-basis bits, both flip Y).
2. **What fidelity should teleportation reach with a link of fidelity F, and what is the classical limit?**
   F_tel = (2F + 1)/3. A purely classical strategy (measure and send the result) reaches at most 2/3.
3. **For which links is teleportation better than classical?**
   F_tel > 2/3 means 2F + 1 > 2, so F > 0.5. At F = 0.8 the formula gives 0.867. The README's recorded run measured 0.875 [0.847, 0.902] against 0.867 theory, clearly above 2/3.

## Chapter 3: Noise is someone listening, lab (10 min)

**Students do:** move the fidelity dial to F = 0.95, 0.80 and 0.60, run each, and compare measured and configured fidelity.

1. **Where does the noise come from in the circuit?**
   From two extra "environment" qubits. The environment starts in √F|00⟩ + √((1−F)/3)(|01⟩ + |10⟩ + |11⟩) and acts on Bob through CX and CZ. The result is exactly a Werner state of fidelity F. Noise is information leaking into the environment.
2. **Do the measured fidelities match what was configured?**
   They should, within the confidence interval. The README's recorded run gives 0.947 / 0.795 / 0.613 for configured 0.95 / 0.80 / 0.60. On the noiseless simulator, the fidelity you see is the one you configured.
3. **How often would Alice and Bob's key bits disagree at each F?**
   QBER = 2(1 − F)/3. That is 0.033 at F = 0.95, 0.133 at F = 0.80 and 0.267 at F = 0.60. Noise looks like a listener because it produces errors in the same way.

## Chapter 7: Catch the spy (10 min)

**Students do:** raise the spy angle θ from 0 upward, run it, and watch QBER per basis, CHSH S and the key rate. Run θ = 120° and θ = 180°. For the explainer version, chapter 4 shows the same fidelity loss for noise and for a spy side by side.

1. **What does the spy do, and what happens at θ = 0 and θ = 180°?**
   The spy entangles itself with Bob's qubit through a controlled rotation CR_Y(θ). At θ = 0 nobody is listening. At θ = π the spy intercepts everything: the average QBER is 25 % and CHSH falls to S = √2, below the classical bound of 2.
2. **At what fidelity does the CHSH test stop proving entanglement, and when can Alice and Bob still make a secret key?**
   For a Werner pair, S = 2√2(4F − 1)/3. It exceeds 2 only if F > 0.7803. A secret key needs r = 1 − 2h(Q) > 0, which holds for QBER < 11 %, equivalent to F > 0.835. So the key threshold is stricter than the CHSH threshold.
3. **At θ = 120°, what does the spy leave behind?**
   With c = cos(θ/2) = 0.5: the fidelity is F = (1 + c)/2 = 0.75. QBER in the Z basis is 0 and in the X basis (1 − c)/2 = 0.25, so a spy hides in one basis and shows in the other. F = 0.75 is already below the Werner CHSH threshold of 0.7803, yet with standard angles the spy still gives S = √2(1 + c) = 2.12 > 2: a violation. The spy only breaks CHSH beyond θ = 131.1°, so its fingerprint differs from plain noise, and the key rate is 0 anyway. The README's recorded run measured QBER X = 0.264 [0.238, 0.292] and key rate 0 with the standard method.

## Chapter 9: Build your own network, sandbox (8 min)

**Students do:** the exercise below.

### Exercise: design a Bogotá-Cali network that still allows a secret key (F > 0.835)

Rules of the sandbox (from `quantum/sandbox.py`): at most 12 cities and 20 links; each link has a fidelity F between 0.5 and 1.0; the chosen route may have at most 6 hops on simulators (4 on IonQ). Cities are placed inside the map region lat −8..16, lon −92..−58. Presets: Bogotá (BOG), Medellín (MED), Cali (CAL), Cartagena (CTG), Barranquilla (BAQ), Bucaramanga (BGA), Pasto (PSO), Leticia (LET), Caracas (CCS), Maracaibo (MAR), Quito (UIO), Guayaquil (GYE), Panama City (PTY), San José (CR), Managua (MGA). Typed coordinates work as an alternative to clicking the map.

1. **Start from the direct link.** Add Bogotá and Cali, link them with F = 0.70, and choose Bogotá as source and Cali as destination. Run. The end-to-end F is 0.70: below 0.7803 (no CHSH violation) and below 0.835 (no key).
2. **Add a relay.** Add Medellín and links Bogotá-Medellín (F = 0.95) and Medellín-Cali (F = 0.90). The app picks the route with the highest theory F. By the swapping formula, F = F1·F2 + (1 − F1)(1 − F2)/3 = 0.95 × 0.90 + 0.05 × 0.10/3 = 0.857, which is above 0.835. A key is possible.
3. **Break it on purpose.** Lower Medellín-Cali to F = 0.85. Then F = 0.95 × 0.85 + 0.05 × 0.15/3 = 0.810, below 0.835. Raising the weakest link matters most.
4. **Add hops.** With links of F = 0.95, two hops give F = 0.903, three hops about 0.860 and four hops about 0.819, which is below 0.835. Each extra repeater multiplies the rate of pairs but lowers F (README: more than 3 segments push F below the key threshold with F = 0.95 links).
5. **Read the panel.** It lists alternative routes with their theory F, the measured correlators against theory, the fibre loss and the raw pairs needed. Fibre length is great-circle distance × 1.3 and η = 10^(−0.02 L), so loss affects the rate, not the fidelity.

Guided questions:

1. **Which formula decides the end-to-end fidelity of two hops, and why is it never better than the weaker link?**
   F = F1·F2 + (1 − F1)(1 − F2)/3. For F1, F2 ≥ 0.5 (the sandbox range) the result is at most min(F1, F2): e.g. F1 = F2 = 0.95 gives 0.903, so every extra hop costs fidelity.
2. **Why does a direct Bogotá-Cali link of F = 0.70 fail while a relay through Medellín can work?**
   The direct link is below the key threshold of 0.835 (and below 0.7803). The relay chains two better links. The README's chapter 8 run shows the same idea: BOG-CAL damaged to F = 0.7 gives no key, and the reroute via Medellín reaches F 0.91 (theory 0.90).
3. **Why can the sandbox not simply say "use more cities to go farther"?**
   Every added hop lowers F, as in step 4. Long distances need repeaters because of fibre loss, and repeaters need good links or purification to stay above the key threshold.

## Exit question and punchline (2 min)

Ask: "A link in our network lost fidelity. Is it noise, or is someone listening?" Answer: from fidelity alone you cannot tell. Both are information leaking to a third system. The fingerprint differs: for the same fidelity, a spy breaks CHSH at 131.1° while environmental noise of the same fidelity breaks it at 111.8° (README), and the spy leaves the Z basis untouched. **Noise is someone listening.**

## Optional extensions

- **Chapter 4, Noise is someone listening (explainer):** one dial for how much leaks to a third qubit, comparing environment and spy.
- **Chapter 5, Repeater (swapping):** the swapping formula F1·F2 + (1 − F1)(1 − F2)/3 with real circuits. The README's run for F1 = 0.95, F2 = 0.90 measured 0.860 [0.844, 0.875] against 0.857.
- **Chapter 6, Distillation:** DEJMPS postselection. Success probability p_s = F² + 2F(1−F)/3 + 5((1−F)/3)² and output F' = (F² + ((1−F)/3)²)/p_s. In the README's amplitude-damping run, the textbook round gives 0.890 and the adaptive round 0.980.
- **Chapter 8, Save the Quantum Network:** a link breaks and students choose between direct, reroute and purify.

## Resumen en español

Plan de clase de 50 minutos (bachillerato o primer año universitario, sin base de física) con la aplicación Entangle the Andes en el simulador Built-in de Qollab. Orden: capítulo 1 (primer enlace, 7 min), 2 (teleportación, 8 min), 3 (el ruido es alguien que escucha, 10 min), 7 (atrapa al espía, 10 min) y 9 (red propia, 8 min), más 5 min de introducción y 2 min de cierre. Los capítulos 4, 5, 6 y 8 son extensiones opcionales. Cada capítulo trae tres preguntas guiadas con respuesta, todas basadas en fórmulas y cifras del repositorio: F = (1+⟨XX⟩−⟨YY⟩+⟨ZZ⟩)/4; teleportación F = (2F+1)/3 frente al límite clásico 2/3; CHSH se viola si F > 0,7803; hay clave si F > 0,835 (QBER < 11 %); y el intercambio de entrelazamiento da F1·F2 + (1−F1)(1−F2)/3. El ejercicio del capítulo 9 pide diseñar una red Bogotá-Cali que aún permita clave secreta (F > 0,835), por ejemplo con un relevo en Medellín (0,95 y 0,90 dan 0,857). La idea final: el ruido es alguien que escucha. No se afirma ventaja cuántica.
