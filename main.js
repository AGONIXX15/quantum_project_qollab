/*
  Entangle the Andes - UI orchestrator (identical locally and on Qollab).

  - `import * as api from 'quantum.api'` is STATIC (the only form Qollab resolves).
    Locally dev/index.html maps that name to ui/mock-api.js.
  - Every level runs through api.run_level(backend, level, params) on every backend.
    On IonQ: 1 Run = 1 level (one packed circuit); other levels answer with the
    recorded fallback, which is always labelled "Recorded".
  - The LAST line must be `await new Promise(() => {})`: Qollab only lets jobs reach
    IonQ while main.js top-level code is still pending (Stop still ends the run).
*/

import * as api from "quantum.api";
import { createBridge, DEFAULT_TIMEOUT_MS } from "./ui/api-bridge.js";
import { NetworkScene, classifyFidelity } from "./ui/scene.js";
import { buildParamsForm, readParams, renderResult, linkStatusCard, hardwareFromRecorded, hardwareCard } from "./ui/panel.js";
import { hasExplain, explainTitle, explainBefore, explainAfter, cityTooltip } from "./ui/explain.js";
import { t, tOr, getLang, setLang, onLangChange, applyI18n } from "./ui/i18n.js";
import { setIconText } from "./ui/icons.js";
import { decorate } from "./ui/glossary.js";
import { createTour } from "./ui/tour.js";
import { createLeakView } from "./ui/leak.js";
import { createSandboxView, sandboxResultCards, parityFromF, BUILTIN_PRESETS } from "./ui/sandbox.js";

const $ = (id) => document.getElementById(id);
const els = {
  app: $("app"),
  scene: $("scene-container"),
  labels: $("labels"),
  loader: $("loader"),
  tooltip: $("tooltip"),
  levelSelect: $("level-select"),
  levelSummary: $("level-summary"),
  levelWhy: $("level-why"),
  regionBtn: $("region-btn"),
  leakView: $("leak-view"),
  tour: $("tour"),
  tourBtn: $("tour-btn"),
  params: $("params"),
  runBtn: $("run-btn"),
  runStatus: $("run-status"),
  runStatusText: $("run-status-text"),
  runSecs: $("run-secs"),
  results: $("results"),
  exportRow: $("export-row"),
  exportBtn: $("export-btn"),
  exportStatus: $("export-status"),
  explainer: $("explainer"),
  backendBadge: $("backend-badge"),
  legend: $("legend"),
  legendToggle: $("legend-toggle"),
  legendArrow: $("legend-arrow"),
  langBtn: $("lang-btn"),
  cityList: $("city-list"),
  citiesSection: $("cities-section"),
  cityInfo: $("city-info"),
  attribution: $("attribution"),
};

// Dev-only escape hatch to test the timeout path quickly (?timeout_ms=3000).
// Honoured only on the local mock (no Qollab backend): never on Qollab.
const IS_LOCAL = typeof backend === "undefined";
const query = new URLSearchParams(IS_LOCAL ? (globalThis.location?.search ?? "") : "");
const timeoutOverride = Number(query.get("timeout_ms"));
const bridge = createBridge(api, { timeoutMs: IS_LOCAL && timeoutOverride > 0 ? timeoutOverride : DEFAULT_TIMEOUT_MS });

let infoData = null;
let hardwareLink = null; // recorded real-hardware result of chapter 1 (from Python), or null
let scene = null;
let levelsById = {};
let shown = null; // { levelId, result } currently rendered
let selectedCity = null;
let status = { state: "ready", secs: 0, note: null };
let leak = null;
let tour = null;
let presetsRequested = false;

// Chapter 4 of the story: pure-JS explainer placed right after "noise" (no backend level).
const LEAK_LEVEL = { id: "leak", title: "Noise is someone listening", summary: "One dial: how much information leaks to a third party.", params: {} };

// Chapter 9: free sandbox on the current map region (Python: api.sandbox / api.sandbox_presets).
const SANDBOX_LEVEL = { id: "sandbox", title: "Build your own network", summary: "Place cities, wire links, pick two endpoints and measure the route.", params: {} };

const sandboxView = createSandboxView(els.params, {
  getScene: () => scene,
  onChange: () => onSandboxEdited(),
  onNotice: () => {},
});

