/*
  Mock del backend para desarrollo local.

  Reproduce la forma del contrato JSON de quantum/ (api.info, level_*, full_batch)
  SIN correr Qiskit. Los números son plausibles (se derivan de las mismas
  fórmulas de la física del proyecto) para que la UI 3D se vea realista; NO son
  mediciones. En Qollab, api-bridge.js usa el backend real y este archivo se
  ignora por completo.

  La geografía replica quantum/geo.py (ciudades, longitudes de fibra,
  transmisividad y proyección del mapa) para que el mapa 3D coincida con el real.
*/

// ---------------------------------------------------------------------------
// Geografía (espejo de quantum/geo.py)
// ---------------------------------------------------------------------------
const EARTH_RADIUS_KM = 6371.0088;
const FIBER_ROUTE_FACTOR = 1.3;
const LOSS_DB_PER_KM = 0.2;
const CENTER = [4.57, -74.3]; // lat, lon
const HALF_EXTENT_DEG = 8.8;

const CITIES = {
  BOG: { id: "BOG", name: "Bogotá", lat: 4.711, lon: -74.072 },
  MED: { id: "MED", name: "Medellín", lat: 6.244, lon: -75.581 },
  CAL: { id: "CAL", name: "Cali", lat: 3.452, lon: -76.532 },
  CTG: { id: "CTG", name: "Cartagena", lat: 10.391, lon: -75.479, challenge: true },
};
const LINK_IDS = ["BOG-MED", "MED-CAL", "BOG-CAL"];

const rad = (d) => (d * Math.PI) / 180;

function haversineKm(a, b) {
  const ca = CITIES[a];
  const cb = CITIES[b];
  const p1 = rad(ca.lat);
  const p2 = rad(cb.lat);
  const dphi = p2 - p1;
  const dlam = rad(cb.lon - ca.lon);
  const h =
    Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlam / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}
const linkLengthKm = (a, b) => haversineKm(a, b) * FIBER_ROUTE_FACTOR;
const transmissivity = (lengthKm) => 10 ** ((-LOSS_DB_PER_KM * lengthKm) / 10);

function project(lat, lon) {
  const k = Math.cos(rad(CENTER[0]));
  return {
    x: ((lon - CENTER[1]) * k) / HALF_EXTENT_DEG,
    z: -(lat - CENTER[0]) / HALF_EXTENT_DEG,
  };
}

function geoInfo() {
  const cities = {};
  for (const [k, v] of Object.entries(CITIES)) {
    cities[k] = { ...v, ...project(v.lat, v.lon) };
  }
  const links = LINK_IDS.map((lid) => {
    const [a, b] = lid.split("-");
    const length = linkLengthKm(a, b);
    return {
      id: lid,
      a,
      b,
      great_circle_km: haversineKm(a, b),
      length_km: length,
      eta: transmissivity(length),
      loss_db: LOSS_DB_PER_KM * length,
    };
  });
  return {
    cities,
    links,
    assumptions: {
      fiber_route_factor: FIBER_ROUTE_FACTOR,
      loss_db_per_km: LOSS_DB_PER_KM,
      note: "fiber length = great-circle distance x 1.3 (mock, igual que geo.py)",
    },
  };
}

// ---------------------------------------------------------------------------
// Utilidades de física (versiones ligeras de analysis.py / noise.py)
// ---------------------------------------------------------------------------
const DEFAULT_PARAMS = {
  link: {},
  teleport: { theta_deg: 60.0, phi_deg: 30.0, F: 0.8 },
  noise: { Fs: [0.95, 0.8, 0.6], mode: "precision" },
  swap: { F1: 0.95, F2: 0.9, mode: "precision" },
  purify: { F: null, gamma: 0.2, p: null, strategy: "predicted", mode: "teaching" },
  qkd: { theta_deg: 120.0, smart_direct: false, beta_source: "split" },
  rescue: {
    broken: "BOG-CAL",
    damage: { kind: "werner", F: 0.7 },
    healthy_F: 0.95,
    target_F: 0.85,
    mode: "precision",
  },
};

// Ruido estadístico pequeño y reproducible para que los números "respiren".
function makeRng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const jitter = (rng, v, amp = 0.01) => v + (rng() - 0.5) * 2 * amp;
const clip01 = (x) => Math.min(1, Math.max(0, x));

// Fidelidad de Werner y correladores (espejo de theory_werner).
const wernerCorr = (F) => (4 * F - 1) / 3;

