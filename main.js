/*
  Entangle the Andes - orquestador de la UI.

  Flujo:
    1. createClient() decide Qollab (backend real) o local (mock).
    2. info() da niveles, parámetros y geografía.
    3. La escena 3D se construye desde la geografía (terreno de Colombia + red).
    4. Selector + formulario para elegir nivel y parámetros.
    5. "Ejecutar" llama al nivel, pinta métricas y actualiza la escena 3D.
    6. Capa educativa: explainer por nivel, leyenda y tooltips.

  Idéntico en local y en Qollab: la diferencia vive en ui/api-bridge.js.
*/

import { createClient } from "./ui/api-bridge.js";
import { NetworkScene } from "./ui/scene.js";
import { buildParamsForm, readParams, renderResult } from "./ui/panel.js";
import { LEVEL_EXPLAIN, cityTooltip } from "./ui/explain.js";

const els = {
  scene: document.getElementById("scene-container"),
  labels: document.getElementById("labels"),
  loader: document.getElementById("loader"),
  tooltip: document.getElementById("tooltip"),
  levelSelect: document.getElementById("level-select"),
  levelSummary: document.getElementById("level-summary"),
  params: document.getElementById("params"),
  runBtn: document.getElementById("run-btn"),
  runStatus: document.getElementById("run-status"),
  results: document.getElementById("results"),
  explainer: document.getElementById("explainer"),
  backendBadge: document.getElementById("backend-badge"),
  legend: document.getElementById("legend"),
  legendToggle: document.getElementById("legend-toggle"),
};

let client;
let infoData;
let scene;
let levelsById = {};
let lastResult = null;

// A qué enlace geográfico asociamos cada nivel por defecto (para animar/enfocar).
const LEVEL_LINK = {
  link: "BOG-MED",
  teleport: "BOG-MED",
  noise: "BOG-MED",
  swap: "BOG-CAL",
  purify: "BOG-CAL",
  qkd: "MED-CAL",
  rescue: "BOG-CAL",
};

async function boot() {
  client = await createClient();
  els.backendBadge.textContent = `backend: ${client.backendName()}`;

  infoData = await client.info();
  if (!infoData || infoData.ok === false) {
    hideLoader();
    els.results.innerHTML = `<div class="results__error">No se pudo cargar info(): ${infoData?.error ?? "desconocido"}</div>`;
    return;
  }

  // Escena 3D desde la geografía real.
  scene = new NetworkScene(els.scene, els.labels);
  scene.buildFromGeo(infoData.geo);
  scene.onHover(onHover);

  // Selector de niveles.
  for (const lvl of infoData.levels) {
    levelsById[lvl.id] = lvl;
    const opt = document.createElement("option");
    opt.value = lvl.id;
    opt.textContent = lvl.title;
    els.levelSelect.appendChild(opt);
  }
  els.levelSelect.addEventListener("change", () => selectLevel(els.levelSelect.value));
  els.runBtn.addEventListener("click", run);
  els.legendToggle.addEventListener("click", toggleLegend);

  selectLevel(infoData.levels[0].id);

  // Dar un frame para que el terreno aparezca y luego quitar el loader.
  requestAnimationFrame(() => setTimeout(hideLoader, 350));

  // Gancho de diagnóstico (inofensivo): permite inspeccionar el estado desde
  // pruebas o la consola del navegador.
  window.__ETA__ = {
    mode: client.mode,
    cities: Object.keys(scene.cities),
    links: Object.keys(scene.links),
    run,
    get lastResult() {
      return lastResult;
    },
  };
}

function selectLevel(id) {
  const lvl = levelsById[id];
  if (!lvl) return;
  els.levelSummary.textContent = lvl.summary || "";
  buildParamsForm(els.params, lvl);
  renderExplainer(id, null);
  const linkId = LEVEL_LINK[id];
  if (linkId && scene) scene.focusLink(linkId);
}

