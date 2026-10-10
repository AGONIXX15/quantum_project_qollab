/*
  "Noise is someone listening": the central explainer (pure JS, existing api calls only).

  One dial = how much information leaks to a third party. It is mapped to the spy angle
  theta = dial * pi (CRY(theta) Bob -> third qubit), c = cos(theta/2). Two worlds at the SAME
  fidelity F = (1 + c) / 2:
    - the environment (Werner noise): QBER = 2(1-F)/3 in every basis, S = 2 sqrt2 (4F-1)/3
    - the spy Eve:                    QBER_Z = 0, QBER_X = (1-c)/2,  S = sqrt2 (1 + c)
  Concurrence left between Alice and Bob: Werner max(0, 2F-1), spy state c -- identical at the
  same F (checked with exact density matrices). The "entanglement budget" bar shows the tangle
  C_AB^2 for Alice-Bob; the rest, 1 - C_AB^2, is NOT pairwise Bob-third entanglement (that is 0
  for the spy) but three-way correlation with the third qubit (CKW monogamy, A's total tangle = 1).
  Sources: Werner, PRA 40, 4277 (1989); CHSH, PRL 23, 880 (1969); concurrence, Wootters,
  PRL 80, 2245 (1998); monogamy (CKW), Coffman, Kundu & Wootters, PRA 61, 052306 (2000);
  QBER/E91, Ekert, PRL 67, 661 (1991). Full list in README > References & credits.
  Measured points come from api.run_level 'noise' (Fs=[F]) and 'qkd' (theta_deg) through the
  same bridge as every level; they are drawn as dots with 95 % CI bands over the theory lines.
  Backend text is only ever inserted with textContent.
*/

import { t } from "./i18n.js";
import { decorate } from "./glossary.js";
import { icon } from "./icons.js";

const NS = "http://www.w3.org/2000/svg";
const NOISE_COLOR = "#58d8ff"; // environment: cyan, circles
const SPY_COLOR = "#ffb35c"; // spy: orange, diamonds
const INK = "#e8eef9";
const DIM = "#bcc7d9";

// ---- theory ------------------------------------------------------------------
export function theory(dial) {
  const theta = Math.PI * dial; // dial in 0..1
  const c = Math.cos(theta / 2);
  const F = (1 + c) / 2;
  return {
    dial, theta, thetaDeg: (theta * 180) / Math.PI, c, F,
    spy: { qberZ: 0, qberX: (1 - c) / 2, S: Math.SQRT2 * (1 + c), conc: c },
    noise: { qber: (2 * (1 - F)) / 3, S: (2 * Math.SQRT2 * (4 * F - 1)) / 3, conc: Math.max(0, 2 * F - 1) },
  };
}

// dial position (0..1) of a fidelity F in [0.5, 1] and of a spy angle in degrees
const dialOfF = (F) => (2 * Math.acos(Math.min(1, Math.max(0, 2 * F - 1)))) / Math.PI;
const dialOfTheta = (deg) => deg / 180;

// ---- tiny SVG helpers --------------------------------------------------------
function svg(tag, attrs = {}, kids = []) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const k of [].concat(kids)) if (k) e.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
  return e;
}
const txt = (x, y, s, attrs = {}) => svg("text", { x, y, fill: DIM, "font-size": 11, ...attrs }, s);

function marker(shape, x, y, color, hollow) {
  const common = { fill: hollow ? "none" : color, stroke: color, "stroke-width": 2 };
  if (shape === "diamond") return svg("path", { d: `M${x} ${y - 6}L${x + 6} ${y}L${x} ${y + 6}L${x - 6} ${y}Z`, ...common });
  return svg("circle", { cx: x, cy: y, r: 5, ...common });
}

/**
 * Line chart on a 0..100 % dial axis.
 * series: [{ name, color, pts: [[dial, y]], width, labelAt }]; hlines: [{ y, label }];
 * measured: [{ x (dial 0..1), y, lo, hi, color, shape, recorded }].
 */