// Which geographic link each level animates by default.
const LEVEL_LINK = {
  link: "BOG-MED",
  teleport: "BOG-MED",
  noise: "BOG-MED",
  swap: "BOG-CAL",
  purify: "BOG-CAL",
  qkd: "MED-CAL",
  rescue: "BOG-CAL",
};

// --- status (text + icon, never colour alone) --------------------------------
const STATE_ICON = { ready: "idle", running: "running", success: "ok", failed: "fail", recorded: "recorded" };

function renderStatus() {
  const { state, secs, note } = status;
  els.runStatus.dataset.state = state;
  setIconText(els.runStatusText, STATE_ICON[state], note ? t(note) : t(`status.${state}`));
  // The elapsed-seconds counter is visual only (aria-hidden): no announcement every second.
  els.runSecs.textContent = state === "running" ? ` · ${secs} s` : "";
}

function setState(state, secs = 0, note = null) {
  status = { state, secs, note: state === "running" ? note : null };
  renderStatus();
  const busy = state === "running";
  els.runBtn.disabled = busy;
  els.levelSelect.disabled = busy;
  els.exportBtn.disabled = busy;
  sandboxView.setBusy(busy);
  els.results.setAttribute("aria-busy", String(busy));
}

// --- language ----------------------------------------------------------------
function refreshLevelTexts() {
  const lvl = levelsById[els.levelSelect.value];
  [...els.levelSelect.options].forEach((opt, i) => {
    const l = levelsById[opt.value];
    // Chapter number in front of every level: the selector reads as the story.
    opt.textContent = `${i + 1} · ${tOr(`level.${opt.value}.title`, l?.title ?? opt.value)}`;
  });
  els.levelSummary.textContent = lvl ? tOr(`level.${lvl.id}.summary`, lvl.summary || "") : "";
  const idx = els.levelSelect.selectedIndex;
  els.levelWhy.textContent = lvl ? `${t("level.chapter", { n: idx + 1 })} · ${tOr(`level.${lvl.id}.why`, "")}` : "";
}

function renderBackendBadge() {
  els.backendBadge.textContent = t("badge.backend", { name: bridge.backendName() });
}

function renderAttribution() {
  // Official text; info().attribution wins when present (it is the same sentence).
  els.attribution.textContent = infoData?.attribution || t("footer.attribution");
  els.attribution.removeAttribute("data-i18n"); // keep it verbatim in both languages
}

els.langBtn.addEventListener("click", () => setLang(getLang() === "en" ? "es" : "en"));
els.legendToggle.addEventListener("click", () => {
  const collapsed = els.legend.classList.toggle("collapsed");
  els.legendToggle.setAttribute("aria-expanded", String(!collapsed));
  els.legendArrow.textContent = collapsed ? "▸" : "▾";
});

onLangChange((lang) => {
  els.langBtn.lang = lang === "en" ? "es" : "en"; // the button shows the OTHER language's name
  refreshLevelTexts();
  renderBackendBadge();
  renderStatus();
  renderCityInfo();
  // Text only: do not touch the 3D scene (no camera move, no photons re-emitted).
  if (shown) renderShownText();
  else renderExplainer(els.levelSelect.value, null);
  leak?.render();
  if (els.levelSelect.value === "sandbox") sandboxView.render();
  tour?.render();
  syncRegionBtn();
  if (els.levelSelect.value === "leak") showLeakHints();
});

// --- explainer ---------------------------------------------------------------
function renderExplainer(levelId, result) {
  els.explainer.replaceChildren();
  if (!hasExplain(levelId) && levelId !== "sandbox") return;
  const title = document.createElement("p");
  title.className = "explainer__title";
  title.textContent = `${t("ex.prefix")} · ${explainTitle(levelId)}`;
  const body = document.createElement("div");
  body.className = "explainer__body";
  body.innerHTML = explainBefore(levelId); // our own dictionary markup
  if (result) {
    const line = levelId === "sandbox" ? (result.ok === false ? "" : t("ex.sandbox.after")) : explainAfter(levelId, result);
    if (line) {
      body.appendChild(document.createElement("br"));
      body.appendChild(document.createElement("br"));
      if (typeof line === "string") {
        const span = document.createElement("span");
        span.innerHTML = line; // dictionary text + formatted numbers only
        body.appendChild(span);
      } else {
        const b = document.createElement("b");
        b.textContent = line.text; // backend text: textContent
        body.appendChild(b);
      }
    }
  }
  els.explainer.append(title, body);
  decorate(els.explainer);
}

