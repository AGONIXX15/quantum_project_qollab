# Web 3D — Entangle the Andes

Tablero interactivo en 3D de la red cuántica Bogotá – Medellín – Cali. Se
construye sobre [three.js](https://threejs.org) (MIT) y habla con la física del
proyecto a través de `quantum/api.py`.

## Qué hay aquí

```
index.html        # raíz: hace que Qollab trate el proyecto como JS. Import map de three.js.
main.css          # tema "noche andina": loader, paneles glass, leyenda, tooltip, métricas
main.js           # orquestador (idéntico en local y en Qollab)
ui/
  api-bridge.js   # capa de datos: Qollab (api real) vs local (mock)
  mock-data.js    # mock para desarrollo local (espejo de geo.py + viz/metrics)
  colombia-geo.js # contorno real de Colombia + relieve procedural (Andes, mar)
  scene.js        # escena three.js de alta calidad (terreno, ciudades, enlaces, fotones, bloom)
  panel.js        # formulario de parámetros (data-driven desde info()) y métricas
  explain.js      # textos educativos por nivel + tooltips (capa "¿Qué estoy viendo?")
```

## Tecnologías visuales

Todo se carga por import map desde el CDN de three.js (sin bundler, sin assets
binarios), así que es portable al iframe de Qollab:

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

- **Leyenda** permanente (abajo a la izquierda, colapsable): explica las bolas
  azul/cian (paridad 0, resultado igual, sano) y naranja (paridad 1, error), los
  colores de enlace (sano/degradado/roto/rescatado) y las ciudades.
- **Tooltips** al pasar el ratón sobre una ciudad (nodo QPU).
- **Panel "¿Qué estoy viendo?"** (arriba del panel de resultados): explica la
  física del nivel en lenguaje simple y, tras ejecutar, resume la lectura del
  resultado. Los textos viven en `ui/explain.js`.

## Desarrollo local

No necesita Qollab ni Qiskit. Un servidor estático basta porque todo son
módulos ES nativos:

```bash
# desde la raíz del repo
python3 -m http.server 8123
# abrir http://localhost:8123
```

En local, `api-bridge.js` detecta que no existe el global `backend` ni el
módulo Python `quantum.api`, así que usa `ui/mock-data.js`. El mock devuelve
objetos con **la misma forma** del contrato JSON del backend (`metrics`, `viz`,
`counts`...), con números plausibles derivados de las mismas fórmulas de la
física — útiles para ver la UI, **no** son mediciones.

El badge `backend: local_mock` indica que estás en modo mock.

## Subir a Qollab

1. Sube el repo completo (incluye `quantum/` y estos archivos de la raíz).
2. Como `index.html` y `main.js` están en la raíz, Qollab lo trata como
   **proyecto JS** automáticamente (ver *The runtime environment* en los docs).
3. Elige un simulador o QPU en **Select QPU** y pulsa **Run**.

En Qollab, `api-bridge.js` detecta el global `backend` inyectado por el runtime
e importa `quantum.api`, llamando a las funciones Python con
`callPromisingKwargs({...})` y desenvolviendo el resultado con `.toJs()`.

### IonQ: un solo job por run

Los backends IonQ aceptan **un** `backend.run` por ejecución. Los niveles
sueltos (`level_*`) se niegan con el código `ionq_use_full_batch`. El bridge lo
maneja: cuando el backend es IonQ y pides un nivel suelto, redirige a
`full_batch` (un solo job con todos los circuitos) y extrae el nivel pedido.
`rescue` ya es un solo job y se permite directamente.

> Limitación conocida: el formulario de `purify` expone `F` y `gamma` como
> controles separados. En el camino IonQ→`full_batch`, el backend exige
> exactamente uno de `F`/`gamma`/`p`. Para IonQ, deja solo uno con valor.

## Portabilidad del import map

`index.html` carga three.js desde `unpkg.com` con un `<script type="importmap">`.
Esto funciona en el navegador local y en el iframe de Qollab. Si el sandbox de
Qollab bloqueara el CDN, descarga `three.module.js` y `examples/jsm/` a
`ui/vendor/` y apunta el import map a esas rutas relativas.

## La IA en este proyecto

La IA se usó **solo en tiempo de desarrollo** (construir y revisar el código).
La web es autocontenida: no llama a ningún modelo en runtime, no necesita API
keys ni hace peticiones externas más allá del CDN de three.js.