function chart({ title, yMin, yMax, yTicks, fmt, series, hlines = [], dial, measured = [], desc }) {
  const W = 360, H = 236, L = 42, R = 12, T = 26, B = 38;
  const px = (d) => L + (d * (W - L - R));
  const py = (y) => T + (1 - (y - yMin) / (yMax - yMin)) * (H - T - B);
  const clampY = (y) => Math.min(yMax, Math.max(yMin, y));
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "leak-chart", role: "img", "aria-label": `${title}. ${desc}` });
  root.appendChild(txt(L, 15, title, { fill: INK, "font-size": 12, "font-weight": 600 }));
  // axes + grid
  for (const y of yTicks) {
    root.appendChild(svg("line", { x1: L, x2: W - R, y1: py(y), y2: py(y), stroke: "rgba(150,180,220,0.16)" }));
    root.appendChild(txt(L - 6, py(y) + 4, fmt(y), { "text-anchor": "end" }));
  }
  for (const d of [0, 0.25, 0.5, 0.75, 1]) {
    root.appendChild(txt(px(d), H - B + 15, `${Math.round(d * 100)}%`, { "text-anchor": "middle" }));
  }
  root.appendChild(txt(L + (W - L - R) / 2, H - 6, t("leak.axis"), { "text-anchor": "middle" }));
  root.appendChild(svg("rect", { x: L, y: T, width: W - L - R, height: H - T - B, fill: "none", stroke: "rgba(150,180,220,0.35)" }));
  // thresholds: dashed, labelled
  for (const h of hlines) {
    root.appendChild(svg("line", { x1: L, x2: W - R, y1: py(h.y), y2: py(h.y), stroke: h.color ?? "#9fb0c8", "stroke-width": 1.4, "stroke-dasharray": "6 4" }));
    root.appendChild(txt(L + 5, py(h.y) + (h.below ? 13 : -4), h.label, { "text-anchor": "start", fill: h.color ?? "#c3cfe2", "font-size": 10.5 }));
  }
  // theory lines (solid)
  for (const s of series) {
    const d = s.pts.map(([x, y], i) => `${i ? "L" : "M"}${px(x).toFixed(1)} ${py(clampY(y)).toFixed(1)}`).join("");
    root.appendChild(svg("path", { d, fill: "none", stroke: s.color, "stroke-width": s.width ?? 2.4, "stroke-linejoin": "round" }));
    if (s.labelAt != null) {
      const p = s.pts.reduce((best, q) => (Math.abs(q[0] - s.labelAt) < Math.abs(best[0] - s.labelAt) ? q : best));
      root.appendChild(txt(px(p[0]), py(clampY(p[1])) + (s.labelDy ?? -8), s.name, { fill: s.color, "font-weight": 600, "text-anchor": "middle", "font-size": 11 }));
    }
  }
  // measured: CI band (15 % opacity, same hue) + whiskers + marker
  for (const m of measured) {
    if (m.y == null) continue;
    const x = px(m.x);
    if (m.lo != null && m.hi != null) {
      root.appendChild(svg("rect", { x: x - 8, y: py(clampY(m.hi)), width: 16, height: Math.max(1, py(clampY(m.lo)) - py(clampY(m.hi))), fill: m.color, "fill-opacity": 0.15 }));
      root.appendChild(svg("line", { x1: x, x2: x, y1: py(clampY(m.hi)), y2: py(clampY(m.lo)), stroke: m.color, "stroke-width": 1.4 }));
    }
    root.appendChild(marker(m.shape, x, py(clampY(m.y)), m.color, m.recorded));
  }
  // dial position
  root.appendChild(svg("line", { x1: px(dial), x2: px(dial), y1: T, y2: H - B, stroke: INK, "stroke-width": 1.2, "stroke-dasharray": "2 3" }));
  for (const s of series) {
    const th = s.at(dial);
    root.appendChild(svg("circle", { cx: px(dial), cy: py(clampY(th)), r: 3.5, fill: "#0e1626", stroke: s.color, "stroke-width": 2 }));
  }
  return root;
}

