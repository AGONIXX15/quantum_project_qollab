# Integración de la UI con `quantum.api` (para quien hace el frontend)

Contrato: llamadas **posicionales** `fn.callPromising(backend, ...)` (patrón probado en Qollab). Pasar el backend con `callPromisingKwargs({backend})` NO está verificado: no lo uses (el botón "Diagnose backend" del arnés de humo lo comprueba).

## Reglas

- `backend` es una variable global que crea Qollab; nunca la crees.
- Punto de entrada recomendado: `api.run_level.callPromising(backend, 'link', {shots: 1000})` (niveles: link, teleport, noise, swap, purify, qkd, rescue). En IonQ **1 Run = 1 nivel**: el proxy de IonQ en Qollab solo acepta trabajos de UN circuito (`ionq.circuit.v1`; con una lista de >1 circuitos devuelve `400 Only job type ionq.circuit.v1 is supported`), así que el nivel pedido se empaqueta en un solo circuito (sus circuitos lado a lado en qubits disjuntos, un registro clásico compartido, y los conteos se separan en Python). Un trabajo tarda ~13 s sin importar el tamaño. Volver a pedir el mismo nivel en el mismo Run se sirve desde caché (`cached_run: true`); otro nivel devuelve `ionq_job_used` (+ `fallback` grabado: etiquétalo como "recorded").
- Convierte siempre con `proxy.toJs({dict_converter: Object.fromEntries})` y luego `proxy.destroy()`.
- Estados de la UI: `ready` / `running` / `success` / `failed`. Nunca dejes "Running…" tras un error (usa `finally`).
- Flag `busy`: desactiva todos los botones mientras corre una llamada.
- Timeout de 180 s con `Promise.race` y un contador de segundos transcurridos.
- Ignora resultados viejos con un id de petición (`const id = ++lastId; ... if (id !== lastId) return;`).
- Si `ok:false`: muestra `error` como texto Y, si existe `fallback` (no nulo), dibuja `fallback.result` con una etiqueta visible `recorded <backend> <timestamp>` (con texto, no solo color). Los errores de entrada del usuario (validación, argumentos desconocidos) traen `input_error: true` y no tienen `fallback`: solo muestra el error.
- Si hay timeout: llama `api.load_recorded.callPromising()` y muestra `recorded[i].result.levels[nivel]` de la misma forma (con la etiqueta "recorded").
- Con `code: "ionq_job_used"`: un solo trabajo IonQ por Run; indica "Pulsa Run de nuevo para un nuevo trabajo".
- Con `code: "ionq_too_wide"` (`needed_qubits`, `max_qubits`): el nivel no cabe en un circuito del backend (ancho = `backend.num_qubits`, 29 en Forte sim, 25 en Aria); no se envió nada. Se debe mostrar el `fallback` grabado.
- Si `params_ignored` es `true` (mismo nivel pedido otra vez con otros parámetros), la UI debe mostrar los `params` efectivos que devuelve el resultado, no los solicitados.
- Si `viz.recommendation.incomplete` es `true` (rescue reducido), hay estrategias no medidas (`recommendation.not_measured`, p. ej. `["reroute"]`): la recomendación solo cubre las medidas y el mensaje lo dice. Cada estrategia en `viz.strategies` con `status: "not_run"` tiene la misma forma que las medidas, sin `null` que formatear: `fidelity` y `raw_pairs` son métricas con el valor TEÓRICO, `measured: false` y `label: "theory only (not measured)"` (muéstralo así, nunca como medido), más `theory_meets_target` (bool) y `explanation`. Estados posibles: `ok`, `no_data`, `not_run`.
- Un envío rechazado (`backend.run` lanza error) NO gasta el Run: se puede reintentar en el mismo Run. Si el trabajo fue aceptado y falla después, sí queda gastado (`ionq_job_used`).
- En IonQ el resultado trae `source: "ionq_packed"`, `circuits[-1]` = circuito empaquetado (`id: "packed"`), `packed` (layout, conteos crudos), `bit_order` con el layout empaquetado y `counts` por sub-circuito original. Si el nivel se tuvo que reducir: `ionq_reduced: true` + `ionq_note` (lista): muéstralo. `full_batch` ya no funciona en IonQ (`ionq_use_run_level`, sin enviar nada); y los botones sueltos `level_*` tampoco.

### Qubits del circuito empaquetado con los parámetros por defecto