// --- cities (keyboard access in addition to 3D hover) ------------------------
function cityRows(data) {
  const info = data.sandbox
    ? { title: data.name, rows: [t("city.coords", { lat: data.lat.toFixed(3), lon: data.lon.toFixed(3) })] }
    : cityTooltip(data);
  const frag = document.createDocumentFragment();
  const title = document.createElement("div");
  title.className = "tooltip__title";
  title.textContent = info.title;
  frag.appendChild(title);
  for (const r of info.rows) {
    const row = document.createElement("div");
    row.className = "tooltip__row";
    row.textContent = r;
    frag.appendChild(row);
  }
  return frag;
}

function renderCityInfo() {
  const data = selectedCity && infoData?.geo?.cities?.[selectedCity];
  els.cityInfo.replaceChildren();
  if (data) {
    els.cityInfo.appendChild(cityRows(data));
  } else {
    const hint = document.createElement("span");
    hint.className = "city-info__hint";
    hint.dataset.i18n = "cities.hint";
    hint.textContent = t("cities.hint");
    els.cityInfo.appendChild(hint);
  }
}

function buildCityList(cities) {
  els.cityList.replaceChildren();
  for (const [id, c] of Object.entries(cities)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "city-btn" + (c.challenge ? " city-btn--challenge" : "");
    b.textContent = c.name;
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => {
      selectedCity = id;
      for (const o of els.cityList.children) o.setAttribute("aria-pressed", String(o === b));
      renderCityInfo();
      scene?.focusCity(id);
    });
    els.cityList.appendChild(b);
  }
}

function onHover(hovered) {
  if (!hovered) {
    els.tooltip.hidden = true;
    document.body.style.cursor = "";
    return;
  }
  if (hovered.type === "city") {
    els.tooltip.replaceChildren(cityRows(hovered.data));
    els.tooltip.hidden = false;
    els.tooltip.style.left = `${hovered.client.x}px`;
    els.tooltip.style.top = `${hovered.client.y}px`;
    document.body.style.cursor = "pointer";
  } else if (hovered.type === "link") {
    els.tooltip.replaceChildren(linkRows(hovered.data));
    els.tooltip.hidden = false;
    els.tooltip.style.left = `${hovered.client.x}px`;
    els.tooltip.style.top = `${hovered.client.y}px`;
    document.body.style.cursor = "help";
  }
}

// Tooltip rows of a fiber link: lengths (great-circle computed, fibre assumed), eta, last F.
function linkRows(d) {
  const frag = document.createDocumentFragment();
  const add = (cls, text) => {
    const row = document.createElement("div");
    row.className = cls;
    row.textContent = text;
    frag.appendChild(row);
  };
  add("tooltip__title", `${d.from}–${d.to}`);
  add("tooltip__row", t("tip.link.gc", { km: Math.round(d.great_circle_km) }));
  if (typeof d.length_km === "number") add("tooltip__row", t("tip.link.fibre", { km: Math.round(d.length_km) }));
  if (typeof d.eta === "number") add("tooltip__row", t("tip.link.eta", { eta: d.eta.toExponential(2) }));
  if (typeof d.F === "number") add("tooltip__row", t("tip.link.f", { F: d.F.toFixed(2), status: t(`link.${d.kind}`) }));
  return frag;
}

// --- levels / run --------------------------------------------------------------
function showLeakHints() {
  els.params.replaceChildren();
  const note = document.createElement("p");
  note.className = "level-summary";
  note.textContent = t("leak.noparams");
  els.params.appendChild(note);
  els.results.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "results__empty";
  empty.textContent = t("leak.results.hint");
  els.results.appendChild(empty);
}

