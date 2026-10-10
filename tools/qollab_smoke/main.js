// Smoke harness: calls every public function of quantum.api and shows ok/error/code and timings.
// `backend` is a global created by Qollab. Calls are POSITIONAL (the proven pattern:
// fn.callPromising(backend, ...)); only the diagnose button also tries callPromisingKwargs.
// Qollab only resolves STATIC imports of Python modules (dynamic import('quantum.api') fails);
// if this import fails the page never leaves the "Loading..." status set in index.html.
import * as api from 'quantum.api';
import * as probe from 'smoke_probe';
const status = document.getElementById('status');
const out = document.getElementById('out');
const log = document.querySelector('#log tbody');
const holder = document.getElementById('buttons');
const TIMEOUT_MS = 180000;
let lastResult = null;
let busy = false;
const buttons = [];

function backendName() {
  try {
    return String(backend.name ?? backend.constructor?.name ?? 'unknown');
  } catch (err) {
    return 'unavailable';
  }
}
document.getElementById('backend-name').textContent = backendName();

function addRow(label, ok, detail, ms) {
  const tr = document.createElement('tr');
  [label, ok ? 'OK' : 'FAILED', detail, String(ms)].forEach((text) => {
    const td = document.createElement('td');
    td.textContent = text;
    tr.appendChild(td);
  });
  log.prepend(tr);
}

function setBusy(value) {
  busy = value;
  buttons.forEach((b) => { b.disabled = value; });
}

function toPlain(proxy) {
  const res = proxy && typeof proxy.toJs === 'function'
    ? proxy.toJs({ dict_converter: Object.fromEntries })
    : proxy;
  if (proxy && typeof proxy.destroy === 'function') proxy.destroy();
  return res;
}

function show(res) {
  const text = JSON.stringify(res, null, 1) ?? '';
  out.textContent = text.length > 6000 ? `${text.slice(0, 6000)}\n... (truncated)` : text;
}

async function run(label, call) {
  if (busy) return;
  setBusy(true);
  const t0 = performance.now();
  const ticker = setInterval(() => {
    status.textContent = `Running: ${label}... ${Math.round((performance.now() - t0) / 1000)} s`;
  }, 1000);
  status.textContent = `Running: ${label}...`;
  let ok = false;
  let detail = '';
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
    });
    const res = toPlain(await Promise.race([call(), timeout]));
    lastResult = res;
    ok = !!(res && res.ok);
    detail = ok ? (res.source || res.mode || '') : `${res?.code ?? ''} ${res?.error ?? ''}`.trim();
    show(res);
  } catch (err) {
    detail = String(err?.message) === 'timeout' ? `timeout after ${TIMEOUT_MS / 1000} s` : `JS exception: ${err}`;
    out.textContent = String(err);
  } finally {
    clearTimeout(timer);
    clearInterval(ticker);
    const ms = Math.round(performance.now() - t0);
    addRow(label, ok, detail, ms);
    status.textContent = `${ok ? 'Done' : 'Failed'}: ${label} (${ms} ms)${ok ? '' : ` - ${detail}`}`;
    setBusy(false);
  }
}

function addButton(label, call) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', () => run(label, call));
  holder.appendChild(b);
  buttons.push(b);
}

async function main() {
  const pos = (fn, ...args) => () => fn.callPromising(backend, ...args);
  const shots = { shots: 300 };

  // IonQ submit probes: ONE job each, press Stop and Run between them.
  // Packed probes: one level = ONE circuit (Qollab's IonQ proxy rejects multi-circuit jobs).
  addButton('IonQ PACKED: link + readout (14 q)', pos(probe.ionq_pack_probe, 'link_readout', 100));
  addButton('IonQ PACKED: teleport (15 q)', pos(probe.ionq_pack_probe, 'teleport', 100));
  addButton('IonQ PACKED: qkd (18 q)', pos(probe.ionq_pack_probe, 'qkd', 100));
  addButton('IonQ probe: 1 raw Bell circuit', pos(probe.ionq_probe, 0, 100));
  addButton('IonQ probe: first 1 batch circuit', pos(probe.ionq_probe, 1, 100));
  addButton('IonQ probe: first 10 batch circuits', pos(probe.ionq_probe, 10, 100));
  addButton('IonQ probe: all 29 batch circuits', pos(probe.ionq_probe, 29, 100));
  addButton('Diagnose backend', async () => {
    // Two positional calls in a row: same_object tells whether JS hands Python the SAME backend object.
    const a = toPlain(await api.backend_diag.callPromising(backend));
    const b = toPlain(await api.backend_diag.callPromising(backend));
    let k;
    try {
      k = toPlain(await api.backend_diag.callPromisingKwargs({ backend }));
    } catch (err) {
      k = { ok: false, error: `kwargs call threw: ${err}` };
    }
    const same = b?.same_object_as_last_diag;
    return {
      ok: !!(a && a.ok && b && b.ok),
      same_object: same === true ? 'YES (guard can work)' : 'NO - TELL CLAUDE IMMEDIATELY (guard would not work)',
      positional_1: a, positional_2: b, kwargs: k, kwargs_works: !!(k && k.ok),
    };
  });
  addButton('info', () => api.info.callPromising());
  [['link', api.level_link], ['teleport', api.level_teleport], ['noise', api.level_noise],
    ['swap', api.level_swap], ['purify', api.level_purify], ['qkd', api.level_qkd]]
    .forEach(([n, fn]) => addButton(`level_${n} (defaults)`, pos(fn, 300)));
  addButton('rescue (defaults)', pos(api.rescue, 300));
  addButton('run_level link', pos(api.run_level, 'link', shots));
  addButton('run_level swap', pos(api.run_level, 'swap', shots));
  addButton('run_level rescue', pos(api.run_level, 'rescue', shots));
  addButton('full_batch', pos(api.full_batch));
  addButton('load_recorded', () => api.load_recorded.callPromising());
  addButton('export_result (last result)', () => api.export_result.callPromising(lastResult ?? {}));
  status.textContent = `Ready (Pyodide loaded ${(performance.now() / 1000).toFixed(1)} s after page start)`;
}

try {
  await main();
} catch (err) {
  status.textContent = `FAILED: ${err}`;
}
// Keep the run alive: Qollab cuts IonQ access once top-level code finishes ("Done."),
// so jobs submitted from later clicks fail with "Failed to fetch". Stop ends the run.
await new Promise(() => {});
