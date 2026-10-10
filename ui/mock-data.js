/*
  Mock del backend para desarrollo local (lo usa ui/mock-api.js).

  Reproduce la forma ACTUAL del contrato de quantum/api.py (info, run_level,
  load_recorded) SIN correr Qiskit. Los números son plausibles (se derivan de
  las mismas fórmulas) para que la UI 3D se vea realista; NO son mediciones.
  En Qollab este archivo no se sube ni se usa.

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

// Probabilities / fidelities are clamped to [0, 1]; correlators (signed) to [-1, 1];
// values whose theory is outside [-1, 1] (CHSH, raw pairs) are left alone.
function metric(value, theory, { ciAmp = 0.03, signed = theory < 0, extra = {} } = {}) {
  if (typeof theory === "number" && Math.abs(theory) > 1) {
    return { value, ci95: [value - ciAmp, value + ciAmp], theory, ...extra };
  }
  const lo = signed ? -1 : 0;
  const clamp = (x) => Math.min(1, Math.max(lo, x));
  const v = clamp(value);
  return { value: v, ci95: [clamp(v - ciAmp), clamp(v + ciAmp)], theory, ...extra };
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
      corr_XX: metric(xx, 1.0, { signed: true }),
      corr_YY: metric(yy, -1.0, { signed: true }),
      corr_ZZ: metric(zz, 1.0, { signed: true }),
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
    },
  };
}

function decodeTeleport(rng, params) {
  const F = "F" in params ? params.F : DEFAULT_PARAMS.teleport.F; // F: null = noiseless
  const Ftel = F === null ? 1.0 : (2 * F + 1) / 3;
  const measured = clip01(jitter(rng, Ftel, 0.02));
  return {
    metrics: {
      bob_X: metric(jitter(rng, 0.5), 0.5, { signed: true }),
      bob_Y: metric(jitter(rng, 0.0), 0.0, { signed: true }),
      bob_Z: metric(jitter(rng, 0.5), 0.5, { signed: true }),
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
    metrics[`corr_XX@${key}`] = metric(jitter(rng, c), c, { signed: true });
    metrics[`corr_YY@${key}`] = metric(jitter(rng, -c), -c, { signed: true });
    metrics[`corr_ZZ@${key}`] = metric(jitter(rng, c), c, { signed: true });
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
      corr_XX: metric(jitter(rng, wernerCorr(F)), wernerCorr(F), { signed: true }),
      corr_YY: metric(jitter(rng, -wernerCorr(F)), -wernerCorr(F), { signed: true }),
      corr_ZZ: metric(jitter(rng, wernerCorr(F)), wernerCorr(F), { signed: true }),
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

const THEORY_ONLY = "theory only (not measured)";

function decodeRescue(rng, params, opts = {}) {
  const broken = params.broken ?? "BOG-CAL";
  const targetF = params.target_F ?? 0.85;
  const kind = params.damage_kind ?? "werner";
  const dmgF = kind === "werner" ? (params.damage_F ?? 0.7) : kind === "damping" ? 0.78 : 0.62;
  const f1 = params.healthy_F ?? 0.95;
  const Fdirect = clip01(jitter(rng, dmgF, 0.02));
  const FrerouteTheory = f1 * f1 + ((1 - f1) * (1 - f1)) / 3;
  const Freroute = clip01(jitter(rng, FrerouteTheory, 0.02));
  const Fpurify = clip01(Fdirect + 0.08);
  const city = broken === "BOG-CAL" ? "Medellín" : broken === "MED-CAL" ? "Bogotá" : "Cali";

  const measured = (key, title, F, raw, u = null) => ({
    key,
    title,
    status: "ok",
    fidelity: metric(F, F, { ciAmp: 0.03 }),
    raw_pairs: metric(raw, raw, { ciAmp: 0.0 }),
    meets_target: F - 0.03 >= targetF,
    u,
    p_s: u ? 0.82 : null,
    explanation: `${title}: F = ${F.toFixed(3)}, ${raw.toFixed(2)} raw pairs per delivered pair (mock).`,
  });
  const strategies = [measured("direct", "Use the damaged link", Fdirect, 1.0)];
  if (opts.reduced) {
    strategies.push({
      key: "reroute",
      title: `Reroute via ${city}`,
      status: "not_run",
      meets_target: false,
      u: null,
      fidelity: {
        value: FrerouteTheory,
        ci95: [FrerouteTheory, FrerouteTheory],
        theory: FrerouteTheory,
        measured: false,
        label: THEORY_ONLY,
      },
      raw_pairs: { value: 2, ci95: [2, 2], theory: 2, measured: false, label: THEORY_ONLY },
      theory_meets_target: FrerouteTheory >= targetF,
      samples: [],
      explanation: `Not run: the swap circuits did not fit in the single IonQ circuit of this run. Theory only (not measured): F = ${FrerouteTheory.toFixed(3)}, 2 raw pairs.`,
    });
  } else {
    strategies.push(measured("reroute", `Reroute via ${city}`, Freroute, 2.0));
  }
  strategies.push(measured("purify_fixed", "Purify once (fixed DEJMPS)", clip01(Fdirect + 0.04), 2.6, "I"));
  strategies.push(measured("purify_adaptive", "Purify once (adaptive U)", Fpurify, 2.4, "SH"));

  const live = strategies.filter((s) => s.status === "ok");
  const meeting = live.filter((s) => s.meets_target).sort((a, b) => a.raw_pairs.value - b.raw_pairs.value);
  const best = meeting[0] ?? null;
  const criterion =
    "lower CI bound of F meets the target; then fewest raw pairs per delivered pair including fiber loss";
  const notRun = strategies.filter((s) => s.status === "not_run");
  const rec = best
    ? {
        strategy: best.key,
        meets_target: true,
        criterion,
        fewest_raw_pairs_ignoring_loss: best.key,
        message: `Recommended: ${best.title} (F = ${best.fidelity.value.toFixed(3)}, ${best.raw_pairs.value.toFixed(2)} raw pairs). Criterion: ${criterion}.`,
      }
    : {
        strategy: null,
        meets_target: false,
        criterion,
        fewest_raw_pairs_ignoring_loss: null,
        message: `No single strategy meets the target ${targetF} with confidence.`,
      };
  rec.incomplete = notRun.length > 0;
  rec.not_measured = notRun.map((s) => s.key);
  if (rec.incomplete) {
    rec.message += ` INCOMPLETE: not measured on this backend: ${notRun.map((s) => `${s.title}: F = ${s.fidelity.value.toFixed(3)} (${THEORY_ONLY})`).join("; ")}. The recommendation covers only the measured strategies.`;
  }

  const metrics = {};
  for (const s of strategies) {
    metrics[`fidelity_${s.key}`] = s.fidelity;
    metrics[`raw_pairs_${s.key}`] = s.raw_pairs;
  }

  const links = {};
  for (const lid of LINK_IDS) {
    links[lid] =
      lid === broken
        ? {
            F: best ? best.fidelity.value : Fdirect,
            ci95: best ? best.fidelity.ci95 : null,
            status: rec.meets_target ? "rescued" : "damaged",
            source: "simulated",
            direct_F: Fdirect,
            via: rec.strategy,
          }
        : { F: f1, ci95: null, status: "healthy", source: "configured" };
  }

  return {
    metrics,
    viz: {
      links,
      strategies,
      samples: Object.fromEntries(live.map((s) => [s.key, sampleParity(rng, 1 - s.fidelity.value)])),
      leak: { value: 1 - Fdirect, source: "simulated" },
      recommendation: rec,
      notes: ["Mock data: not a measurement."],
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
// Ensamblado del resultado (espejo de analysis.make_result + run_level)
// ---------------------------------------------------------------------------
export const RUN_LEVELS = ["link", "teleport", "noise", "swap", "purify", "qkd", "rescue"];

function makeResult(level, params, dec, extra = {}) {
  return {
    ok: true,
    level,
    mode: "live",
    source: "live",
    backend: "local_mock",
    timestamp: new Date().toISOString(),
    shots: params.shots ?? 1000,
    params,
    bit_order: "Qiskit little-endian (mock)",
    metrics: dec.metrics,
    circuits: [],
    counts: {},
    viz: dec.viz,
    ...extra,
  };
}

const LEVEL_DECODERS = {
  link: (rng) => decodeLink(rng),
  teleport: (rng, p) => decodeTeleport(rng, p),
  noise: (rng, p) => decodeNoise(rng, p),
  swap: (rng, p) => decodeSwap(rng, p),
  purify: (rng, p) => decodePurify(rng, p),
  qkd: (rng, p) => decodeQkd(rng, p),
  rescue: (rng, p, opts) => decodeRescue(rng, p, opts),
};

// Same contract as the real run_level: a result, or {ok:false, input_error:true}
// for the caller's own mistakes (validation, unknown arguments).
const KNOWN_PARAMS = {
  link: ["shots", "seed"],
  teleport: ["shots", "seed", "theta_deg", "phi_deg", "F"],
  noise: ["shots", "seed", "Fs", "mode"],
  swap: ["shots", "seed", "F1", "F2", "mode"],
  purify: ["shots", "seed", "F", "gamma", "p", "strategy", "mode"],
  qkd: ["shots", "seed", "theta_deg", "F", "smart_direct", "beta_source"],
  rescue: ["shots", "seed", "broken", "damage_kind", "damage_F", "damage_gamma", "damage_theta_deg", "healthy_F", "target_F", "mode"],
};

function inputError(message) {
  return { ok: false, error: message, input_error: true };
}

export function validateParams(level, params) {
  if (!RUN_LEVELS.includes(level)) return inputError(`level must be one of ${RUN_LEVELS.join(", ")}`);
  for (const k of Object.keys(params)) {
    if (!KNOWN_PARAMS[level].includes(k)) return inputError(`invalid arguments for level '${level}': unexpected keyword argument '${k}'`);
  }
  if (level === "purify") {
    const given = ["F", "gamma", "p"].filter((k) => params[k] !== undefined && params[k] !== null);
    if (given.includes("F") && given.includes("p")) return inputError("give exactly one of F, gamma or p");
    if (params.p != null && (!Array.isArray(params.p) || params.p.length !== 4 || Math.abs(params.p.reduce((a, b) => a + b, 0) - 1) > 1e-6)) {
      return inputError("p must be four finite non-negative weights (I, X, Y, Z) summing to 1");
    }
    if (params.mode === "precision" && params.gamma != null && params.F == null && params.p == null) {
      return inputError("precision mode only supports Pauli channels (F or p); use teaching for gamma");
    }
  }
  if (level === "qkd" && params.F != null && (params.theta_deg ?? 120) !== 0) {
    return inputError("F (Werner noise) needs theta_deg = 0");
  }
  return null;
}

// ---------------------------------------------------------------------------
// info(): mirror of api.info() (same ids, titles, defaults, nullable params)
// ---------------------------------------------------------------------------
const P = (min, max, def, unit = "") => ({ min, max, default: def, unit });

function info() {
  const d = DEFAULT_PARAMS;
  const shots = P(10, 20000, 1000);
  const modes = { options: ["teaching", "precision"] };
  const levels = [
    { id: "link", title: "First link", function: "level_link",
      summary: "Bell pair measured in X, Y, Z: F from three correlators.", params: { shots } },
    { id: "teleport", title: "Teleportation", function: "level_teleport",
      summary: "Teleport a qubit over a (noisy) link; Pauli frame in Python.",
      params: { shots, theta_deg: P(0, 180, d.teleport.theta_deg, "deg"), phi_deg: P(-360, 360, d.teleport.phi_deg, "deg"), F: P(0.25, 1, d.teleport.F) } },
    { id: "noise", title: "Noise is someone listening", function: "level_noise",
      summary: "Werner noise from environment qubits: measured F vs configured F.",
      params: { shots, Fs: { default: d.noise.Fs, min: 0.25, max: 1, length: [1, 5] }, mode: { ...modes, default: d.noise.mode } } },
    { id: "swap", title: "Repeater (swapping)", function: "level_swap",
      summary: "Join two links with a Bell measurement; F = F1 F2 + (1-F1)(1-F2)/3.",
      params: { shots, F1: P(0.25, 1, d.swap.F1), F2: P(0.25, 1, d.swap.F2), mode: { ...modes, default: d.swap.mode } } },
    { id: "purify", title: "Distillation", function: "level_purify",
      summary: "DEJMPS, fixed vs adaptive. Give at most one of F, gamma or p (none: the default channel, gamma).",
      params: { shots, F: P(0.25, 1, null), gamma: P(0, 1, d.purify.gamma), p: { default: null, length: 4 },
        strategy: { options: ["all", "predicted"], default: d.purify.strategy }, mode: { ...modes, default: d.purify.mode } } },
    { id: "qkd", title: "Catch the spy", function: "level_qkd",
      summary: "E91/BBM92 with a spy: QBER, CHSH, key rate.",
      params: { shots, theta_deg: P(0, 180, d.qkd.theta_deg, "deg"), F: P(0.25, 1, null),
        smart_direct: { default: d.qkd.smart_direct }, beta_source: { options: ["split", "oracle"], default: d.qkd.beta_source } } },
    { id: "rescue", title: "Save the Quantum Network", function: "rescue",
      summary: "Repair a damaged link: direct, reroute or purify (one job, IonQ allowed; reduced on narrow backends).",
      params: { shots, broken: { options: LINK_IDS, default: d.rescue.broken },
        damage_kind: { options: ["werner", "damping", "spy"], default: d.rescue.damage.kind },
        damage_F: P(0.25, 1, d.rescue.damage.F), damage_gamma: P(0, 1, 0.2), damage_theta_deg: P(0, 180, 180, "deg"),
        healthy_F: P(0.25, 1, d.rescue.healthy_F), target_F: P(0.3, 1, d.rescue.target_F), mode: { ...modes, default: d.rescue.mode } } },
  ];
  return {
    ok: true,
    version: "0.1.0-mock",
    attribution: "This effort is supported by Qollab & IonQ.",
    levels,
    run_level: { function: "run_level", levels: RUN_LEVELS, summary: "Recommended UI entry point (mock)." },
    geo: geoInfo(),
  };
}

// ---------------------------------------------------------------------------
// Public mock API (consumed by ui/mock-api.js)
// ---------------------------------------------------------------------------
export function makeMock() {
  let seed = 1;
  return {
    info() {
      return info();
    },
    // opts.reduced -> the rescue level without the reroute measurement (IonQ-like).
    async runLevel(level, params, opts = {}) {
      const bad = validateParams(level, params);
      if (bad) return bad;
      await new Promise((r) => setTimeout(r, 250)); // small latency like a real backend
      const rng = makeRng(seed++);
      const dec = LEVEL_DECODERS[level](rng, params, opts);
      return makeResult(level, params, dec, opts.extra ?? {});
    },
    // Recorded runs, same shape as api.load_recorded().
    loadRecorded() {
      const levels = {};
      RUN_LEVELS.forEach((level, i) => {
        const res = makeResult(level, {}, LEVEL_DECODERS[level](makeRng(100 + i), {}), {
          mode: "recorded",
          source: "recorded",
          backend: "mock_recorded_backend",
          timestamp: "2026-10-09T12:00:00+00:00",
        });
        levels[level] = res;
      });
      return {
        recorded: [{ name: "mock_recorded.json", result: { ok: true, mode: "recorded", backend: "mock_recorded_backend", timestamp: "2026-10-09T12:00:00+00:00", shots: 1000, levels } }],
        errors: [],
        files: ["mock_recorded.json"],
      };
    },
  };
}

export { geoInfo };