function selectLevel(id, { focus = true } = {}) {
  const lvl = levelsById[id];
  if (!lvl) return;
  refreshLevelTexts();
  shown = null;
  syncExport();
  const isLeak = id === "leak";
  const isSandbox = id === "sandbox";
  if (!isSandbox) {
    sandboxView.unmount();
    scene?.leaveSandbox();
  }
  els.app.classList.toggle("is-sandbox", isSandbox);
  els.runBtn.dataset.i18n = isSandbox ? "sandbox.run" : "run";
  els.runBtn.textContent = t(els.runBtn.dataset.i18n);
  leak?.[isLeak ? "show" : "hide"]();
  els.regionBtn.hidden = isLeak;
  els.legend.hidden = isLeak;
  els.app.classList.toggle("is-leak", isLeak);
  scene?.setIdle(isLeak); // the 3D map is covered: render at a low rate
  if (isLeak) {
    showLeakHints();
    renderExplainer(id, null);
    return;
  }
  if (isSandbox) {
    enterSandbox();
    renderExplainer(id, null);
    syncRegionBtn();
    return;
  }
  buildParamsForm(els.params, lvl, { ionq: /ionq/i.test(bridge.backendName()) });
  applyI18n(els.params);
  els.results.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "results__empty";
  empty.dataset.i18n = "results.empty";
  empty.textContent = t("results.empty");
  els.results.appendChild(empty);
  renderExplainer(id, null);
  const linkId = LEVEL_LINK[id];
  if (focus && linkId && scene) scene.focusLink(linkId);
  syncRegionBtn();
}

// --- chapter 9: sandbox -------------------------------------------------------------
function showSandboxHint(stale = false) {
  els.results.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "results__empty";
  empty.textContent = t(stale ? "sandbox.res.stale" : "sandbox.res.hint");
  els.results.appendChild(empty);
}

function enterSandbox() {
  if (/ionq/i.test(bridge.backendName())) sandboxView.setDefaultShots(500); // one small job
  els.params.replaceChildren();
  sandboxView.mount(); // renders the form and draws the demo graph on the map
  showSandboxHint();
  scene?.viewRegion(); // the sandbox covers the whole region
  if (!presetsRequested) {
    presetsRequested = true;
    sandboxView.setPresets(BUILTIN_PRESETS); // usable at once; the Python list replaces it when it arrives
    bridge.sandboxPresets().then((res) => {
      if (!res?.cities?.length) return;
      sandboxView.setPresets(res.cities);
      sandboxView.setExample(res.example);
    }).catch(() => {});
  }
}

// Any edit of the graph or the endpoints makes the shown result stale.
function onSandboxEdited() {
  if (els.levelSelect.value !== "sandbox" || !shown) return;
  shown = null;
  scene?.clearPhotons();
  scene?.resetLinks();
  syncExport();
  showSandboxHint(true);
}

function updateSandboxScene(r) {
  if (!scene) return;
  scene.clearPhotons();
  scene.resetLinks();
  if (!r) return;
  const vizLinks = r.viz?.links;
  let items = Array.isArray(vizLinks) ? vizLinks : Object.entries(vizLinks ?? {}).map(([id, v]) => ({ id, ...v }));
  if (!items.length) items = (r.hops ?? []).map((h) => ({ a: h.a, b: h.b, F_theory: h.F }));
  const ids = [];
  for (const l of items) {
    const id = (l.a && l.b ? scene.findLinkId(l.a, l.b) : null) ?? (scene.links[l.id] ? l.id : null);
    if (!id || ids.includes(id)) continue;
    const F = l.F_theory ?? l.F ?? null;
    scene.setLinkStates({ [id]: { F, status: l.status } });
    ids.push(id);
    const given = r.viz?.samples?.[id];
    scene.emitPhotons(id, Array.isArray(given) && given.length ? given : parityFromF(F ?? 1));
  }
  scene.emphasizeRoute(ids);
  if (Array.isArray(r.route) && r.route.length) scene.focusNodes(r.route);
}

function syncRegionBtn() {
  const region = scene?.viewMode === "region";
  els.regionBtn.dataset.i18n = region ? "map.network" : "map.region";
  els.regionBtn.textContent = t(region ? "map.network" : "map.region");
}

