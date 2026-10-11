/*
  Data layer: ONE code path for Qollab and for the local dev page.

  - `api` is the namespace module `import * as api from 'quantum.api'` done
    STATICALLY in main.js (the only form Qollab resolves; dynamic import fails).
    Locally the import map points 'quantum.api' to ui/mock-api.js, which exposes
    the same functions, so nothing here knows which one it is talking to.
  - `backend` is a global created by Qollab (never created here). Calls are
    positional: fn.callPromising(backend, ...args).
  - Every level runs through api.run_level(backend, level, params), on every
    backend (on IonQ: 1 Run = 1 level = 1 packed circuit).
  - callApi follows docs/integracion_ui.md: busy flag, stale-request id,
    180 s timeout via Promise.race, recorded fallback on timeout, and it never
    leaves the UI in "running" after an error.
*/

export const DEFAULT_TIMEOUT_MS = 180000;

const plain = (p) => {
  try {
    return p && typeof p.toJs === "function" ? p.toJs({ dict_converter: Object.fromEntries }) : p;
  } finally {
    p?.destroy?.();
  }
};

// Qollab's global `backend` (undefined on the local dev page).
function backendRef() {
  return typeof backend === "undefined" ? undefined : backend;
}

export function backendName() {
  const b = backendRef();
  if (!b) return "local_mock";
  try {
    const n = b.name;
    return String(typeof n === "function" ? n.call(b) : (n ?? b.constructor?.name ?? "unknown"));
  } catch (_err) {
    return "unavailable";
  }
}

// Recorded run (api.load_recorded) -> same shape as run_level's `fallback`.
// IonQ recordings first, like the Python side. Returns null if none has the level.
export function recordedToFallback(rec, level) {
  const runs = [...(rec?.recorded ?? [])].sort(
    (a, b) => Number(!String(a.name).toLowerCase().includes("ionq")) - Number(!String(b.name).toLowerCase().includes("ionq")),
  );
  for (const run of runs) {
    const lv = run?.result?.levels?.[level];
    if (lv && lv.ok) {
      return {
        source: "recorded",
        file: run.name,
        mode: "recorded",
        backend: lv.backend ?? run.result.backend,
        timestamp: lv.timestamp ?? run.result.timestamp,
        result: lv,
      };
    }
  }
  return null;
}

export function createBridge(api, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let lastId = 0;
  let busy = false;
  let latePending = false; // a call that timed out is still running in the background

  // Race `call` against the timeout. A late proxy is destroyed when it finally settles.
  function withTimeout(call) {
    let timer;
    let timedOut = false;
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => {
        timedOut = true;
        rej(new Error("timeout"));
      }, timeoutMs);
    });
    const done = Promise.race([call, timeout]).finally(() => clearTimeout(timer));
    return { done, wasTimeout: () => timedOut };
  }

  async function info() {
    try {
      const call = api.info.callPromising();
      const { done, wasTimeout } = withTimeout(call);
      try {
        return plain(await done);
      } catch (err) {
        if (wasTimeout()) call.then((p) => p?.destroy?.(), () => {});
        throw err;
      }
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  }

  // fn.callPromising(backend, ...args) with busy/stale/timeout handling.
  // Returns null when ignored (busy) or stale (a newer request replaced it).
  async function callApi(fn, args, { onState, onTick } = {}) {
    if (busy) return null; // buttons must also be disabled by the caller
    if (latePending) {
      // A previous call timed out but has not settled: do not start another (IonQ: one job per Run).
      return { ok: false, code: "previous_pending", input_error: true, error: "Previous run still finishing…" };
    }
    busy = true;
    const id = ++lastId;
    const t0 = performance.now();
    onState?.("running");
    const tick = setInterval(() => onTick?.(Math.round((performance.now() - t0) / 1000)), 1000);
    try {
      const call = fn.callPromising(backendRef(), ...args); // positional
      const { done, wasTimeout } = withTimeout(call);
      try {
        const res = plain(await done);
        if (id !== lastId) return null; // stale: ignore
        onState?.(res?.ok ? "success" : "failed");
        return res; // !res.ok: show res.error and res.fallback (recorded)
      } catch (err) {
        const timedOut = wasTimeout();
        if (timedOut) {
          // Keep the late call tracked: no new run until it settles; destroy its proxy.
          latePending = true;
          call.then((p) => p?.destroy?.(), () => {}).finally(() => { latePending = false; });
        }
        if (id !== lastId) return null;
        onState?.("failed");
        if (!timedOut) return { ok: false, error: String(err) };
        try {
          const rec = plain(await api.load_recorded.callPromising());
          if (id !== lastId) return null; // re-check after the await
          return { ok: false, error: "timeout", timeout_s: Math.round(timeoutMs / 1000), recorded: rec };
        } catch (e2) {
          return { ok: false, error: `timeout; recorded fallback failed: ${e2}` };
        }
      }
    } catch (err) {
      // fn.callPromising threw synchronously (e.g. bad proxy): still leave "running".
      onState?.("failed");
      return { ok: false, error: String(err) };
    } finally {
      clearInterval(tick);
      busy = false;
    }
  }

  async function runLevel(level, params, hooks) {
    const res = await callApi(api.run_level, [level, params ?? {}], hooks);
    if (res && res.recorded && !res.fallback) res.fallback = recordedToFallback(res.recorded, level);
    return res;
  }

  // api.sandbox(backend, graph, shots, seed): chapter 9. Same busy/stale/timeout handling as runLevel.
  // graph = {nodes:[{id,name,lat,lon}], links:[{a,b,F}], src, dst}. No recorded fallback exists.
  async function runSandbox(graph, shots = 1000, hooks, seed = 0) {
    return callApi(api.sandbox, [graph, shots, seed], hooks);
  }

  // api.mystery(backend, seed, shots): "Who is listening?" (chapter 4). seed null = a fresh hidden culprit.
  // Same busy/stale/timeout handling as runSandbox. No recorded fallback exists.
  async function runMystery(shots = 1000, hooks, seed = null) {
    return callApi(api.mystery, [seed, shots], hooks);
  }

  // api.sandbox_presets(): no backend argument. Returns {cities, example, bbox} or null on any failure
  // (the UI has a built-in list).
  async function sandboxPresets() {
    try {
      const call = api.sandbox_presets.callPromising();
      const { done, wasTimeout } = withTimeout(call);
      try {
        const res = plain(await done);
        if (res?.ok === false) return null;
        const cities = Array.isArray(res?.cities) ? res.cities : Array.isArray(res?.presets) ? res.presets : null;
        return cities ? { ...res, cities } : null;
      } catch (err) {
        if (wasTimeout()) call.then((p) => p?.destroy?.(), () => {});
        throw err;
      }
    } catch {
      return null;
    }
  }

  // api.export_result(result, filename): no backend argument (it only downloads a file).
  async function exportResult(result, filename) {
    try {
      return plain(await api.export_result.callPromising(result, filename));
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  }

  // api.load_recorded(): no backend argument. Null on any failure (callers fail silently).
  async function loadRecorded() {
    try {
      const rec = plain(await api.load_recorded.callPromising());
      return rec && typeof rec === "object" ? rec : null;
    } catch {
      return null;
    }
  }

  return { info, callApi, runLevel, runSandbox, runMystery, sandboxPresets, exportResult, loadRecorded, backendName, isBusy: () => busy || latePending };
}
