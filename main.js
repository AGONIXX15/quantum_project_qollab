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
import { buildParamsForm, readParams, renderResult, linkStatusCard } from "./ui/panel.js";
import { hasExplain, explainTitle, explainBefore, explainAfter, cityTooltip } from "./ui/explain.js";
import { t, tOr, getLang, setLang, onLangChange, applyI18n } from "./ui/i18n.js";

const $ = (id) => document.getElementById(id);
const els = {
  scene: $("scene-container"),
  labels: $("labels"),
  loader: $("loader"),
  tooltip: $("tooltip"),
  levelSelect: $("level-select"),
  levelSummary: $("level-summary"),
  params: $("params"),
  runBtn: $("run-btn"),
  runStatus: $("run-status"),
  runStatusText: $("run-status-text"),
  runSecs: $("run-secs"),
  results: $("results"),
  explainer: $("explainer"),
  backendBadge: $("backend-badge"),
  legend: $("legend"),
  legendToggle: $("legend-toggle"),
  legendArrow: $("legend-arrow"),
  langBtn: $("lang-btn"),
  cityList: $("city-list"),
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
let scene = null;
let levelsById = {};
let shown = null; // { levelId, result } currently rendered
let selectedCity = null;
let status = { state: "ready", secs: 0 };

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
const STATE_ICON = { ready: "○", running: "⏳", success: "✔", failed: "✖", recorded: "▣" };

function renderStatus() {
  const { state, secs } = status;
  els.runStatus.dataset.state = state;
  els.runStatusText.textContent = `${STATE_ICON[state]} ${t(`status.${state}`)}`;
  // The elapsed-seconds counter is visual only (aria-hidden): no announcement every second.
  els.runSecs.textContent = state === "running" ? ` · ${secs} s` : "";
}

function setState(state, secs = 0) {
  status = { state, secs };
  renderStatus();
  const busy = state === "running";
  els.runBtn.disabled = busy;
  els.levelSelect.disabled = busy;
  els.results.setAttribute("aria-busy", String(busy));
}

// --- language ----------------------------------------------------------------
function refreshLevelTexts() {
  const lvl = levelsById[els.levelSelect.value];
  for (const opt of els.levelSelect.options) {
    const l = levelsById[opt.value];
    opt.textContent = tOr(`level.${opt.value}.title`, l?.title ?? opt.value);
  }
  els.levelSummary.textContent = lvl ? tOr(`level.${lvl.id}.summary`, lvl.summary || "") : "";
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
});

// --- explainer ---------------------------------------------------------------
function renderExplainer(levelId, result) {
  els.explainer.replaceChildren();
  if (!hasExplain(levelId)) return;
  const title = document.createElement("p");
  title.className = "explainer__title";
  title.textContent = `${t("ex.prefix")} · ${explainTitle(levelId)}`;
  const body = document.createElement("div");
  body.className = "explainer__body";
  body.innerHTML = explainBefore(levelId); // our own dictionary markup
  if (result) {
    const line = explainAfter(levelId, result);
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
}

// --- cities (keyboard access in addition to 3D hover) ------------------------
function cityRows(data) {
  const info = cityTooltip(data);
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
  }
}

// --- levels / run --------------------------------------------------------------
function selectLevel(id) {
  const lvl = levelsById[id];
  if (!lvl) return;
  refreshLevelTexts();
  buildParamsForm(els.params, lvl, { ionq: /ionq/i.test(bridge.backendName()) });
  applyI18n(els.params);
  shown = null;
  els.results.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "results__empty";
  empty.dataset.i18n = "results.empty";
  empty.textContent = t("results.empty");
  els.results.appendChild(empty);
  renderExplainer(id, null);
  const linkId = LEVEL_LINK[id];
  if (linkId && scene) scene.focusLink(linkId);
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

async function run() {
  const levelId = els.levelSelect.value;
  if (!levelsById[levelId]) return;
  const params = readParams(els.params);
  setState("running", 0);
  // Local simulators block the main thread: paint "Running" before Python starts.
  await nextFrame();
  let result;
  try {
    result = await bridge.runLevel(levelId, params, {
      onState: (s) => (s === "running" ? setState("running", status.secs) : setState(s)),
      onTick: (secs) => setState("running", secs),
    });
  } catch (err) {
    result = { ok: false, error: String(err?.message ?? err) };
  }
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
  shown = { levelId, result };
  renderShown();
}

// What to draw: the result, or the recorded fallback of a failed call.
function visibleResult(result) {
  return result?.ok === false ? (result.fallback?.result ?? null) : result;
}

// Text panels only (results, link-status card, explainer): safe to redo on a language change.
function renderShownText() {
  const { levelId, result } = shown;
  renderResult(els.results, result);
  const vis = visibleResult(result);
  const ls = linkStatusOf(levelId, vis);
  if (ls) els.results.appendChild(linkStatusCard(ls));
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
  box.textContent = `✖ ${message}`;
  els.results.appendChild(box);
}

// --- boot ----------------------------------------------------------------------
async function boot() {
  applyI18n(document);
  renderBackendBadge();
  setState("ready");
  els.runBtn.disabled = true;

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

  for (const lvl of infoData.levels) {
    levelsById[lvl.id] = lvl;
    const opt = document.createElement("option");
    opt.value = lvl.id;
    opt.textContent = tOr(`level.${lvl.id}.title`, lvl.title);
    els.levelSelect.appendChild(opt);
  }
  els.levelSelect.addEventListener("change", () => selectLevel(els.levelSelect.value));
  els.runBtn.addEventListener("click", run);
  selectLevel(infoData.levels[0].id);
  setState("ready");

  requestAnimationFrame(() => setTimeout(hideLoader, 350));

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
