# Integración de la UI con `quantum.api` (para quien hace el frontend)

Contrato: llamadas **posicionales** `fn.callPromising(backend, ...)` (patrón probado en Qollab). Pasar el backend con `callPromisingKwargs({backend})` NO está verificado: no lo uses (el botón "Diagnose backend" del arnés de humo lo comprueba).

## Reglas

- `backend` es una variable global que crea Qollab; nunca la crees.
- Punto de entrada recomendado: `api.run_level.callPromising(backend, 'link', {shots: 1000})` (niveles: link, teleport, noise, swap, purify, qkd, rescue). En IonQ ejecuta un único trabajo y sirve los demás niveles desde caché.
- Convierte siempre con `proxy.toJs({dict_converter: Object.fromEntries})` y luego `proxy.destroy()`.
- Estados de la UI: `ready` / `running` / `success` / `failed`. Nunca dejes "Running…" tras un error (usa `finally`).
- Flag `busy`: desactiva todos los botones mientras corre una llamada.
- Timeout de 180 s con `Promise.race` y un contador de segundos transcurridos.
- Ignora resultados viejos con un id de petición (`const id = ++lastId; ... if (id !== lastId) return;`).
- Si `ok:false`: muestra `error` como texto Y, si existe `fallback` (no nulo), dibuja `fallback.result` con una etiqueta visible `recorded <backend> <timestamp>` (con texto, no solo color). Los errores de entrada del usuario (validación, argumentos desconocidos) traen `input_error: true` y no tienen `fallback`: solo muestra el error.
- Si hay timeout: llama `api.load_recorded.callPromising()` y muestra `recorded[i].result.levels[nivel]` de la misma forma (con la etiqueta "recorded").
- Con `code: "ionq_job_used"`: un solo trabajo IonQ por Run; indica "Pulsa Run de nuevo para un nuevo trabajo".

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