// Wait one frame so "Running" paints; fall back to a timer if rAF does not fire (hidden tab).
const nextFrame = () =>
  new Promise((resolve) => {
    let done = false;
    const go = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    requestAnimationFrame(() => setTimeout(go, 0));
    setTimeout(go, 50);
  });

// Chapter "leak": the dial is theory in JS; Run / "Measure it" overlay real circuit results.
async function runLeak() {
  if (status.state === "running") return;
  setState("running", 0);
  await nextFrame();
  const out = await leak.measure();
  // Nothing ran (busy / previous run pending): back to ready, the leak view shows the notice.
  if (out.busy || out.pending) setState("ready");
  else setState(out.anyFailed ? "failed" : out.anyRecorded ? "recorded" : "success");
}

async function run({ auto = false } = {}) {
  const levelId = els.levelSelect.value;
  if (!levelsById[levelId]) return;
  if (levelId === "leak") return runLeak();
  if (levelId === "sandbox") return runSandbox({ auto });
  const params = readParams(els.params);
  setState("running", 0, auto ? "autorun.running" : null);
  // Local simulators block the main thread: paint "Running" before Python starts.
  await nextFrame();
  let result;
  try {
    result = await bridge.runLevel(levelId, params, {
      onState: (s) => (s === "running" ? setState("running", status.secs, status.note) : setState(s)),
      onTick: (secs) => setState("running", secs, status.note),
    });
  } catch (err) {
    result = { ok: false, error: String(err?.message ?? err) };
  }
  settle(levelId, result);
}

// Shared tail of run() and runSandbox(): paint a bridge result (or nothing, if stale/ignored).
function settle(levelId, result, extra = {}) {
  if (result === null || result === undefined) {
    // Stale (a newer request replaced it) or ignored (busy): do not paint anything.
    if (status.state === "running") setState("ready");
    return;
  }
  if (result.code === "previous_pending") {
    // Nothing ran: keep what is on screen and just explain.
    setState("ready");
    renderResult(els.results, result);
    return;
  }
  // A failed live call that still shows a recorded result is not a failure for the user.
  const hasRecorded = result.ok === false && !!result.fallback?.result;
  setState(result.ok === false && !hasRecorded ? "failed" : hasRecorded ? "recorded" : "success");
  shown = { levelId, result, ...extra };
  renderShown();
  syncExport();
}

// Chapter 9: validate the graph on the client (nothing is sent if it is invalid), then run it.
async function runSandbox() {
  if (status.state === "running") return;
  const v = sandboxView.validate();
  if (!v.ok) {
    sandboxView.notice(v.key, v.vars);
    return;
  }
  const names = sandboxView.names(); // names as they were when the run started
  setState("running", 0);
  await nextFrame();
  let result;
  try {
    result = await bridge.runSandbox(v.graph, v.shots, {
      onState: (s) => (s === "running" ? setState("running", status.secs, status.note) : setState(s)),
      onTick: (secs) => setState("running", secs, status.note),
    });
  } catch (err) {
    result = { ok: false, error: String(err?.message ?? err) };
  }
  settle("sandbox", result, { names });
}

// --- export (download the displayed result as JSON) -------------------------------
// The button exists only while a level result (live or recorded) is on screen.
function syncExport() {
  els.exportRow.hidden = !(shown && visibleResult(shown.result));
  els.exportStatus.textContent = "";
}

const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";

els.exportBtn.addEventListener("click", async () => {
  const vis = shown && visibleResult(shown.result);
  if (!vis || status.state === "running" || bridge.isBusy()) return;
  const filename = `entangle-${slug(shown.levelId)}-${slug(vis.backend ?? bridge.backendName())}.json`;
  els.exportBtn.disabled = true;
  try {
    const res = await bridge.exportResult(vis, filename);
    els.exportStatus.textContent = res?.ok === false
      ? t("export.failed", { error: res.error ?? "?" })
      : res?.exported === false ? t("export.unavailable") : t("export.done", { file: filename });
  } catch (err) {
    els.exportStatus.textContent = t("export.failed", { error: String(err?.message ?? err) });
  } finally {
    els.exportBtn.disabled = status.state === "running";
  }
});

// What to draw: the result, or the recorded fallback of a failed call.
function visibleResult(result) {
  return result?.ok === false ? (result.fallback?.result ?? null) : result;
}

