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

// ---- chapter 9 (sandbox) mock: plausible shapes, NOT measurements ----
const SB_CITIES = [
  { id: "BOG", name: "Bogotá", lat: 4.711, lon: -74.072 }, { id: "MED", name: "Medellín", lat: 6.244, lon: -75.581 },
  { id: "CAL", name: "Cali", lat: 3.452, lon: -76.532 }, { id: "CTG", name: "Cartagena", lat: 10.391, lon: -75.479 },
  { id: "BAQ", name: "Barranquilla", lat: 10.964, lon: -74.796 }, { id: "BGA", name: "Bucaramanga", lat: 7.119, lon: -73.122 },
  { id: "PSO", name: "Pasto", lat: 1.214, lon: -77.281 }, { id: "LET", name: "Leticia", lat: -4.215, lon: -69.941 },
  { id: "CCS", name: "Caracas", lat: 10.481, lon: -66.904 }, { id: "MAR", name: "Maracaibo", lat: 10.654, lon: -71.64 },
  { id: "UIO", name: "Quito", lat: -0.18, lon: -78.468 }, { id: "GYE", name: "Guayaquil", lat: -2.17, lon: -79.922 },
  { id: "PTY", name: "Panamá", lat: 8.983, lon: -79.517 }, { id: "SJO", name: "San José", lat: 9.928, lon: -84.091 },
  { id: "MGA", name: "Managua", lat: 12.136, lon: -86.251 },
];
const SB_EXAMPLE = {
  nodes: ["BOG", "MED", "CAL", "UIO", "CCS", "PTY"],
  links: [
    { a: "BOG", b: "MED", F: 0.97 }, { a: "BOG", b: "CAL", F: 0.96 }, { a: "MED", b: "PTY", F: 0.95 },
    { a: "CAL", b: "UIO", F: 0.94 }, { a: "UIO", b: "BOG", F: 0.92 }, { a: "BOG", b: "CCS", F: 0.93 }, { a: "PTY", b: "CCS", F: 0.9 },
  ],
  src: "CAL", dst: "CCS",
};
const sbKm = (a, b) => {
  const r = Math.PI / 180, h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
};
const sbSwap = (f1, f2) => f1 * f2 + ((1 - f1) * (1 - f2)) / 3;
const sbStatus = (F) => (F >= 0.9 ? "healthy" : F >= 0.6 ? "degraded" : "broken");

function sbRoutes(graph, maxHops) {
  const nodes = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  const out = [];
  const walk = (path, F, eta, hops) => {
    const here = path[path.length - 1];
    if (here === graph.dst) return void out.push({ route: path, hops: hops.length, F_theory: F, eta, hopList: hops });
    if (hops.length >= maxHops) return;
    for (const l of graph.links) {
      const nxt = l.a === here ? l.b : l.b === here ? l.a : null;
      if (!nxt || path.includes(nxt)) continue;
      const km = sbKm(nodes[here], nodes[nxt]) * 1.3;
      const e = 10 ** ((-0.2 * km) / 10);
      walk([...path, nxt], path.length === 1 ? l.F : sbSwap(F, l.F), eta * e, [...hops, { a: here, b: nxt, great_circle_km: km / 1.3, length_km: km, eta: e, loss_db: 0.2 * km, F: l.F }]);
    }
  };
  walk([graph.src], 1, 1, []);
  return out.sort((x, y) => y.F_theory - x.F_theory);
}

async function sandboxImpl(backend, graph, shots = 1000, seed = 0) {
  if (flag() === "hang") return new Promise(() => {});
  const g = graph ?? {};
  if (!Array.isArray(g.nodes) || !Array.isArray(g.links) || g.nodes.length > 12 || g.links.length > 20 || !g.nodes.some((n) => n.id === g.src) || !g.nodes.some((n) => n.id === g.dst) || g.src === g.dst) {
    return { ok: false, input_error: true, error: "invalid graph (mock)" };
  }
  const name = String(backend?.name ?? "local_mock");
  const ionq = name.toLowerCase().includes("ionq");
  await new Promise((r) => setTimeout(r, 300));
  const routes = sbRoutes(g, ionq ? 4 : 6);
  if (!routes.length) return { ok: false, input_error: true, error: "no route between the endpoints (mock)" };
  const best = routes[0];
  if (ionq && flag() === "aria" && best.hops >= 2) {
    return { ok: false, code: "ionq_too_wide", needed_qubits: 4 * best.hops + 2, max_qubits: 6, error: "route needs more qubits than the backend has; nothing was submitted" };
  }
  if (ionq && ionqUsed) {
    return ionqUsed.level === "sandbox"
      ? { ...ionqUsed.result, cached_run: true }
      : { ok: false, code: "ionq_job_used", error: "IonQ allows one job per Run; this Run already used its job. Press Stop and Run again." };
  }
  const wob = ((seed * 7 + best.hops * 3) % 5 - 2) * 0.004;
  const F = Math.max(0.25, Math.min(1, best.F_theory + wob));
  const se = Math.sqrt((F * (1 - F)) / shots) * 1.96;
  const q = (2 * (1 - F)) / 3;
  const h = (p) => (p <= 0 || p >= 1 ? 0 : -p * Math.log2(p) - (1 - p) * Math.log2(1 - p));
  const result = {
    ok: true, level: "sandbox", mode: ionq ? "batch" : "live", backend: name, timestamp: new Date().toISOString(), shots,
    params: { graph: g, seed }, bit_order: "Qiskit little-endian",
    route: best.route, route_limited: false, hops: best.hopList,
    alternatives: routes.slice(0, 4).map((r, i) => ({ route: r.route, hops: r.hops, F_theory: r.F_theory, eta: r.eta, chosen: i === 0 })),
    metrics: {
      fidelity: { value: F, ci95: [F - se, F + se], theory: best.F_theory },
      theory_route_F: { value: best.F_theory },
      eta_route: { value: best.eta, eta_no_memory: best.eta },
      raw_pairs_per_delivered: { value: 1 / best.eta },
      key_rate_shor_preskill: { value: Math.max(0, 1 - 2 * h(q)) * best.eta },
      key_rate_lca_biased: { value: Math.max(0, 1 - 2 * h(q) * 0.8) * best.eta },
    },
    viz: {
      route: best.route,
      links: best.hopList.map((hp) => ({ id: `${hp.a}-${hp.b}`, a: hp.a, b: hp.b, F_theory: hp.F, status: sbStatus(hp.F) })),
      end_to_end: { a: g.src, b: g.dst, F, ci95: [F - se, F + se], status: sbStatus(F) },
      notes: ["Mock result: numbers are plausible, not measured."],
    },
    counts: {}, circuits: [{ id: "swap_ZZ", qubits: 2 + 2 * best.hops, depth: 12, two_qubit_gates: 7 * best.hops }],
  };
  if (ionq) ionqUsed = { level: "sandbox", result, params: g };
  return result;
}

export const sandbox_presets = fn(async () => ({ ok: true, cities: SB_CITIES, bbox: { lat: [-8, 16], lon: [-92, -58] }, example: SB_EXAMPLE }));
export const info = fn(async () => ({
  ...mock.info(),
  sandbox: { max_nodes: 12, max_links: 20, F_min: 0.5, F_max: 1, max_hops: 6, max_hops_ionq: 4, min_shots: 100, max_shots: 5000 },
}));
export const sandbox = fn(sandboxImpl);
export const run_level = fn(runLevel);
export const load_recorded = fn(async () => mock.loadRecorded());
export const export_result = fn(async () => ({ exported: true, bytes: 0 }));
