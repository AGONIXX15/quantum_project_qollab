/*
  Capa de datos: una sola API para la UI, que funciona igual en Qollab y en local.

  En Qollab el runtime inyecta:
    - `backend` (global, elegido en "Select QPU")
    - los módulos Python importables por su nombre con puntos, p.ej. 'quantum.api'
  Las funciones Python se llaman con `.callPromisingKwargs({...})` y el resultado
  se desenvuelve con `.toJs()`.

  En local no existe ni `backend` ni el puente Pyodide, así que usamos un mock
  (ui/mock-data.js) que devuelve objetos con EXACTAMENTE la misma forma del
  contrato JSON del backend. Así `main.js` nunca distingue un modo del otro.

  IMPORTANTE: IonQ permite un solo job por run. La UI debe preferir `full_batch`
  (un solo backend.run) sobre los niveles sueltos cuando el backend es IonQ.
*/

import { makeMock } from "./mock-data.js";

// Mapa función de API -> id de nivel (para redirigir a full_batch en IonQ).
const FN_TO_LEVEL = {
  level_link: "link",
  level_teleport: "teleport",
  level_noise: "noise",
  level_swap: "swap",
  level_purify: "purify",
  level_qkd: "qkd",
};

// full_batch toma `shots` a nivel global, no por nivel: lo quitamos del dict
// de parámetros del nivel para no mandar una clave desconocida.
function stripShots(params) {
  const { shots, ...rest } = params || {};
  return rest;
}

// ¿Estamos dentro de Qollab? Heurística: existe el global `backend` y podemos
// importar dinámicamente el módulo Python 'quantum.api'. Si algo falla, local.
async function detectQollab() {
  try {
    // `backend` es un global inyectado por Qollab en main.js y sus imports.
    if (typeof backend === "undefined" || backend === null) return null;
    // Import dinámico del módulo Python expuesto como módulo JS.
    const api = await import("quantum.api");
    if (api && (api.info || api.default)) return api;
    return null;
  } catch (_err) {
    return null;
  }
}

// Convierte un resultado Python (JsProxy) a datos JS planos de forma segura.
function unwrap(value) {
  if (value && typeof value.toJs === "function") {
    return value.toJs({ dict_converter: Object.fromEntries });
  }
  return value;
}

// Llama a una función Python por el puente de Qollab, con kwargs.
async function callPy(fn, kwargs) {
  // callPromisingKwargs: variante async + keyword args del puente Qollab.
  const promise = fn.callPromisingKwargs(kwargs);
  const result = await promise;
  return unwrap(result);
}

/**
 * Crea el cliente de datos. Devuelve un objeto con:
 *   - mode: "qollab" | "local"
 *   - backendName(): string
 *   - info(): Promise<infoDict>
 *   - runLevel(levelFn, params): Promise<resultDict>   (envelope ok:true/false)
 *   - fullBatch(params): Promise<resultDict>
 */
export async function createClient() {
  const api = await detectQollab();

  if (api) {
    // -------- Modo Qollab (puente real) --------
    const name =
      typeof backend?.name === "function" ? backend.name() : (backend?.name ?? "qollab");
    const isIonq = String(name).toLowerCase().includes("ionq");

    return {
      mode: "qollab",
      isIonq,
      backendName: () => String(name),
      async info() {
        return callPy(api.info, {});
      },
      async runLevel(fnName, params) {
        const fn = api[fnName];
        if (!fn) return { ok: false, error: `función desconocida: ${fnName}` };

        // IonQ permite un solo job por run. Los niveles sueltos (level_*) se
        // niegan con el código `ionq_use_full_batch`. `rescue` y `full_batch`
        // sí son un solo job. Para que la demo funcione igual en IonQ,
        // redirigimos un nivel suelto a full_batch y extraemos ese nivel.
        const level = FN_TO_LEVEL[fnName];
        if (isIonq && fnName.startsWith("level_") && level) {
          const batch = await callPy(api.full_batch, {
            backend,
            params: { [level]: stripShots(params) },
          });
          if (batch?.ok === false) return batch;
          const one = batch?.levels?.[level];
          return one ?? { ok: false, error: `full_batch no devolvió el nivel ${level}` };
        }
        return callPy(fn, { backend, ...params });
      },
      async fullBatch(params) {
        return callPy(api.full_batch, { backend, params });
      },
    };
  }

  // -------- Modo local (mock) --------
  const mock = makeMock();
  return {
    mode: "local",
    isIonq: false,
    backendName: () => "local_mock",
    async info() {
      return mock.info();
    },
    async runLevel(fnName, params) {
      return mock.runLevel(fnName, params);
    },
    async fullBatch(params) {
      return mock.fullBatch(params);
    },
  };
}
