/*
  Mock of the Python module `quantum.api` for LOCAL development only
  (dev/index.html maps the bare name 'quantum.api' to this file with an import map).
  It is never uploaded to Qollab.

  Same function names and call style as the real module, so ui/api-bridge.js is
  identical locally and on Qollab:

      api.run_level.callPromising(backend, level, params)  -> proxy with .toJs() / .destroy()

  Data comes from ui/mock-data.js (numbers are plausible, NOT measurements).

  Test switches (query string of dev/index.html):
    ?mock=ionq   a backend named "ionq_simulator": the first level runs as
                 source "ionq_packed"; the same level again is cached
                 (cached_run, params_ignored); any other level -> ionq_job_used
                 + a recorded fallback; rescue is reduced (ionq_reduced).
    ?mock=aria   like ionq, but purify -> ionq_too_wide (27 > 25 qubits).
    ?mock=hang   run_level never answers (combine with &timeout_ms=3000 to see
                 the timeout -> load_recorded path).
*/

import { makeMock, validateParams } from "./mock-data.js";

const mock = makeMock();
const flag = () => new URLSearchParams(globalThis.location?.search ?? "").get("mock");

const wrap = (value) => ({
  toJs: () => structuredClone(value),
  destroy() {},
});
const fn = (impl) => ({ callPromising: async (...args) => wrap(await impl(...args)) });

let ionqUsed = null; // { level, result, params } of the single job of this "Run"

function recordedFallback(level) {
  const run = mock.loadRecorded().recorded[0];
  const lv = run.result.levels[level];
  return { source: "recorded", file: run.name, mode: "recorded", backend: lv.backend, timestamp: lv.timestamp, result: lv };
}

async function runLevel(backend, level, params = {}) {
  const p = { ...(params ?? {}) };
  if (flag() === "hang") return new Promise(() => {});
  const name = String(backend?.name ?? "local_mock");
  if (!name.toLowerCase().includes("ionq")) {
    const res = await mock.runLevel(level, p);
    return res.ok ? { ...res, backend: name } : res;
  }

  // ---- IonQ-like behaviour: 1 Run = 1 level = 1 job ----
  const bad = validateParams(level, p);
  if (bad) return bad;
  if (flag() === "aria" && level === "purify") {
    return {
      ok: false, code: "ionq_too_wide", needed_qubits: 27, max_qubits: 25,
      error: "level purify needs 27 qubits but the backend has 25; nothing was submitted",
      fallback: recordedFallback(level),
    };
  }
  if (ionqUsed && ionqUsed.level !== level) {
    return {
      ok: false, code: "ionq_job_used",
      error: "IonQ allows one job per Run; this Run already used its job. Press Stop and Run again.",
      cached: { backend: name, timestamp: ionqUsed.result.timestamp, shots: ionqUsed.result.shots },
      fallback: recordedFallback(level),
    };
  }
  if (ionqUsed) {
    const ignored = JSON.stringify(p) !== JSON.stringify(ionqUsed.params);
    return { ...ionqUsed.result, cached_run: true, params_ignored: ignored };
  }
  const reduced = level === "rescue" || level === "purify";
  const res = await mock.runLevel(level, p, { reduced: level === "rescue" });
  if (!res.ok) return res;
  const result = {
    ...res,
    backend: name,
    mode: "batch",
    source: "ionq_packed",
    circuits: [{ id: "packed", qubits: 18, depth: 24, two_qubit_gates: 20 }],
    ...(reduced
      ? { ionq_reduced: true, ionq_note: [level === "rescue" ? "The reroute strategy was not run (not enough qubits in one circuit)." : "Only the predicted U was measured (no U = I baseline)."] }
      : {}),
  };
  ionqUsed = { level, result, params: p };
  return result;
}

export const info = fn(async () => mock.info());
export const run_level = fn(runLevel);
export const load_recorded = fn(async () => mock.loadRecorded());
export const export_result = fn(async () => ({ exported: true, bytes: 0 }));