| Nivel | Qubits | Notas |
|---|---|---|
| link | 14 | 6 + calibración de lectura (8): con mitigación de lectura |
| teleport | 15 | |
| noise | 14 | 6 + lectura (8) |
| swap | 12 | |
| qkd | 18 | |
| purify | 27 | reducido: tomografía + solo la U predicha (sin la línea base U=I); no cabe en Aria (25) -> `ionq_too_wide` |
| rescue | 18 (30 si el backend tiene >=30) | reducido: sin la estrategia `reroute` (`status: "not_run"`) |

La mitigación de lectura solo se aplica a link y noise, y solo si la calibración cabe junto al nivel (si no, nota en `viz.notes`).

## Importante: el código de nivel superior de `main.js` NUNCA debe terminar (IonQ)

Verificado en Qollab el 9 oct: Qollab solo deja enviar trabajos a IonQ **mientras el código de nivel superior de `main.js` sigue pendiente**. Cuando termina (la consola de Qollab dice "Done."), cualquier `backend.run` lanzado después desde un clic falla en ~0,5 s con `ConnectionError ... Failed to fetch`. Con el mismo circuito Bell: enviado dentro del run activo → OK; enviado tras "Done." → falla. En BasicSimulator no se nota (no usa red).

Por eso, la **última línea** de `main.js`, después de registrar todos los listeners, debe ser:

```js
await new Promise(() => {});   // keep the Qollab run alive so button clicks can still reach IonQ
```

El botón Stop de Qollab sigue terminando el run. No pongas nada después de esa línea.

## Importante: Python bloquea el hilo principal

Pyodide ejecuta Python de forma síncrona en el hilo principal del navegador. Mientras Python calcula (simuladores locales), **el timeout y el contador de JS no pueden dispararse** y la página queda congelada; solo funcionan durante esperas asíncronas reales (el trabajo remoto de IonQ). Por eso mantén pequeños los shots y circuitos en modo live (p. ej. 300-1000 shots) y no confíes en el timeout para interrumpir cálculo local.

## Snippet `callApi` (copiar y pegar)

`backend` es la variable global que crea Qollab (diálogo "Select QPU"); se usa tal cual, sin importarla ni crearla (mismo patrón que `tools/qollab_smoke/main.js` y el probe). Devuelve `null` si el resultado es viejo (otra petición lo reemplazó): **ignóralo, no pintes nada**. Los botones deben desactivarse mientras `busy` sea true (`onState('running')` / `onState('success'|'failed')`).

```js
import * as api from 'quantum.api';
let lastId = 0, busy = false;
const TIMEOUT_MS = 180000;
const plain = (p) => { try { return p.toJs({ dict_converter: Object.fromEntries }); } finally { p.destroy?.(); } };

export async function callApi(fn, args, { onState, onTick }) {
  if (busy) return null;                               // buttons must also be disabled
  busy = true;
  const id = ++lastId, t0 = performance.now();
  onState('running');
  const tick = setInterval(() => onTick?.(Math.round((performance.now() - t0) / 1000)), 1000);
  let timer, timedOut = false;
  const call = fn.callPromising(backend, ...args);     // positional; backend is Qollab's global
  try {
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => { timedOut = true; rej(new Error('timeout')); }, TIMEOUT_MS); });
    const res = plain(await Promise.race([call, timeout]));
    if (id !== lastId) return null;                    // stale: ignore
    onState(res.ok ? 'success' : 'failed');
    return res;                                        // !res.ok: show res.error and res.fallback (recorded)
  } catch (err) {
    if (timedOut) call.then((p) => p?.destroy?.(), () => {});   // free the late proxy
    if (id !== lastId) return null;
    onState('failed');
    if (!timedOut) return { ok: false, error: String(err) };
    try {                                              // timeout: fall back to the recorded run
      const rec = plain(await api.load_recorded.callPromising());
      if (id !== lastId) return null;                  // re-check after the await
      return { ok: false, error: 'timeout', recorded: rec };
    } catch (e2) {
      return { ok: false, error: `timeout; recorded fallback failed: ${e2}` };
    }
  } finally { clearTimeout(timer); clearInterval(tick); busy = false; }
}
// usage: callApi(api.run_level, ['link', { shots: 1000 }], { onState, onTick })
```

## Detalles a recordar

- `level_teleport` ahora usa por defecto ruido (F = 0.8); para teleportación sin ruido envía `F: null`.
- En `level_qkd`, `F` (ruido Werner) exige `theta_deg = 0`; con espía (`theta_deg` > 0) no envíes `F`. En IonQ, `F` de qkd no está disponible.
- `level_purify`: si envías `F` o `p`, `gamma` se ignora; sin canal usa gamma (modo teaching) o F = 0.8 (modo precision).
- Los ángulos van en grados.