// Text panels only (results, link-status card, explainer): safe to redo on a language change.
function renderShownText() {
  const { levelId, result } = shown;
  renderResult(els.results, result);
  const vis = visibleResult(result);
  if (levelId === "sandbox") {
    if (result?.ok !== false) {
      const cards = sandboxResultCards(result, shown.names);
      const meta = els.results.querySelector(".meta");
      if (meta) meta.after(cards);
      else els.results.prepend(cards);
    } else if (result.code === "ionq_too_wide") {
      const hint = document.createElement("p");
      hint.className = "meta__line";
      hint.textContent = t("sandbox.err.too_wide_hint");
      els.results.appendChild(hint);
    }
    renderExplainer(levelId, vis);
    return;
  }
  const ls = linkStatusOf(levelId, vis);
  if (ls) els.results.appendChild(linkStatusCard(ls));
  // Chapter 1 only, and not when the recording itself is what is on screen.
  if (levelId === "link" && hardwareLink && vis?.backend !== hardwareLink.backend) {
    els.results.appendChild(hardwareCard(hardwareLink));
  }
  renderExplainer(levelId, vis);
}

function renderShown() {
  const { levelId, result } = shown;
  updateScene(levelId, visibleResult(result));
  renderShownText();
}

// --- scene ---------------------------------------------------------------------
function linkLabel(linkId) {
  const l = infoData?.geo?.links?.find((x) => x.id === linkId);
  const cities = infoData?.geo?.cities ?? {};
  return l ? `${cities[l.a]?.name ?? l.a}–${cities[l.b]?.name ?? l.b}` : linkId;
}

// {F, status} for the level's own link, from the level's fidelity metric.
function levelFidelity(levelId, r) {
  const m = r?.metrics ?? {};
  if (levelId === "qkd") {
    const s = m.chsh_standard?.value;
    if (typeof s !== "number") return null;
    // No fidelity metric in this level: S/(2*sqrt(2)) is the fidelity-equivalent of the
    // spy model; S <= 2 means the Bell violation (and the link) is lost.
    return { F: Math.min(1, s / (2 * Math.SQRT2)), status: s > 2 ? undefined : "broken" };
  }
  const v = (levelId === "purify" ? (m.fidelity_adaptive ?? m.fidelity_fixed) : m.fidelity)?.value;
  return typeof v === "number" ? { F: v } : null;
}

// Status card info {label, F, status} for the level's main link (pure, no scene access).
function linkStatusOf(levelId, r) {
  if (!r || levelId === "noise") return null;
  if (levelId === "rescue") {
    const broken = r.params?.broken;
    const st = broken && r.viz?.links?.[broken];
    return st ? { label: linkLabel(broken), F: st.F, status: st.status ?? classifyFidelity(st.F) } : null;
  }
  const lf = levelFidelity(levelId, r);
  const target = LEVEL_LINK[levelId];
  return lf ? { label: linkLabel(target), F: lf.F, status: lf.status ?? classifyFidelity(lf.F) } : null;
}

// Paints the 3D scene (links, photons, camera). Only called after a run, never on a language change.
function updateScene(levelId, r) {
  if (levelId === "sandbox") return updateSandboxScene(r);
  if (!scene) return;
  scene.clearPhotons();
  scene.resetLinks();
  if (!r) return;
  const viz = r.viz || {};
  const samples = viz.samples;
  const geoLinkIds = Object.keys(scene.links);

  if (levelId === "rescue") {
    const broken = r.params?.broken; // there is no viz.broken
    scene.setLinkStates(viz.links); // viz.links has geo ids here
    if (broken && scene.links[broken]) {
      const rec = viz.recommendation?.strategy;
      const serie = (rec && samples?.[rec]?.length ? samples[rec] : null) ?? Object.values(samples || {}).find((s) => s?.length);
      if (serie) scene.emitPhotons(broken, serie);
      scene.highlightLink(broken);
      scene.focusLink(broken);
    }
    return;
  }

  if (levelId === "noise" && viz.links && samples && !Array.isArray(samples)) {
    // One series per configured F: spread them over the geographic links.
    Object.entries(viz.links).forEach(([key, st], i) => {
      const lid = geoLinkIds[i];
      if (!lid) return;
      scene.setLinkStates({ [lid]: { F: st.F } });
      if (samples[key]) scene.emitPhotons(lid, samples[key]);
    });
    return;
  }

  const target = LEVEL_LINK[levelId] || geoLinkIds[0];
  const lf = levelFidelity(levelId, r);
  if (lf) scene.setLinkStates({ [target]: { F: lf.F, status: lf.status } });
  if (Array.isArray(samples)) scene.emitPhotons(target, samples);
  scene.highlightLink(target);
  scene.focusLink(target);
}