async function run() {
  const id = els.levelSelect.value;
  const lvl = levelsById[id];
  if (!lvl) return;

  const params = readParams(els.params);
  setBusy(true);
  try {
    const result = await client.runLevel(lvl.function, params);
    lastResult = result;
    renderResult(els.results, result);
    renderExplainer(id, result);
    updateScene(id, result);
  } catch (err) {
    renderResult(els.results, { ok: false, error: String(err?.message ?? err) });
  } finally {
    setBusy(false);
  }
}

// Panel "¿Qué estoy viendo?": explicación antes + lectura del resultado.
function renderExplainer(levelId, result) {
  const info = LEVEL_EXPLAIN[levelId];
  if (!info) {
    els.explainer.innerHTML = "";
    return;
  }
  let html = `<p class="explainer__title">¿Qué estoy viendo? · ${info.title}</p>`;
  html += `<div class="explainer__body">${info.before}`;
  if (result && result.ok !== false && typeof info.after === "function") {
    const line = info.after(result);
    if (line) html += `<br><br>${line}`;
  }
  html += `</div>`;
  els.explainer.innerHTML = html;
}

function updateScene(levelId, result) {
  if (!result || result.ok === false || !scene) return;
  const viz = result.viz || {};
  scene.setLinkStates(viz.links);

  const geoLinkIds = Object.keys(scene.links);
  const samples = viz.samples;

  // Caso rescue: samples es un dict por estrategia. Mostramos la estrategia
  // recomendada sobre el enlace roto.
  if (levelId === "rescue" && samples && typeof samples === "object" && viz.broken) {
    const rec = viz.recommendation?.strategy;
    const serie = (rec && samples[rec]) || Object.values(samples)[0];
    if (serie) {
      scene.emitPhotons(viz.broken, serie);
      scene.highlightLink(viz.broken);
      scene.focusLink(viz.broken);
    }
    return;
  }

  if (Array.isArray(samples)) {
    const target = pickTargetLink(levelId, viz) || LEVEL_LINK[levelId] || geoLinkIds[0];
    scene.emitPhotons(target, samples);
    scene.highlightLink(target);
    scene.focusLink(target);
  } else if (samples && typeof samples === "object") {
    // noise: dict por F -> repartir las series entre los enlaces geográficos.
    const series = Object.values(samples);
    geoLinkIds.forEach((lid, i) => {
      if (series[i]) scene.emitPhotons(lid, series[i]);
    });
  }
}

function pickTargetLink(levelId, viz) {
  if (levelId === "rescue" && viz.broken) return viz.broken;
  return null;
}

// Hover sobre una ciudad -> tooltip.
function onHover(hovered) {
  if (!hovered) {
    els.tooltip.hidden = true;
    document.body.style.cursor = "";
    return;
  }
  if (hovered.type === "city") {
    const t = cityTooltip(hovered.data);
    els.tooltip.innerHTML =
      `<div class="tooltip__title">${t.title}</div>` +
      t.rows.map((r) => `<div class="tooltip__row">${r}</div>`).join("");
    els.tooltip.hidden = false;
    els.tooltip.style.left = `${hovered.client.x}px`;
    els.tooltip.style.top = `${hovered.client.y}px`;
    document.body.style.cursor = "pointer";
  }
}

function toggleLegend() {
  const collapsed = els.legend.classList.toggle("collapsed");
  els.legendToggle.setAttribute("aria-expanded", String(!collapsed));
  els.legendToggle.textContent = collapsed ? "Leyenda ▸" : "Leyenda ▾";
}

function setBusy(busy) {
  els.runBtn.disabled = busy;
  els.runStatus.textContent = busy ? "ejecutando…" : "";
}

function hideLoader() {
  els.loader?.classList.add("hidden");
}

boot().catch((err) => {
  hideLoader();
  els.results.innerHTML = `<div class="results__error">Fallo al iniciar: ${err?.message ?? err}</div>`;
  console.error(err);
});