// Diagram: Alice - Bob pair + a third qubit (environment or Eve). Line widths follow the
// entanglement budget; shapes (dashed square vs triangle) differ so colour is not the only cue.
function diagram(kind, ab) {
  const w = 300, h = 150;
  const root = svg("svg", { viewBox: `0 0 ${w} ${h}`, class: "leak-diagram", "aria-hidden": "true" });
  const color = kind === "spy" ? SPY_COLOR : NOISE_COLOR;
  const tau = ab * ab; // ab is the concurrence; widths follow the tangle budget
  const wAB = 1.5 + 8 * tau, wBX = 1.5 + 8 * (1 - tau);
  root.appendChild(svg("line", { x1: 60, y1: 45, x2: 200, y2: 45, stroke: "#2fe0c0", "stroke-width": wAB, "stroke-linecap": "round" }));
  root.appendChild(svg("line", { x1: 200, y1: 45, x2: 200, y2: 108, stroke: color, "stroke-width": wBX, "stroke-linecap": "round", "stroke-dasharray": kind === "spy" ? "" : "3 6" }));
  const node = (x, y, label, below) => {
    root.appendChild(svg("circle", { cx: x, cy: y, r: 17, fill: "#16233a", stroke: "#e8eef9", "stroke-width": 2 }));
    root.appendChild(txt(x, y + 4.5, label[0], { fill: INK, "text-anchor": "middle", "font-size": 14, "font-weight": 700 }));
    root.appendChild(txt(x, below ? y + 33 : y - 24, label, { fill: INK, "text-anchor": "middle", "font-size": 11 }));
  };
  node(60, 45, t("leak.alice"));
  node(200, 45, t("leak.bob"));
  if (kind === "spy") {
    root.appendChild(svg("path", { d: "M200 94L218 126H182Z", fill: "#16233a", stroke: color, "stroke-width": 2.4 }));
    root.appendChild(txt(200, 120, "E", { fill: INK, "text-anchor": "middle", "font-weight": 700 }));
    root.appendChild(txt(172, 116, t("leak.eve"), { fill: color, "font-weight": 600, "font-size": 12, "text-anchor": "end" }));
  } else {
    root.appendChild(svg("rect", { x: 181, y: 94, width: 38, height: 32, rx: 9, fill: "#16233a", stroke: color, "stroke-width": 2.4, "stroke-dasharray": "5 3" }));
    root.appendChild(txt(200, 115, "ENV", { fill: INK, "text-anchor": "middle", "font-size": 11, "font-weight": 700 }));
    root.appendChild(txt(172, 116, t("leak.env"), { fill: color, "font-weight": 600, "font-size": 12, "text-anchor": "end" }));
  }
  return root;
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const f2 = (v) => (typeof v === "number" ? v.toFixed(2) : "—");
const pct = (v) => `${Math.round(v * 100)}%`;
const ciOf = (m) => (Array.isArray(m?.ci95) && m.ci95.length === 2 ? m.ci95 : [null, null]);
const visible = (res) => (res?.ok === false ? res.fallback?.result ?? null : res);

// noise result -> [{ F, value, lo, hi }]
function parseNoise(res, requestedF) {
  const r = visible(res);
  if (!r?.metrics) return [];
  const out = [];
  for (const [k, m] of Object.entries(r.metrics)) {
    if (!k.startsWith("fidelity@") || typeof m?.value !== "number") continue;
    const F = typeof m.configured === "number" ? m.configured : parseFloat(k.split("@")[1]);
    const [lo, hi] = ciOf(m);
    out.push({ F: Number.isFinite(F) ? F : requestedF, value: m.value, lo, hi });
  }
  return out;
}

// qkd result -> { thetaDeg, qz, qx, S, F (derived), ... }
function parseSpy(res, requestedDeg) {
  const r = visible(res);
  const m = r?.metrics;
  if (!m || typeof m.chsh_standard?.value !== "number") return null;
  // Real results carry params.theta in RADIANS; theta_deg is the fallback (mock / older shape).
  const deg = typeof r.params?.theta === "number" ? (r.params.theta * 180) / Math.PI
    : typeof r.params?.theta_deg === "number" ? r.params.theta_deg : requestedDeg;
  const qz = m.qber_Z?.value, qx = m.qber_X?.value;
  const hw = (mm) => { const [lo, hi] = ciOf(mm); return lo == null ? 0 : (hi - lo) / 2; };
  // F = 1 - qber_X - qber_Z / 2 for this state (XX = c, YY = -c, ZZ = 1 - 2 qber_Z)
  const F = typeof qx === "number" && typeof qz === "number" ? 1 - qx - qz / 2 : null;
  const Fhw = Math.hypot(hw(m.qber_X), hw(m.qber_Z) / 2);
  const [sLo, sHi] = ciOf(m.chsh_standard);
  return { thetaDeg: deg, qz, qx, S: m.chsh_standard.value, sLo, sHi, F, Flo: F == null ? null : F - Fhw, Fhi: F == null ? null : F + Fhw };
}

export function createLeakView(root, { run, onBusy, requestMeasure }) {
  const state = { dial: 0.4, measured: null, measuring: false };

  root.replaceChildren();
  const head = el("div", "leak__head");
  head.append(el("h2", "leak__title"), el("p", "leak__sub"));
  const dialBox = el("div", "leak__dial");
  const dialId = "leak-dial";
  const dialLabel = el("label", "leak__dial-label");
  dialLabel.htmlFor = dialId;
  const dial = el("input");
  dial.type = "range"; dial.id = dialId; dial.min = "0"; dial.max = "100"; dial.step = "1"; dial.value = String(Math.round(state.dial * 100));
  const dialOut = el("output", "leak__dial-out");
  dialOut.setAttribute("for", dialId);
  dialOut.setAttribute("aria-live", "off");
  const dialRead = el("div", "leak__dial-read");
  dialBox.append(dialLabel, dial, dialOut, dialRead);

  const figs = el("div", "leak__figs");
  const mkFig = () => {
    const f = el("figure", "leak__fig");
    f.append(el("figcaption", "leak__figcap"), el("div", "leak__diagram"), el("div", "leak__bar"), el("p", "leak__figtext"));
    return f;
  };
  const figNoise = mkFig(), figSpy = mkFig();
  figs.append(figNoise, figSpy);

  const charts = el("div", "leak__charts");
  const chartF = el("div", "leak__chart"), chartS = el("div", "leak__chart");
  charts.append(chartF, chartS);
  const legend = el("div", "leak__legend");

  const actions = el("div", "leak__actions");
  const measureBtn = el("button", "btn btn--primary");
  measureBtn.type = "button";
  const status = el("p", "leak__status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  actions.append(measureBtn, status);

  const takeaway = el("div", "leak__take");
  const details = el("details", "leak__table");
  const summary = el("summary");
  const tableWrap = el("div");
  details.append(summary, tableWrap);

  root.append(head, dialBox, figs, charts, legend, actions, takeaway, details);

  // ---- rendering ----------------------------------------------------------------
  function bar(conc, who) {
    const ab = conc * conc; // tangle: Alice-Bob share of Alice's entanglement budget
    const b = el("div", "leak__bar-in");
    b.setAttribute("role", "img");
    b.setAttribute("aria-label", t("leak.bar.aria", { ab: pct(ab), third: pct(1 - ab), who }));
    const a = el("span", "leak__seg leak__seg--ab", `${t("leak.bar.ab")} ${pct(ab)}`);
    a.style.flexGrow = String(Math.max(ab, 0.001));
    const x = el("span", "leak__seg leak__seg--third", `${t("leak.bar.third", { who })} ${pct(1 - ab)}`);
    x.style.flexGrow = String(Math.max(1 - ab, 0.001));
    b.append(a, x);
    return b;
  }

  function series(fn, n = 60) {
    return Array.from({ length: n + 1 }, (_, i) => [i / n, fn(theory(i / n))]);
  }

  function legendRow(shapeNode, text) {
    const r = el("span", "leak__leg-item");
    r.append(shapeNode, document.createTextNode(text));
    return r;
  }
  const swatch = (kind, color, dashed) => {
    const s = svg("svg", { width: 30, height: 14, viewBox: "0 0 30 14", "aria-hidden": "true" });
    if (kind === "line") s.appendChild(svg("line", { x1: 2, x2: 28, y1: 7, y2: 7, stroke: color, "stroke-width": 2.6, "stroke-dasharray": dashed ? "5 3" : "" }));
    else s.appendChild(marker(kind, 15, 7, color, dashed));
    return s;
  };

  function render() {
    const th = theory(state.dial);
    root.querySelector(".leak__title").textContent = t("leak.title");
    root.querySelector(".leak__sub").textContent = t("leak.sub");
    dialLabel.textContent = t("leak.dial");
    dialOut.textContent = `${Math.round(state.dial * 100)}%`;
    dialRead.textContent = t("leak.read", { deg: th.thetaDeg.toFixed(0), F: th.F.toFixed(3) });
    dial.setAttribute("aria-valuetext", t("leak.valuetext", { p: Math.round(state.dial * 100), F: th.F.toFixed(2) }));
    measureBtn.textContent = state.measuring ? t("leak.measuring") : t("leak.measure");
    measureBtn.disabled = state.measuring;

    // figures
    const fill = (fig, kind, cap, ab, who, line) => {
      fig.querySelector(".leak__figcap").textContent = cap;
      fig.querySelector(".leak__diagram").replaceChildren(diagram(kind, ab));
      fig.querySelector(".leak__bar").replaceChildren(bar(ab, who));
      fig.querySelector(".leak__figtext").textContent = line;
    };
    fill(figNoise, "noise", t("leak.fig.noise"), th.noise.conc, t("leak.env"),
      t("leak.fig.noise.text", { qber: pct(th.noise.qber) }));
    fill(figSpy, "spy", t("leak.fig.spy"), th.spy.conc, t("leak.eve"),
      t("leak.fig.spy.text", { qz: pct(0), qx: pct(th.spy.qberX) }));

    // charts
    const m = state.measured;
    const noiseF = (m?.noise ?? []).map((p) => ({ x: dialOfF(p.F), y: p.value, lo: p.lo, hi: p.hi, color: NOISE_COLOR, shape: "circle", recorded: m.noiseRecorded }));
    const spyF = m?.spy && m.spy.F != null ? [{ x: dialOfTheta(m.spy.thetaDeg), y: m.spy.F, lo: m.spy.Flo, hi: m.spy.Fhi, color: SPY_COLOR, shape: "diamond", recorded: m.spyRecorded }] : [];
    const spyS = m?.spy ? [{ x: dialOfTheta(m.spy.thetaDeg), y: m.spy.S, lo: m.spy.sLo, hi: m.spy.sHi, color: SPY_COLOR, shape: "diamond", recorded: m.spyRecorded }] : [];

    const fSeries = [{ name: t("leak.both"), color: INK, pts: series((q) => q.F), at: (d) => theory(d).F, labelAt: 0.62, labelDy: -10 }];
    chartF.replaceChildren(chart({
      title: t("leak.chart.F"), yMin: 0.4, yMax: 1.02, yTicks: [0.5, 0.6, 0.7, 0.8, 0.9, 1], fmt: (v) => v.toFixed(1),
      series: fSeries, dial: state.dial, measured: [...noiseF, ...spyF],
      hlines: [{ y: 0.5, label: t("leak.F.half"), below: false }, { y: 0.7803, label: t("leak.F.chsh"), below: true }],
      desc: t("leak.chart.F.desc"),
    }));
    const sSeries = [
      { name: t("leak.env"), color: NOISE_COLOR, pts: series((q) => q.noise.S), at: (d) => theory(d).noise.S, labelAt: 0.9, labelDy: 18 },
      { name: t("leak.eve"), color: SPY_COLOR, pts: series((q) => q.spy.S), at: (d) => theory(d).spy.S, labelAt: 0.9, labelDy: -9 },
    ];
    chartS.replaceChildren(chart({
      title: t("leak.chart.S"), yMin: 0.8, yMax: 3, yTicks: [1, 1.5, 2, 2.5, 3], fmt: (v) => v.toFixed(1),
      series: sSeries, dial: state.dial, measured: spyS,
      hlines: [{ y: 2, label: t("leak.S.classical"), color: "#ffd36b", below: true }],
      desc: t("leak.chart.S.desc"),
    }));

    legend.replaceChildren(
      legendRow(swatch("line", NOISE_COLOR), t("leak.leg.noise")),
      legendRow(swatch("line", SPY_COLOR), t("leak.leg.spy")),
      legendRow(swatch("line", INK), t("leak.leg.both")),
      legendRow(swatch("line", "#ffd36b", true), t("leak.leg.limit")),
      legendRow(swatch("circle", NOISE_COLOR), t("leak.leg.m_noise")),
      legendRow(swatch("diamond", SPY_COLOR), t("leak.leg.m_spy")),
      legendRow(swatch("circle", "#e8eef9", true), t("leak.leg.recorded")),
    );

    // takeaway
    const lines = [
      t("leak.take.1", { F: th.F.toFixed(2) }),
      t("leak.take.2", { qn: pct(th.noise.qber), qx: pct(th.spy.qberX) }),
      t("leak.take.3", { Sn: f2(th.noise.S), Ss: f2(th.spy.S) }),
    ];
    takeaway.replaceChildren(el("h3", "leak__take-h", t("leak.take.h")), ...lines.map((l) => el("p", null, l)));
    decorate(takeaway);

    // table
    summary.textContent = t("leak.table");
    tableWrap.replaceChildren(buildTable(th));
  }

  function buildTable(th) {
    const tb = el("table");
    const cap = el("caption", null, t("leak.table.cap", { p: Math.round(state.dial * 100) }));
    const head = el("tr");
    for (const h of [t("leak.table.q"), t("leak.env"), t("leak.eve")]) head.appendChild(el("th", null, h)).scope = "col";
    const rows = [
      [t("leak.table.F"), f2(th.F), f2(th.F)],
      [t("leak.table.qz"), pct(th.noise.qber), pct(0)],
      [t("leak.table.qx"), pct(th.noise.qber), pct(th.spy.qberX)],
      [t("leak.table.S"), f2(th.noise.S), f2(th.spy.S)],
      [t("leak.table.conc"), f2(th.noise.conc), f2(th.spy.conc)],
    ];
    const body = el("tbody");
    for (const r of rows) {
      const tr = el("tr");
      tr.appendChild(el("th", null, r[0])).scope = "row";
      tr.append(el("td", null, r[1]), el("td", null, r[2]));
      body.appendChild(tr);
    }
    tb.append(cap, el("thead")); tb.querySelector("thead").appendChild(head); tb.appendChild(body);
    const m = state.measured;
    if (m) {
      const mb = el("tbody");
      const add = (a, b, c) => { const tr = el("tr"); tr.appendChild(el("th", null, a)).scope = "row"; tr.append(el("td", null, b), el("td", null, c)); mb.appendChild(tr); };
      const ci = (v, lo, hi) => (typeof v === "number" ? `${v.toFixed(3)}${lo != null ? ` [${lo.toFixed(3)}, ${hi.toFixed(3)}]` : ""}` : "—");
      // the noise point closest to the dial's F
      const n0 = (m.noise ?? []).reduce((best, p) => (!best || Math.abs(dialOfF(p.F) - state.dial) < Math.abs(dialOfF(best.F) - state.dial) ? p : best), null);
      add(t("leak.table.mF"), n0 ? `${ci(n0.value, n0.lo, n0.hi)} (F = ${n0.F.toFixed(2)})` : "—", m.spy ? `${ci(m.spy.F, m.spy.Flo, m.spy.Fhi)} (θ = ${m.spy.thetaDeg.toFixed(0)}°)` : "—");
      add(t("leak.table.mS"), t("leak.notmeasured"), m.spy ? ci(m.spy.S, m.spy.sLo, m.spy.sHi) : "—");
      add(t("leak.table.mq"), t("leak.notmeasured"), m.spy ? `Z ${pct(m.spy.qz ?? 0)} · X ${pct(m.spy.qx ?? 0)}` : "—");
      tb.appendChild(mb);
    }
    return tb;
  }

  // ---- measure --------------------------------------------------------------------
  function setStatus(msg, kind = "info") {
    status.replaceChildren();
    if (!msg) return;
    status.append(icon(kind === "ok" ? "ok" : kind === "warn" ? "warn" : kind === "run" ? "running" : "info", 14), document.createTextNode(msg));
  }

  // Runs noise then qkd sequentially. Returns { anyRecorded, anyFailed, pending, busy }.
  async function measure() {
    if (state.measuring) return { anyRecorded: false, anyFailed: false, busy: true };
    state.measuring = true;
    onBusy?.(true);
    render();
    const th = theory(state.dial);
    const Fr = Math.round(th.F * 1000) / 1000;
    const degR = Math.round(th.thetaDeg * 10) / 10;
    const out = { anyRecorded: false, anyFailed: false, pending: false, busy: false };
    const m = { noise: [], spy: null, noiseRecorded: false, spyRecorded: false };
    const notes = [];
    const stop = (r) => r?.code === "previous_pending" || r?.error === "timeout"; // do not launch another job
    // Notes for a non-ok / missing result; returns true when the sequence must stop.
    const judge = (r, what, fb) => {
      if (r === null || r === undefined) { out.busy = true; notes.push(t("leak.busy")); return true; }
      if (r.ok !== false) return false;
      const rec = !!r.fallback?.result;
      if (rec) {
        out.anyRecorded = true;
        notes.push(r.code === "ionq_job_used" ? t("leak.rec.ionq", { what }) : t(fb));
      } else if (r.code === "previous_pending") {
        out.pending = true; notes.push(t("leak.pending"));
      } else {
        out.anyFailed = true; notes.push(r.error === "timeout" ? t("leak.timeout", { what }) : t(`leak.fail.${what === t("leak.what.noise") ? "noise" : "spy"}`));
      }
      return stop(r);
    };
    try {
      setStatus(t("leak.run.noise", { F: Fr.toFixed(3) }), "run");
      const rn = await run("noise", { Fs: [Fr] });
      if (rn) { m.noise = parseNoise(rn, Fr); m.noiseRecorded = rn.ok === false && !!rn.fallback?.result; }
      let halt = judge(rn, t("leak.what.noise"), "leak.rec.noise");
      if (!halt) {
        setStatus(t("leak.run.spy", { deg: degR.toFixed(1) }), "run");
        const rs = await run("qkd", { theta_deg: degR });
        if (rs) { m.spy = parseSpy(rs, degR); m.spyRecorded = rs.ok === false && !!rs.fallback?.result; }
        halt = judge(rs, t("leak.what.spy"), "leak.rec.spy");
      }
      if (m.noise.length || m.spy) state.measured = m;
    } catch (err) {
      out.anyFailed = true;
      notes.push(String(err?.message ?? err));
    } finally {
      state.measuring = false;
      onBusy?.(false);
    }
    render();
    if (out.anyFailed) setStatus(notes.join(" "), "warn");
    else if (out.pending || out.busy || out.anyRecorded) setStatus(notes.join(" "), "info");
    else setStatus(t("leak.done"), "ok");
    return out;
  }

  dial.addEventListener("input", () => {
    state.dial = Number(dial.value) / 100;
    render();
  });
  measureBtn.addEventListener("click", () => (requestMeasure ? requestMeasure() : measure()));

  render();
  return {
    measure,
    render,
    show() { root.hidden = false; },
    hide() { root.hidden = true; },
    isVisible: () => !root.hidden,
    isMeasuring: () => state.measuring,
  };
}
