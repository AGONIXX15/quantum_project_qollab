# Estado del proyecto — 10 oct 2026, ~03:30 COT

Documento interno de traspaso. Lo público (en inglés) está en `README.md`.

## Dónde está todo

| Rama | Contenido | Estado |
|---|---|---|
| `main` | Core + UI integrada + UI pulida (fases 1 y 2) | Lo más reciente. La UI pulida aún **no** se probó en Qollab real |
| `ui-polish` | Igual que `main` (rama de trabajo de la UI pulida) | — |
| `integration` | Core + UI de Pablo corregida (sin la UI pulida) | **Verificada en Qollab real** (BasicSimulator 7 niveles + IonQ) |
| `p0-no-failed-runs` | Solo el core endurecido | Histórica |
| `pablo` | Primera UI de Pablo | Histórica; Pablo debe seguir desde `main` |

Si la prueba en Qollab de la UI pulida falla y no hay tiempo de arreglarla, el plan B es volver a la
versión de `integration` (commit `7816729`), que ya funcionó en Qollab.

## Cómo correr y empaquetar

- Tests: `uv run --offline pytest -q` (247 pasan).
- UI local con datos simulados: `tools/make_dev_html.sh` (solo si cambió `index.html`), luego
  `python3 -m http.server 8123` y abrir `http://localhost:8123/dev/index.html`.
  Interruptores: `?mock=ionq` (IonQ simulado), `?mock=aria`, `?mock=hang&timeout_ms=3000`.
- ZIP para Qollab: `tools/build_qollab.sh` → `dist/qollab_app.zip` (36 archivos). El script falla si
  hay >100 archivos, alguno >2 MB, imports no permitidos o archivos de prueba (mock).
- Terreno: `uv run --offline python tools/bake_terrain.py` regenera `ui/data/*.js` (no hace falta
  salvo que cambie el área del mapa).

## Pendiente (en orden)

1. **Probar la UI pulida en Qollab real** (subir `dist/qollab_app.zip` como borrador nuevo):
   - Built-in simulator: al dar Run, el primer nivel debe correr solo; luego los 8 capítulos,
     incluido "Noise is someone listening" con "Measure it" (puntos medidos sobre la teoría; el del
     espía debe quedar en el ángulo del dial).
   - IonQ Forte 1 (simulador gratuito, no el de "Quantum Computer"): el primer nivel corre en vivo
     (~13 s); el siguiente debe mostrar "Showing recorded result", nunca "Failed".
   - Revisar que carguen las fuentes, la escena 3D y el recorrido guiado; probar EN/ES.
2. En Qollab, dejar el **Built-in simulator como backend por defecto** del proyecto (consejo del
   mentor: los jueces corren el simulador por defecto, y IonQ acepta un solo circuito por job).
3. **Publicar una versión** antes del domingo: https://qollab.xyz/learn/docs/publish
4. Video demo de 2–3 min (YouTube no listado), guion centrado en "noise is someone listening".
5. README como Project Card completa (qué hace, problema, cómo correr, cómo extender, límites
   honestos). Las secciones de créditos y declaración de IA ya están completas.
6. Entregar desde la team page (capitán), tema **Quantum Unlocked**. Cierre: dom 11 oct, 18:00 COT.

## Hechos de la plataforma comprobados (no volver a dudar)

- Solo funciona `import * as api from 'quantum.api'` estático; llamadas posicionales `callPromising`.
- IonQ: **un job por Run y un circuito por job** (confirmado por un mentor). La app junta los circuitos
  de un nivel en uno solo (`quantum/pack.py`), 1 Run = 1 nivel.
- IonQ solo acepta envíos mientras el código de nivel superior de `main.js` sigue pendiente; por eso
  `main.js` termina con `await new Promise(() => {})`.
- `index.html` se inserta dentro del body; solo se carga `main.css`; `three` y `three/addons` vienen
  incluidos (0.186.1). El cargador de Qollab separa `README.md` como texto del proyecto y omite
  archivos vacíos.

## Fuentes y créditos

Todo está en `README.md` → "Prior work & AI disclosure" y "References & credits":
declaración de IA (Claude Code, UI con ayuda
de IA, skill UI/UX Pro Max), software (Qiskit, qiskit-ionq, NumPy, three.js + addons, fuentes de
Google, Pillow), datos del mapa (AWS Terrain Tiles/Mapzen, NASA Blue Marble, Natural Earth),
trabajo relacionado (Quantum Network Explorer de QuTech) y todas las referencias científicas.
Cada módulo de `quantum/` y `ui/leak.js` cita sus fuentes en el encabezado.

## Física revisada

- Concurrencia de Werner = 2F − 1, igual a la del espía c = cos(θ/2) a la misma F (verificado con
  matrices densidad exactas). Eve no queda entrelazada por pares con Alice ni con Bob; lo que pierden
  queda como correlación a tres (monogamia, CKW). La barra del explicador usa C².
- La F del espía en el explicador se infiere del QBER (supone ⟨YY⟩ = −⟨XX⟩) y está etiquetada así.