function hideLoader() {
  els.loader?.classList.add("hidden");
}

function showFatal(message) {
  els.results.replaceChildren();
  const box = document.createElement("div");
  box.className = "results__error";
  setIconText(box, "fail", message);
  els.results.appendChild(box);
}

// --- boot ----------------------------------------------------------------------
async function boot() {
  applyI18n(document);
  renderBackendBadge();
  setState("ready");
  els.runBtn.disabled = true;

  // Real-hardware recording for the chapter 1 card: loaded once, silently ignored if missing.
  bridge.loadRecorded().then((rec) => {
    hardwareLink = hardwareFromRecorded(rec);
    if (hardwareLink && shown?.levelId === "link") renderShownText();
  }).catch(() => {});
  infoData = await bridge.info();
  if (!infoData || infoData.ok === false) {
    hideLoader();
    setState("failed");
    showFatal(`info(): ${infoData?.error ?? "unknown error"}`);
    return;
  }
  renderAttribution();

  try {
    scene = new NetworkScene(els.scene, els.labels);
    scene.buildFromGeo(infoData.geo);
    scene.onHover(onHover);
  } catch (err) {
    // No WebGL (or three failed): the panels still work without the 3D view.
    console.error(err);
    scene = null;
  }
  buildCityList(infoData.geo.cities);

  const levels = [...infoData.levels];
  const at = levels.findIndex((l) => l.id === "noise");
  levels.splice(at >= 0 ? at + 1 : levels.length, 0, LEAK_LEVEL);
  if (!levels.some((l) => l.id === "sandbox")) levels.push(SANDBOX_LEVEL); // chapter 9, last
  sandboxView.setLimits(infoData.sandbox?.limits ?? infoData.sandbox);
  for (const lvl of levels) {
    levelsById[lvl.id] = lvl;
    const opt = document.createElement("option");
    opt.value = lvl.id;
    opt.textContent = tOr(`level.${lvl.id}.title`, lvl.title);
    els.levelSelect.appendChild(opt);
  }
  els.levelSelect.addEventListener("change", () => selectLevel(els.levelSelect.value));
  els.runBtn.addEventListener("click", run);
  selectLevel(levels[0].id, { focus: false }); // keep the opening view of the network
  setState("ready");

  leak = createLeakView(els.leakView, {
    run: (level, params) => bridge.runLevel(level, params, { onTick: (secs) => setState("running", secs) }),
    requestMeasure: runLeak,
  });
  leak.hide();
  els.regionBtn.addEventListener("click", () => {
    scene?.toggleRegion();
    syncRegionBtn();
  });
  tour = createTour(els.tour, {});
  els.tourBtn.addEventListener("click", () => tour.open(els.tourBtn));

  requestAnimationFrame(() =>
    setTimeout(() => {
      hideLoader();
      tour.open(els.tourBtn); // dismissible intro; the autorun below keeps going behind it
    }, 350),
  );
  // One click -> results: the first level runs by itself with its defaults, on every backend.
  run({ auto: true }).catch((err) => {
    console.error(err);
    setState("failed");
  });

  // Harmless diagnostics hook (console / tests).
  window.__ETA__ = {
    cities: scene ? Object.keys(scene.cities) : [],
    links: scene ? Object.keys(scene.links) : [],
    run,
    get shown() {
      return shown;
    },
  };
}

try {
  await boot();
} catch (err) {
  console.error(err);
  hideLoader();
  setState("failed");
  showFatal(`Startup failed: ${err?.message ?? err}`);
}

// Keep the Qollab run alive so clicks can still reach IonQ (Stop ends it). Must stay the LAST line.
await new Promise(() => {});
