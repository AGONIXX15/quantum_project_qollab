# Web 3D — Entangle the Andes

Tablero interactivo en 3D de la red cuántica Bogotá – Medellín – Cali, sobre
[three.js](https://threejs.org) (MIT). Habla con la física del proyecto a través de
`quantum/api.py`. Interfaz **bilingüe EN/ES** (inglés por defecto; el botón de idioma
no guarda nada: Qollab no tiene almacenamiento).

## Estructura

```
index.html        # SOLO contenido de <body> (fuente de verdad del marcado). Sin html/head/script/importmap/link.
main.css          # única hoja de estilos (Qollab solo carga esta)
main.js           # orquestador; import ESTÁTICO de 'quantum.api'; última línea = keep-alive IonQ
ui/
  api-bridge.js   # callApi (busy, id anti-resultados viejos, timeout 180 s, load_recorded) + runLevel
  mock-api.js     # SOLO local: imita el módulo Python quantum.api (info, run_level, load_recorded...)
  mock-data.js    # datos del mock con la forma ACTUAL de los resultados (no son mediciones)
  i18n.js         # diccionarios EN/ES, t(), applyI18n(), setLang()
  explain.js      # capa educativa ("¿Qué estoy viendo?") sobre i18n
  panel.js        # formulario desde info() y render de resultados / errores / recorded
  scene.js        # escena three.js (terreno, ciudades, enlaces, fotones, bloom)
  colombia-geo.js # contorno de Colombia + relieve procedural
dev/index.html    # SOLO local (no se sube): página completa con import map; GENERADA
tools/make_dev_html.sh   # regenera dev/index.html desde index.html
tools/build_qollab.sh    # empaqueta dist/qollab_app.zip para Qollab
```

`index.html` (raíz) es la fuente de verdad del marcado. Tras editarlo, ejecuta
`tools/make_dev_html.sh`; no edites `dev/index.html` a mano.

## Cómo habla con Python (igual en local y en Qollab)

- `main.js` hace `import * as api from 'quantum.api'` (estático: el import dinámico
  falla en Qollab). Localmente el import map de `dev/index.html` apunta ese nombre a
  `ui/mock-api.js`, así que el bridge es idéntico en ambos sitios.
- **Todos** los niveles pasan por `api.run_level.callPromising(backend, nivel, params)`
  (posicional; `backend` es un global que crea Qollab; niveles: link, teleport, noise,
  swap, purify, qkd, rescue). `full_batch` y `level_*` no se usan.
- En IonQ **1 Run = 1 nivel** (un circuito empaquetado). Pedir otro nivel en el mismo Run
  devuelve `ionq_job_used` + `fallback` grabado: la UI lo dibuja con la etiqueta visible
  "Recorded · backend · fecha" y dice "Stop → Run". `ionq_too_wide` muestra qubits
  necesarios vs máximos; `input_error` solo muestra el error.
- **Keep-alive**: la última línea de `main.js` es `await new Promise(() => {})`. Qollab solo
  deja enviar trabajos a IonQ mientras el código de nivel superior sigue pendiente. Stop
  sigue terminando el Run. No pongas nada después de esa línea.
- Los parámetros opcionales (`default: null`) tienen estado "apagado" y no se envían:
  purify manda exactamente uno de gamma / F / p; qkd manda F solo con θ = 0 y nunca en IonQ.
- Todo texto que viene del backend (nombre, errores, notas, explicaciones) se inserta con
  `textContent`.

## Tecnologías visuales

Sin bundler ni assets binarios. En Qollab, `three` y `three/addons/...` (three.js 0.186.1) se importan por nombre; en local, `dev/index.html` los mapea al CDN (jsdelivr):

- **three.js** con `WebGLRenderer` en ACES Filmic + sRGB y sombras suaves.
- **Postprocesado** (`EffectComposer` + `UnrealBloomPass` + `OutputPass`): todo
  lo luminoso (nodos, enlaces, fotones) resplandece.
- **Terreno de Colombia**: malla deformada por un heightmap **procedural** que
  modela las tres cordilleras de los Andes, la Sierra Nevada y los llanos, con
  color por altura (selva → roca → nieve), recortada por el contorno real del
  país. Alrededor, un **mar con shader** de olas y espuma.
- **Shaders propios** (GLSL) para el cielo (domo con degradado), el mar y los
  **enlaces** (pulsos de energía que viajan por la fibra, coloreados por
  fidelidad).
- **Etiquetas HTML nítidas** con `CSS2DRenderer` (no pixeladas).
- **Fotones** con `InstancedMesh` (cientos sin perder fps).

> Rendimiento: en una máquina con GPU corre fluido (~60fps). En render por
> software (headless/SwiftShader) baja mucho; es esperado y no indica un
> problema de la escena.

## Capa educativa (qué es cada cosa)

- **Leyenda** permanente (abajo al centro, colapsable): explica las bolas
  azul/cian (paridad 0, resultado igual, sano) y naranja (paridad 1, error), los
  colores de enlace (sano/degradado/roto/rescatado) y las ciudades.
- **Tooltips** al pasar el ratón sobre una ciudad (nodo QPU).
- **Panel "¿Qué estoy viendo?"** (arriba del panel de resultados): explica la
  física del nivel en lenguaje simple y, tras ejecutar, resume la lectura del
  resultado. Los textos viven en `ui/explain.js`.

## Desarrollo local

No necesita Qollab ni Qiskit; solo un servidor estático (todo son módulos ES nativos) y
acceso a jsdelivr para three.js y a Google Fonts (si las fuentes no cargan, se usa la
tipografía del sistema):

```bash
tools/make_dev_html.sh            # si cambiaste index.html
python3 -m http.server 8123       # desde la raíz del repo
# abrir http://localhost:8123/dev/index.html
```

Interruptores de prueba (query string; ver `ui/mock-api.js`):

- `?mock=ionq` simula IonQ: el primer nivel va como `ionq_packed`; repetirlo sale de la
  caché (`cached_run`); otro nivel da `ionq_job_used` + recorded; rescue sale reducido.
- `?mock=aria` igual, pero purify da `ionq_too_wide` (27 > 25 qubits).
- `?mock=hang&timeout_ms=3000` la llamada nunca responde: prueba el timeout y el recorded.

El badge `backend: local_mock` indica el mock. Los números del mock son plausibles, **no**
mediciones.

## Subir a Qollab

```bash
tools/build_qollab.sh      # -> dist/qollab_app/ y dist/qollab_app.zip
```

Sube el contenido del zip (`index.html`, `main.js`, `main.css`, `ui/`, `quantum/`, `data/`,
`requirements.txt`, `README.md`, `LICENSE`; sin `dev/`). Elige un simulador o QPU en
**Select QPU** y pulsa **Run**. Para un segundo nivel en IonQ: Stop y Run de nuevo.

## Accesibilidad

Foco visible (`:focus-visible`), `aria-live` en estado y resultados, ciudades también como
botones de teclado (además del hover 3D), estados con texto e icono (no solo color),
controles con etiqueta, contraste AA y `prefers-reduced-motion` (render estático: sin
fotones en movimiento, olas, pulsos ni giro automático).

## La IA en este proyecto

La IA se usó **solo en tiempo de desarrollo** (construir y revisar el código). La web no
llama a ningún modelo en runtime ni necesita API keys; las únicas peticiones externas son
GET de fuentes (Google Fonts) y, solo en `dev/`, el CDN de three.js.