function metric(value, theory, { ciAmp = 0.03, extra = {} } = {}) {
  return {
    value,
    ci95: [clip01(value - ciAmp), clip01(value + ciAmp)],
    theory,
    ...extra,
  };
}

// Serie de paridades 0/1 para animar fotones (espejo de sample_parity).
function sampleParity(rng, pOne, k = 40) {
  return Array.from({ length: k }, () => (rng() < pOne ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Decodificadores mock por nivel: devuelven { metrics, viz } como el backend.
// ---------------------------------------------------------------------------
function decodeLink(rng) {
  const xx = jitter(rng, 1.0);
  const yy = jitter(rng, -1.0);
  const zz = jitter(rng, 1.0);
  const F = clip01((1 + xx - yy + zz) / 4);
  return {
    metrics: {
      corr_XX: metric(xx, 1.0),
      corr_YY: metric(yy, -1.0),
      corr_ZZ: metric(zz, 1.0),
      fidelity: metric(F, 1.0, { ciAmp: 0.02, extra: { raw: F } }),
    },
    viz: {
      samples: sampleParity(rng, 0.02),
      bloch: {
        A: { value: [0, 0, 0], ci95: [] },
        B: { value: [0, 0, 0], ci95: [] },
        theory: [0, 0, 0],
      },
      leak: { value: 0.0, source: "circuit" },
      links: { "BOG-MED": { F, ci95: [F - 0.02, F + 0.02], status: "healthy" } },
    },
  };
}

function decodeTeleport(rng, params) {
  const F = params.F ?? null;
  const Ftel = F === null ? 1.0 : (2 * F + 1) / 3;
  const measured = clip01(jitter(rng, Ftel, 0.02));
  return {
    metrics: {
      bob_X: metric(jitter(rng, 0.5), 0.5),
      bob_Y: metric(jitter(rng, 0.0), 0.0),
      bob_Z: metric(jitter(rng, 0.5), 0.5),
      fidelity: metric(measured, Ftel, {
        ciAmp: 0.025,
        extra: { raw: measured, classical_bound: 2 / 3 },
      }),
    },
    viz: {
      samples: sampleParity(rng, 1 - measured),
      bloch: {
        measured: [jitter(rng, 0.5), 0, jitter(rng, 0.5)],
        theory: [0.5, 0, 0.5],
        input: [0.5, 0, 0.5],
      },
      leak: { value: F === null ? 0 : 1 - F, source: "circuit" },
    },
  };
}

function decodeNoise(rng, params) {
  const Fs = params.Fs ?? DEFAULT_PARAMS.noise.Fs;
  const metrics = {};
  const links = {};
  const samples = {};
  for (const F of Fs) {
    const c = wernerCorr(F);
    const key = `${F}`;
    const measured = clip01(jitter(rng, F, 0.02));
    metrics[`fidelity@${key}`] = metric(measured, F, {
      ciAmp: 0.03,
      extra: { raw: measured, configured: F },
    });
    metrics[`corr_XX@${key}`] = metric(jitter(rng, c), c);
    metrics[`corr_YY@${key}`] = metric(jitter(rng, -c), -c);
    metrics[`corr_ZZ@${key}`] = metric(jitter(rng, c), c);
    links[key] = { F: measured, ci95: [measured - 0.03, measured + 0.03] };
    samples[key] = sampleParity(rng, (1 - c) / 2);
  }
  return {
    metrics,
    viz: {
      samples,
      leak: {
        by_F: Object.fromEntries(Fs.map((F) => [`${F}`, 1 - F])),
        source: params.mode === "precision" ? "simulated" : "circuit",
      },
      links,
      bloch: { theory: [0, 0, 0] },
    },
  };
}

function decodeSwap(rng, params) {
  const F1 = params.F1 ?? DEFAULT_PARAMS.swap.F1;
  const F2 = params.F2 ?? DEFAULT_PARAMS.swap.F2;
  const F = F1 * F2 + ((1 - F1) * (1 - F2)) / 3;
  const measured = clip01(jitter(rng, F, 0.02));
  return {
    metrics: {
      corr_XX: metric(jitter(rng, wernerCorr(F)), wernerCorr(F)),
      corr_YY: metric(jitter(rng, -wernerCorr(F)), -wernerCorr(F)),
      corr_ZZ: metric(jitter(rng, wernerCorr(F)), wernerCorr(F)),
      fidelity: metric(measured, F, { ciAmp: 0.025, extra: { raw: measured } }),
    },
    viz: {
      samples: sampleParity(rng, 1 - measured),
      leak: {
        value: 1 - measured,
        by_link: { AB: 1 - F1, BC: 1 - F2 },
        source: params.mode === "precision" ? "simulated" : "circuit",
      },
      links: {
        AB: { F: F1 },
        BC: { F: F2 },
        AC: { F: measured, ci95: [measured - 0.025, measured + 0.025] },
      },
      bloch: { theory: [0, 0, 0] },
    },
  };
}

function decodePurify(rng, params) {
  const Fin = params.F ?? 0.75;
  const q = (1 - Fin) / 3;
  const ps = Fin * Fin + 2 * Fin * q + 5 * q * q;
  const Ffixed = clip01((Fin * Fin + q * q) / ps);
  const Fadaptive = clip01(Ffixed + 0.03); // la U adaptativa suele mejorar
  return {
    metrics: {
      fidelity_input: metric(jitter(rng, Fin, 0.02), Fin, { extra: { raw: Fin } }),
      fidelity_fixed: metric(jitter(rng, Ffixed, 0.02), Ffixed, {
        extra: { raw: Ffixed, u: "I" },
      }),
      fidelity_adaptive: metric(jitter(rng, Fadaptive, 0.02), Fadaptive, {
        extra: { raw: Fadaptive, u: "SH" },
      }),
      p_s_fixed: metric(jitter(rng, ps, 0.02), ps, { extra: { u: "I" } }),
      raw_pairs_fixed: metric(2 / ps, 2 / ps, { ciAmp: 0.2, extra: { u: "I" } }),
    },
    viz: {
      choice: {
        chosen: "SH",
        global_best: "SH",
        limited: false,
        measured_F_out: { I: Ffixed, SH: Fadaptive },
        p_hat: [Fin, q, q, q],
      },
      samples: sampleParity(rng, 1 - Fadaptive),
      leak: { value: 1 - Fin, source: params.mode === "precision" ? "simulated" : "circuit" },
      links: {
        input: { F: Fin, ci95: [Fin - 0.02, Fin + 0.02] },
        fixed: { F: Ffixed },
        adaptive: { F: Fadaptive, u: "SH", p_s: ps },
      },
      bloch: { theory: [0, 0, 0] },
    },
  };
}

function decodeQkd(rng, params) {
  const thetaDeg = params.theta_deg ?? DEFAULT_PARAMS.qkd.theta_deg;
  const c = Math.cos(rad(thetaDeg) / 2);
  const F = (1 + c) / 2;
  const Sstd = Math.SQRT2 * (1 + c);
  const qz = 0;
  const qx = (1 - c) / 2;
  const Smeasured = jitter(rng, Sstd, 0.08);
  return {
    metrics: {
      qber_Z: metric(jitter(rng, qz, 0.01), qz),
      qber_X: metric(jitter(rng, qx, 0.02), qx),
      chsh_standard: metric(Smeasured, Sstd, {
        ciAmp: 0.12,
        extra: { classical_bound: 2.0, method: "direct_circuits" },
      }),
      eve_guess: metric(
        jitter(rng, (1 + Math.sin(rad(thetaDeg) / 2)) / 2, 0.02),
        (1 + Math.sin(rad(thetaDeg) / 2)) / 2
      ),
      key_rate_shor_preskill: metric(
        jitter(rng, Math.max(0, 0.5 * (1 - 2 * binaryEntropy((qz + qx) / 2))), 0.02),
        0.5 * (1 - 2 * binaryEntropy((qz + qx) / 2))
      ),
    },
    viz: {
      samples: sampleParity(rng, qx),
      leak: { value: 2 * ((1 + Math.sin(rad(thetaDeg) / 2)) / 2) - 1, source: "circuit", kind: "eve_advantage" },
      bloch: { theory: [0, 0, 0] },
      spy: { present: true, caught: Smeasured <= 2.0 },
    },
  };
}

function binaryEntropy(q) {
  if (q <= 0 || q >= 1) return 0;
  return -q * Math.log2(q) - (1 - q) * Math.log2(1 - q);
}

function decodeRescue(rng, params) {
  const broken = params.broken ?? "BOG-CAL";
  const targetF = params.target_F ?? 0.85;
  const dmg = params.damage ?? { kind: "werner", F: 0.7 };
  const Fdirect = clip01(jitter(rng, dmg.F ?? 0.7, 0.02));
  const f1 = Array.isArray(params.healthy_F) ? params.healthy_F[0] : params.healthy_F ?? 0.95;
  const f2 = f1;
  const Freroute = clip01(jitter(rng, f1 * f2 + ((1 - f1) * (1 - f2)) / 3, 0.02));
  const Fpurify = clip01(Fdirect + 0.08);

  const strategies = [
    {
      key: "direct",
      title: "Usar el enlace dañado",
      status: "ok",
      fidelity: metric(Fdirect, Fdirect, { ciAmp: 0.03 }),
      raw_pairs: metric(1, 1),
      meets_target: Fdirect - 0.03 >= targetF,
    },
    {
      key: "reroute",
      title: "Reroute vía Medellín",
      status: "ok",
      fidelity: metric(Freroute, Freroute, { ciAmp: 0.03 }),
      raw_pairs: metric(2, 2),
      meets_target: Freroute - 0.03 >= targetF,
    },
    {
      key: "purify_adaptive",
      title: "Purificar (U adaptativa)",
      status: "ok",
      fidelity: metric(Fpurify, Fpurify, { ciAmp: 0.03 }),
      raw_pairs: metric(2.4, 2.4, { ciAmp: 0.3 }),
      meets_target: Fpurify - 0.03 >= targetF,
    },
  ];
  const meeting = strategies.filter((s) => s.meets_target);
  const best = meeting.sort((a, b) => a.raw_pairs.value - b.raw_pairs.value)[0] ?? null;
  const rec = best
    ? {
        strategy: best.key,
        meets_target: true,
        message: `Recomendado: ${best.title} (F = ${best.fidelity.value.toFixed(3)}).`,
      }
    : { strategy: null, meets_target: false, message: `Ninguna estrategia alcanza F=${targetF}.` };

  const metrics = {};
  for (const s of strategies) {
    metrics[`fidelity_${s.key}`] = s.fidelity;
    metrics[`raw_pairs_${s.key}`] = s.raw_pairs;
  }

  const [ra, rb] = reroute_links(broken);
  const links = {};
  for (const lid of LINK_IDS) {
    if (lid === broken) {
      links[lid] = {
        F: best ? best.fidelity.value : Fdirect,
        ci95: null,
        status: rec.meets_target ? "rescued" : "damaged",
        source: params.mode === "precision" ? "simulated" : "circuit",
        direct_F: Fdirect,
        via: rec.strategy,
      };
    } else {
      links[lid] = { F: lid === ra || lid === rb ? f1 : f1, ci95: null, status: "healthy", source: "configured" };
    }
  }

  return {
    metrics,
    viz: {
      links,
      strategies,
      samples: Object.fromEntries(strategies.map((s) => [s.key, sampleParity(rng, 1 - s.fidelity.value)])),
      leak: { value: 1 - Fdirect, source: params.mode === "precision" ? "simulated" : "circuit" },
      recommendation: rec,
      broken,
    },
  };
}

// Espejo de geo.reroute_links.
function reroute_links(linkId) {
  const [a, b] = linkId.split("-");
  const t = ["BOG", "MED", "CAL"].find((c) => c !== a && c !== b);
  const norm = (x, y) => LINK_IDS.find((l) => new Set(l.split("-")).size === 2 && [x, y].every((c) => l.includes(c)));
  return [norm(a, t), norm(t, b)];
}

// ---------------------------------------------------------------------------
// Ensamblado del resultado (espejo de analysis.make_result)
// ---------------------------------------------------------------------------
function makeResult(level, params, dec, backendName = "local_mock") {
  return {
    ok: true,
    level,
    mode: "live",
    backend: backendName,
    timestamp: new Date().toISOString(),
    shots: params.shots ?? 1000,
    params,
    metrics: dec.metrics,
    circuits: [],
    counts: {},
    viz: dec.viz,
  };
}

const LEVEL_DECODERS = {
  level_link: (rng) => decodeLink(rng),
  level_teleport: (rng, p) => decodeTeleport(rng, p),
  level_noise: (rng, p) => decodeNoise(rng, p),
  level_swap: (rng, p) => decodeSwap(rng, p),
  level_purify: (rng, p) => decodePurify(rng, p),
  level_qkd: (rng, p) => decodeQkd(rng, p),
  rescue: (rng, p) => decodeRescue(rng, p),
};

const LEVEL_NAME = {
  level_link: "link",
  level_teleport: "teleport",
  level_noise: "noise",
  level_swap: "swap",
  level_purify: "purify",
  level_qkd: "qkd",
  rescue: "rescue",
};

// ---------------------------------------------------------------------------
// info(): espejo de api.info() (versión reducida pero compatible)
// ---------------------------------------------------------------------------
const P = (min, max, def, unit = "") => ({ min, max, default: def, unit });

function info() {
  const d = DEFAULT_PARAMS;
  const shots = P(10, 20000, 1000);
  const modes = { options: ["teaching", "precision"] };
  const levels = [
    {
      id: "link",
      title: "Primer enlace",
      function: "level_link",
      summary: "Par de Bell medido en X, Y, Z: F a partir de tres correladores.",
      params: { shots },
    },
    {
      id: "teleport",
      title: "Teletransporte",
      function: "level_teleport",
      summary: "Teletransporta un qubit por un enlace (ruidoso); corrección de Pauli en Python.",
      params: {
        shots,
        theta_deg: P(0, 180, d.teleport.theta_deg, "deg"),
        phi_deg: P(-360, 360, d.teleport.phi_deg, "deg"),
        F: P(0.25, 1, d.teleport.F),
      },
    },
    {
      id: "noise",
      title: "El ruido es alguien escuchando",
      function: "level_noise",
      summary: "Ruido de Werner desde qubits de entorno: F medida vs F configurada.",
      params: {
        shots,
        Fs: { default: d.noise.Fs, min: 0.25, max: 1, length: [1, 5] },
        mode: { ...modes, default: d.noise.mode },
      },
    },
    {
      id: "swap",
      title: "Repetidor (swapping)",
      function: "level_swap",
      summary: "Une dos enlaces con una medida de Bell; F = F1 F2 + (1-F1)(1-F2)/3.",
      params: {
        shots,
        F1: P(0.25, 1, d.swap.F1),
        F2: P(0.25, 1, d.swap.F2),
        mode: { ...modes, default: d.swap.mode },
      },
    },
    {
      id: "purify",
      title: "Destilación",
      function: "level_purify",
      summary: "DEJMPS, fija vs adaptativa. Da exactamente uno de F, gamma o p.",
      params: {
        shots,
        F: P(0.25, 1, 0.8),
        gamma: P(0, 1, d.purify.gamma),
        strategy: { options: ["all", "predicted"], default: "all" },
        mode: { ...modes, default: d.purify.mode },
      },
    },
    {
      id: "qkd",
      title: "Atrapa al espía",
      function: "level_qkd",
      summary: "E91/BBM92 con espía: QBER, CHSH, tasa de clave.",
      params: {
        shots,
        theta_deg: P(0, 180, d.qkd.theta_deg, "deg"),
        smart_direct: { default: d.qkd.smart_direct },
        beta_source: { options: ["split", "oracle"], default: d.qkd.beta_source },
      },
    },
    {
      id: "rescue",
      title: "Salva la red cuántica",
      function: "rescue",
      summary: "Repara un enlace dañado: directo, reroute o purificar (un job, IonQ permitido).",
      params: {
        shots,
        broken: { options: LINK_IDS, default: d.rescue.broken },
        damage_kind: { options: ["werner", "damping", "spy"], default: d.rescue.damage.kind },
        damage_F: P(0.25, 1, d.rescue.damage.F ?? 0.7),
        healthy_F: P(0.25, 1, d.rescue.healthy_F),
        target_F: P(0.3, 1, d.rescue.target_F),
        mode: { ...modes, default: d.rescue.mode },
      },
    },
  ];
  return {
    ok: true,
    version: "0.1.0-mock",
    attribution: "This effort is supported by Qollab & IonQ.",
    levels,
    full_batch: { function: "full_batch", max_circuits: 40, default_shots: 1000, default_params: d },
    geo: geoInfo(),
  };
}

// ---------------------------------------------------------------------------
// API pública del mock
// ---------------------------------------------------------------------------
export function makeMock() {
  let seed = 1;
  return {
    info() {
      return info();
    },
    async runLevel(fnName, params) {
      const decoder = LEVEL_DECODERS[fnName];
      if (!decoder) return { ok: false, error: `nivel desconocido: ${fnName}` };
      // Simular una pequeña latencia como la de un backend real.
      await new Promise((r) => setTimeout(r, 250));
      const rng = makeRng(seed++);
      const dec = decoder(rng, params);
      return makeResult(LEVEL_NAME[fnName], params, dec);
    },
    async fullBatch(params) {
      await new Promise((r) => setTimeout(r, 400));
      const levels = {};
      for (const [fn, name] of Object.entries(LEVEL_NAME)) {
        const rng = makeRng(seed++);
        const p = (params && params[name]) || {};
        levels[name] = makeResult(name, p, LEVEL_DECODERS[fn](rng, p));
      }
      return {
        ok: true,
        mode: "batch",
        backend: "local_mock",
        timestamp: new Date().toISOString(),
        shots: 1000,
        levels,
      };
    },
  };
}

export { geoInfo };
