/*
  Chapter 9 "Build your own network": a free sandbox on the current map region.

  This module owns the editable graph (nodes, links, route endpoints, shots) and its form in the
  left panel. It never talks to Python: main.js reads graph() / validate() and calls the bridge.
  The 3D map stays visible; every edit redraws the sandbox objects with scene.setSandbox().

  Keyboard: everything works with the selects, number inputs and buttons (map clicks are an
  optional extra). Messages go to an aria-live region; icons are never the only signal.
  Limits mirror the Python side (api.info().sandbox): <= 12 nodes, <= 20 links, F in [0.5, 1].
  Names and coordinates may come from the backend: they are only inserted with textContent.
*/

import { t } from "./i18n.js";
import { setIconText } from "./icons.js";
import { BBOX, haversineKm, elevationM } from "./terrain.js";

export const DEFAULT_LIMITS = { nodes: 12, links: 20, fMin: 0.5, fMax: 1, shotsMin: 100, shotsMax: 5000, shotsDefault: 1000 };

// Used when api.sandbox_presets() is unavailable (same ids as the Python presets where they exist).
export const BUILTIN_PRESETS = [
  { id: "BOG", name: "Bogotá", lat: 4.711, lon: -74.072, country: "Colombia" },
  { id: "MED", name: "Medellín", lat: 6.244, lon: -75.581, country: "Colombia" },
  { id: "CAL", name: "Cali", lat: 3.452, lon: -76.532, country: "Colombia" },
  { id: "CTG", name: "Cartagena", lat: 10.391, lon: -75.479, country: "Colombia" },
  { id: "BAQ", name: "Barranquilla", lat: 10.964, lon: -74.796, country: "Colombia" },
  { id: "UIO", name: "Quito", lat: -0.18, lon: -78.468, country: "Ecuador" },
  { id: "GYE", name: "Guayaquil", lat: -2.17, lon: -79.922, country: "Ecuador" },
  { id: "CCS", name: "Caracas", lat: 10.481, lon: -66.904, country: "Venezuela" },
  { id: "MAR", name: "Maracaibo", lat: 10.654, lon: -71.64, country: "Venezuela" },
  { id: "PTY", name: "Panamá", lat: 8.983, lon: -79.517, country: "Panama" },
  { id: "SJO", name: "San José", lat: 9.928, lon: -84.091, country: "Costa Rica" },
  { id: "MGA", name: "Managua", lat: 12.136, lon: -86.251, country: "Nicaragua" },
];

const DEMO_NODES = ["BOG", "MED", "CAL", "UIO", "CCS", "PTY"];
const DEMO_LINKS = [
  ["BOG", "MED", 0.97], ["BOG", "CAL", 0.96], ["MED", "PTY", 0.95], ["CAL", "UIO", 0.94],
  ["UIO", "BOG", 0.92], ["BOG", "CCS", 0.93], ["PTY", "CCS", 0.9],
];
const DEMO_SRC = "CAL";
const DEMO_DST = "CCS";

const FIBRE_FACTOR = 1.3; // information only: the backend computes the real length
const MARGIN_DEG = 0.4; // keep map points away from the faded edge of the terrain

const safeId = (s) => String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 12) || "N";
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const fibreKm = (a, b) => haversineKm(a.lat, a.lon, b.lat, b.lon) * FIBRE_FACTOR;
const fmtKm = (km) => Math.round(km).toLocaleString("en-US");

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

// Pure helpers (exported for tests / reuse).
export function connected(links, src, dst) {
  const adj = new Map();
  for (const l of links) {
    if (!adj.has(l.a)) adj.set(l.a, []);
    if (!adj.has(l.b)) adj.set(l.b, []);
    adj.get(l.a).push(l.b);
    adj.get(l.b).push(l.a);
  }
  const seen = new Set([src]);
  const queue = [src];
  while (queue.length) {
    const n = queue.shift();
    if (n === dst) return true;
    for (const m of adj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); queue.push(m); }
  }
  return false;
}

// Validates a map point: { ok:true } or { ok:false, key } (i18n key under sandbox.msg.*).
export function checkPoint(lat, lon, elevation) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, key: "sandbox.msg.bad_coords" };
  if (lat < BBOX.south + MARGIN_DEG || lat > BBOX.north - MARGIN_DEG || lon < BBOX.west + MARGIN_DEG || lon > BBOX.east - MARGIN_DEG) {
    return { ok: false, key: "sandbox.msg.outside" };
  }
  const h = Number.isFinite(elevation) ? elevation : elevationM(lat, lon);
  if (h < 1) return { ok: false, key: "sandbox.msg.sea" };
  return { ok: true };
}

export function createSandboxView(container, { getScene, onChange, onNotice } = {}) {
  let limits = { ...DEFAULT_LIMITS };
  let presets = BUILTIN_PRESETS.map((p) => ({ ...p }));
  let busy = false;
  let busyKey = null;
  let mounted = false;
  let msg = null; // { key, vars, kind }
  let edited = false; // the user changed the graph: a late Python example must not overwrite it
  const coordBad = { lat: false, lon: false };
  const draft = { city: "", from: "", to: "", F: 0.95, lat: "", lon: "", shots: null };

  const state = { nodes: [], links: [], src: null, dst: null, pick: false };
  const byId = (id) => state.nodes.find((n) => n.id === id);

  function resetDemo() {
    state.nodes = DEMO_NODES.map((id) => {
      const p = BUILTIN_PRESETS.find((x) => x.id === id);
      return { id: p.id, name: p.name, lat: p.lat, lon: p.lon };
    });
    state.links = DEMO_LINKS.map(([a, b, F]) => ({ a, b, F }));
    state.src = DEMO_SRC;
    state.dst = DEMO_DST;
  }
  resetDemo();

  // --- state changes ---------------------------------------------------------
  function setMsg(key, vars = {}, kind = "info") {
    msg = key ? { key, vars, kind } : null;
    paintMsg();
    if (key && kind === "error") onNotice?.();
  }

  function fixEndpoints() {
    if (!byId(state.src)) state.src = state.nodes[0]?.id ?? null;
    if (!byId(state.dst) || state.dst === state.src) state.dst = state.nodes.find((n) => n.id !== state.src)?.id ?? null;
  }

  function changed({ rerender = true, user = true } = {}) {
    if (user) edited = true;
    fixEndpoints();
    getScene?.()?.setSandbox(state.nodes, state.links);
    onChange?.();
    if (rerender) render();
  }

  function addNode(node) {
    if (state.nodes.length >= limits.nodes) return setMsg("sandbox.msg.max_nodes", { max: limits.nodes }, "error"), false;
    if (byId(node.id)) return setMsg("sandbox.msg.dup_city", { name: node.name }, "error"), false;
    state.nodes.push({ id: node.id, name: node.name, lat: round(node.lat, 4), lon: round(node.lon, 4) });
    setMsg("sandbox.msg.added", { name: node.name });
    changed();
    return true;
  }

  function removeNode(id) {
    const n = byId(id);
    if (!n) return;
    state.nodes = state.nodes.filter((x) => x.id !== id);
    state.links = state.links.filter((l) => l.a !== id && l.b !== id);
    setMsg("sandbox.msg.removed", { name: n.name });
    changed();
  }

  function addLink(a, b, F) {
    if (state.nodes.length < 2) return setMsg("sandbox.msg.need_nodes", {}, "error"), false;
    if (!a || !b || a === b) return setMsg("sandbox.msg.link_same", {}, "error"), false;
    if (state.links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))) return setMsg("sandbox.msg.link_dup", {}, "error"), false;
    if (state.links.length >= limits.links) return setMsg("sandbox.msg.max_links", { max: limits.links }, "error"), false;
    if (!(F >= limits.fMin && F <= limits.fMax)) return setMsg("sandbox.msg.bad_F", { fmin: limits.fMin.toFixed(2), fmax: limits.fMax.toFixed(2) }, "error"), false;
    state.links.push({ a, b, F: round(F, 3) });
    setMsg("sandbox.msg.link_added", { a: byId(a).name, b: byId(b).name, F: F.toFixed(2) });
    changed();
    return true;
  }

  function removeLink(a, b) {
    state.links = state.links.filter((l) => !(l.a === a && l.b === b));
    setMsg("sandbox.msg.link_removed", { name: `${byId(a)?.name ?? a} — ${byId(b)?.name ?? b}` });
    changed();
  }

  function nextPointId() {
    for (let n = 1; n < 100; n++) if (!byId(`P${n}`)) return { id: `P${n}`, n };
    return { id: `P${Date.now() % 1e6}`, n: 0 };
  }

  function addPoint(lat, lon, elevation) {
    const ok = checkPoint(lat, lon, elevation);
    if (!ok.ok) return setMsg(ok.key, {}, "error"), false;
    const { id, n } = nextPointId();
    return addNode({ id, name: t("sandbox.point_name", { n }), lat, lon });
  }

  function setPick(on) {
    state.pick = !!on;
    getScene?.()?.setPickMode(state.pick, state.pick ? onMapClick : null);
    setMsg(state.pick ? "sandbox.pick.waiting" : "sandbox.pick.off");
    const btn = container.querySelector('[data-sb="pick"]');
    if (btn) btn.setAttribute("aria-pressed", String(state.pick));
  }

  function onMapClick(p) {
    if (busy) return;
    if (!p) return setMsg("sandbox.msg.outside", {}, "error");
    addPoint(p.lat, p.lon, p.elevation_m);
  }

  // --- validation / graph for the backend --------------------------------------
  function shotsValue() {
    return draft.shots ?? limits.shotsDefault;
  }

  function graph() {
    return {
      nodes: state.nodes.map((n) => ({ id: n.id, name: n.name, lat: n.lat, lon: n.lon })),
      links: state.links.map((l) => ({ a: l.a, b: l.b, F: l.F })),
      src: state.src,
      dst: state.dst,
    };
  }

  // { ok:true, graph, shots } or { ok:false, key, vars } (nothing is sent in that case).
  function validate() {
    if (state.nodes.length < 2 || state.links.length < 1) return { ok: false, key: "sandbox.msg.too_few", vars: {} };
    if (!state.src || !state.dst || state.src === state.dst) return { ok: false, key: "sandbox.msg.need_route", vars: {} };
    if (!connected(state.links, state.src, state.dst)) {
      return { ok: false, key: "sandbox.msg.noroute", vars: { src: byId(state.src).name, dst: byId(state.dst).name } };
    }
    const shots = Math.round(Number(shotsValue()));
    if (!(shots >= limits.shotsMin && shots <= limits.shotsMax)) {
      return { ok: false, key: "sandbox.msg.shots", vars: { min: limits.shotsMin, max: limits.shotsMax } };
    }
    return { ok: true, graph: graph(), shots };
  }

  // --- form -----------------------------------------------------------------------
  let msgEl = null;
  let liveEl = null;
  function ensureLive() {
    if (liveEl) return;
    liveEl = el("p", "sr-only");
    liveEl.setAttribute("role", "status");
    liveEl.setAttribute("aria-live", "polite");
    container.after(liveEl); // outside the re-rendered fieldset
  }
  function paintMsg() {
    ensureLive();
    if (!msgEl) return;
    const text = msg ? t(msg.key, msg.vars) : "";
    if (liveEl && liveEl.textContent !== text) liveEl.textContent = text; // ONE persistent region, only its text changes
    msgEl.className = "sb__msg" + (msg?.kind === "error" ? " sb__msg--error" : "");
    if (!msg) return void msgEl.replaceChildren();
    setIconText(msgEl, msg.kind === "error" ? "warn" : "info", t(msg.key, msg.vars), 13);
  }

  function nodeSelect(label, key, value, { onChange: cb, dataSb } = {}) {
    const field = el("label", "field");
    field.appendChild(el("span", "field__label", label));
    const sel = document.createElement("select");
    sel.dataset.sb = dataSb ?? key;
    for (const n of state.nodes) {
      const o = el("option", null, n.name);
      o.value = n.id;
      if (n.id === value) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => cb(sel.value));
    field.appendChild(sel);
    return field;
  }

  function section(titleKey, vars) {
    const g = el("div", "sb__group");
    g.appendChild(el("h3", "field__label field__label--heading", t(titleKey, vars)));
    return g;
  }

  function buildCityGroup() {
    const g = section("sandbox.city.title");
    const have = new Set(state.nodes.map((n) => n.id));
    const free = presets.filter((p) => !have.has(p.id));
    const row = el("div", "sb__row");
    const field = el("label", "field sb__grow");
    field.appendChild(el("span", "field__label", t("sandbox.city.select")));
    const sel = document.createElement("select");
    sel.dataset.sb = "city";
    for (const p of presets) {
      const o = el("option", null, p.country ? `${p.name} (${p.country})` : p.name);
      o.value = p.id;
      o.disabled = have.has(p.id);
      sel.appendChild(o);
    }
    if (!free.some((p) => p.id === draft.city)) draft.city = free[0]?.id ?? "";
    sel.value = draft.city;
    sel.disabled = free.length === 0;
    sel.addEventListener("change", () => { draft.city = sel.value; });
    field.appendChild(sel);
    const add = el("button", "btn btn--small", t("sandbox.add"));
    add.type = "button";
    add.dataset.sb = "add-city";
    add.disabled = free.length === 0;
    add.addEventListener("click", () => {
      const p = presets.find((x) => x.id === draft.city);
      if (p) addNode(p);
    });
    row.append(field, add);
    g.appendChild(row);
    return g;
  }

  // aria-invalid on the offending lat/lon inputs (message linked through aria-describedby="sb-msg").
  function markCoords() {
    const lat = draft.lat === "" ? NaN : Number(draft.lat), lon = draft.lon === "" ? NaN : Number(draft.lon);
    const bad = {
      lat: !Number.isFinite(lat) || lat < BBOX.south + MARGIN_DEG || lat > BBOX.north - MARGIN_DEG,
      lon: !Number.isFinite(lon) || lon < BBOX.west + MARGIN_DEG || lon > BBOX.east - MARGIN_DEG,
    };
    if (!bad.lat && !bad.lon && Number.isFinite(lat) && Number.isFinite(lon) && !checkPoint(lat, lon).ok) bad.lat = bad.lon = true; // e.g. sea
    for (const k of ["lat", "lon"]) {
      coordBad[k] = bad[k];
      const inp = container.querySelector(`[data-sb="${k}"]`);
      if (inp) bad[k] ? inp.setAttribute("aria-invalid", "true") : inp.removeAttribute("aria-invalid");
    }
  }

  function buildPointGroup() {
    const g = el("div", "sb__group");
    const pick = el("button", "btn btn--small sb__toggle", t("sandbox.pick"));
    pick.type = "button";
    pick.dataset.sb = "pick";
    pick.setAttribute("aria-pressed", String(state.pick));
    pick.addEventListener("click", () => setPick(!state.pick));
    g.append(pick, el("p", "field__note", t("sandbox.pick.hint")));

    const d = el("details", "sb__details");
    d.appendChild(el("summary", null, t("sandbox.coords")));
    const row = el("div", "sb__row");
    const mk = (label, key, ph) => {
      const f = el("label", "field sb__grow");
      f.appendChild(el("span", "field__label", label));
      const i = document.createElement("input");
      i.type = "number";
      i.step = "0.001";
      i.inputMode = "decimal";
      i.placeholder = ph;
      i.value = draft[key];
      i.dataset.sb = key;
      i.min = String(key === "lat" ? BBOX.south + MARGIN_DEG : BBOX.west + MARGIN_DEG);
      i.max = String(key === "lat" ? BBOX.north - MARGIN_DEG : BBOX.east - MARGIN_DEG);
      i.setAttribute("aria-describedby", "sb-msg");
      if (coordBad[key]) i.setAttribute("aria-invalid", "true");
      i.addEventListener("input", () => {
        draft[key] = i.value;
        coordBad[key] = false;
        i.removeAttribute("aria-invalid");
      });
      f.appendChild(i);
      return f;
    };
    row.append(mk(t("sandbox.lat"), "lat", "4.711"), mk(t("sandbox.lon"), "lon", "-74.072"));
    const add = el("button", "btn btn--small", t("sandbox.add_point"));
    add.type = "button";
    add.dataset.sb = "add-point";
    add.addEventListener("click", () => {
      markCoords();
      if (draft.lat === "" || draft.lon === "") return setMsg("sandbox.msg.bad_coords", {}, "error");
      addPoint(Number(draft.lat), Number(draft.lon));
    });
    d.append(row, add);
    g.appendChild(d);
    return g;
  }

  function buildNodeList() {
    const g = section("sandbox.nodes", { n: state.nodes.length, max: limits.nodes });
    if (!state.nodes.length) {
      g.appendChild(el("p", "field__note", t("sandbox.nodes.empty")));
      return g;
    }
    const ul = el("ul", "sb__list");
    for (const n of state.nodes) {
      const li = el("li", "sb__item");
      const txt = el("span", "sb__item-text");
      txt.append(el("span", "sb__item-name", n.name), el("span", "sb__item-sub", t("sandbox.node.coords", { lat: n.lat.toFixed(2), lon: n.lon.toFixed(2) })));
      const rm = el("button", "btn btn--small sb__rm", t("sandbox.remove"));
      rm.type = "button";
      rm.setAttribute("aria-label", t("sandbox.remove_node", { name: n.name }));
      rm.dataset.sb = `rm-node-${n.id}`;
      rm.addEventListener("click", () => removeNode(n.id));
      li.append(txt, rm);
      ul.appendChild(li);
    }
    g.appendChild(ul);
    return g;
  }

  function buildLinkBuilder() {
    const g = section("sandbox.links", { n: state.links.length, max: limits.links });
    if (!byId(draft.from)) draft.from = state.nodes[0]?.id ?? "";
    if (!byId(draft.to) || draft.to === draft.from) draft.to = state.nodes.find((n) => n.id !== draft.from)?.id ?? "";
    const note = el("p", "field__note sb__km");
    const paintKm = () => {
      const a = byId(draft.from), b = byId(draft.to);
      note.textContent = a && b && a !== b ? t("sandbox.link.km", { km: fmtKm(fibreKm(a, b)) }) : "";
    };
    const fromSel = nodeSelect(t("sandbox.from"), "from", draft.from, { onChange: (v) => { draft.from = v; paintKm(); } });
    const toSel = nodeSelect(t("sandbox.to"), "to", draft.to, { onChange: (v) => { draft.to = v; paintKm(); } });
    const row = el("div", "sb__row");
    fromSel.classList.add("sb__grow");
    toSel.classList.add("sb__grow");
    row.append(fromSel, toSel);

    const fField = el("label", "field");
    fField.appendChild(el("span", "field__label", t("sandbox.F")));
    const frow = el("div", "field__row");
    const range = document.createElement("input");
    range.type = "range";
    range.min = limits.fMin;
    range.max = limits.fMax;
    range.step = 0.01;
    range.value = Math.min(limits.fMax, Math.max(limits.fMin, draft.F));
    range.dataset.sb = "F";
    const out = el("output", "field__value", Number(range.value).toFixed(2));
    range.addEventListener("input", () => {
      draft.F = parseFloat(range.value);
      out.textContent = draft.F.toFixed(2);
    });
    frow.append(range, out);
    fField.appendChild(frow);

    const add = el("button", "btn btn--small", t("sandbox.add_link"));
    add.type = "button";
    add.dataset.sb = "add-link";
    add.addEventListener("click", () => addLink(draft.from, draft.to, draft.F));
    paintKm();
    g.append(row, fField, note, add);

    if (!state.links.length) {
      g.appendChild(el("p", "field__note", t("sandbox.links.empty")));
      return g;
    }
    const ul = el("ul", "sb__list");
    for (const l of state.links) {
      const a = byId(l.a), b = byId(l.b);
      if (!a || !b) continue;
      const li = el("li", "sb__item");
      const label = t("sandbox.link.item", { a: a.name, b: b.name, F: l.F.toFixed(2), km: fmtKm(fibreKm(a, b)) });
      const rm = el("button", "btn btn--small sb__rm", t("sandbox.remove"));
      rm.type = "button";
      rm.setAttribute("aria-label", t("sandbox.remove_link", { name: `${a.name} — ${b.name}` }));
      rm.dataset.sb = `rm-link-${l.a}-${l.b}`;
      rm.addEventListener("click", () => removeLink(l.a, l.b));
      li.append(el("span", "sb__item-text", label), rm);
      ul.appendChild(li);
    }
    g.appendChild(ul);
    return g;
  }

  function buildRouteGroup() {
    const g = section("sandbox.route");
    const row = el("div", "sb__row");
    const src = nodeSelect(t("sandbox.src"), "src", state.src, { onChange: (v) => { state.src = v; onChange?.(); } });
    const dst = nodeSelect(t("sandbox.dst"), "dst", state.dst, { onChange: (v) => { state.dst = v; onChange?.(); } });
    src.classList.add("sb__grow");
    dst.classList.add("sb__grow");
    row.append(src, dst);
    g.appendChild(row);

    const sf = el("label", "field");
    sf.appendChild(el("span", "field__label", t("sandbox.shots")));
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = limits.shotsMin;
    inp.max = limits.shotsMax;
    inp.step = 100;
    inp.value = shotsValue();
    inp.dataset.sb = "shots";
    inp.addEventListener("input", () => { draft.shots = inp.value === "" ? null : Number(inp.value); });
    sf.appendChild(inp);
    g.append(sf, el("p", "field__note", t("sandbox.limits", {
      nodes: limits.nodes, links: limits.links, fmin: limits.fMin.toFixed(2), fmax: limits.fMax.toFixed(2),
    })));
    return g;
  }

  function render() {
    if (!mounted) return;
    const focusKey = container.contains(document.activeElement) ? document.activeElement?.dataset?.sb : null;
    const fs = document.createElement("fieldset");
    fs.className = "sb";
    fs.disabled = busy;
    fs.setAttribute("aria-label", t("sandbox.aria"));
    fs.append(buildCityGroup(), buildPointGroup(), buildNodeList(), buildLinkBuilder(), buildRouteGroup());
    msgEl = el("p", "sb__msg");
    msgEl.id = "sb-msg"; // referenced by the lat/lon inputs; announcements go through the persistent live region
    fs.appendChild(msgEl);
    container.replaceChildren(fs);
    paintMsg();
    if (focusKey) {
      const target = container.querySelector(`[data-sb="${CSS.escape(focusKey)}"]`);
      (target && !target.disabled ? target : container.querySelector('[data-sb="city"]'))?.focus({ preventScroll: true });
    }
  }

  return {
    mount() {
      mounted = true;
      render();
      changed({ rerender: false, user: false });
    },
    // Called when another chapter is selected.
    unmount() {
      mounted = false;
      if (state.pick) {
        state.pick = false;
        getScene?.()?.setPickMode(false);
      }
      msg = null;
      msgEl = null;
      if (liveEl) liveEl.textContent = "";
    },
    render,
    graph,
    validate,
    notice(key, vars, kind = "error") {
      setMsg(key, vars, kind);
    },
    nameOf: (id) => byId(id)?.name ?? id,
    names: () => Object.fromEntries(state.nodes.map((n) => [n.id, n.name])),
    setBusy(b) {
      busy = !!b;
      const fs = container.querySelector("fieldset.sb");
      if (!fs) return;
      // A disabled fieldset drops the focus to <body>: remember the control and give it back afterwards.
      if (busy) busyKey = container.contains(document.activeElement) ? document.activeElement?.dataset?.sb ?? null : null;
      fs.disabled = busy;
      if (!busy && busyKey) {
        const a = document.activeElement;
        if (!a || a === document.body) container.querySelector(`[data-sb="${CSS.escape(busyKey)}"]`)?.focus({ preventScroll: true });
        busyKey = null;
      }
    },
    // Limits from api.info().sandbox (field names read defensively; defaults mirror the Python side).
    setLimits(l) {
      if (!l || typeof l !== "object") return;
      const num = (...vals) => vals.find((v) => typeof v === "number" && Number.isFinite(v));
      limits = {
        nodes: num(l.max_nodes, l.nodes, DEFAULT_LIMITS.nodes),
        links: num(l.max_links, l.links, DEFAULT_LIMITS.links),
        fMin: num(l.F_min, l.f_min, l.min_F, DEFAULT_LIMITS.fMin),
        fMax: num(l.F_max, l.f_max, l.max_F, DEFAULT_LIMITS.fMax),
        shotsMin: num(l.min_shots, l.shots_min, DEFAULT_LIMITS.shotsMin),
        shotsMax: num(l.max_shots, l.shots_max, DEFAULT_LIMITS.shotsMax),
        shotsDefault: num(l.default_shots, l.shots_default, DEFAULT_LIMITS.shotsDefault),
      };
    },
    setDefaultShots(n) {
      if (draft.shots == null) limits = { ...limits, shotsDefault: n };
    },
    // Demo graph from api.sandbox_presets().example ({nodes:[ids], links:[{a,b,F}], src, dst}).
    setExample(ex) {
      if (edited || !ex || !Array.isArray(ex.nodes) || !Array.isArray(ex.links)) return;
      const nodes = ex.nodes.map((id) => presets.find((p) => p.id === safeId(id))).filter(Boolean);
      if (nodes.length !== ex.nodes.length || nodes.length < 2) return;
      state.nodes = nodes.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon }));
      state.links = ex.links.filter((l) => byId(safeId(l.a)) && byId(safeId(l.b)) && Number.isFinite(l.F)).map((l) => ({ a: safeId(l.a), b: safeId(l.b), F: l.F }));
      state.src = safeId(ex.src);
      state.dst = safeId(ex.dst);
      changed({ rerender: mounted, user: false });
    },
    setPresets(list) {
      const clean = [];
      for (const p of list ?? []) {
        if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
        const id = safeId(p.id);
        if (clean.some((c) => c.id === id)) continue;
        clean.push({ id, name: String(p.name ?? id), lat: p.lat, lon: p.lon, country: p.country ? String(p.country) : "" });
      }
      if (clean.length) presets = clean;
      render();
    },
    reset() {
      resetDemo();
      edited = false;
      changed({ rerender: mounted, user: false });
    },
    get state() {
      return state;
    },
  };
}

// --- results: route card + alternatives + "what ran" ------------------------------------
function etaText(v) {
  return typeof v === "number" && Number.isFinite(v) ? v.toExponential(2) : "—";
}

const metricNum = (m) => (typeof m === "number" ? m : m?.value);

// DOM fragment shown right under the result meta line. `names` maps node id -> display name.
export function sandboxResultCards(result, names = {}) {
  const frag = document.createDocumentFragment();
  const nm = (id) => names[id] ?? id;
  const route = Array.isArray(result?.route) ? result.route : [];
  if (route.length) {
    const hops = Array.isArray(result.hops) ? result.hops : [];
    const km = hops.reduce((s, h) => s + (Number(h.length_km) || 0), 0);
    const nHops = hops.length || Math.max(0, route.length - 1);
    const card = el("div", "metric sandbox-route");
    card.setAttribute("role", "group");
    card.appendChild(el("div", "metric__name", t("sandbox.res.title")));
    card.appendChild(el("div", "metric__detail--text sandbox-route__line", t(nHops === 1 ? "sandbox.res.route_1" : "sandbox.res.route", {
      route: route.map(nm).join(" → "), hops: nHops, km: fmtKm(km), eta: etaText(metricNum(result.metrics?.eta_route)),
    })));
    card.appendChild(el("p", "metric__detail--text sandbox-route__explain", t("sandbox.res.explain", { shots: result.shots ?? "?" })));
    if (result.route_limited) card.appendChild(el("p", "metric__detail--text", t("sandbox.res.limited")));
    frag.appendChild(card);
  }
  const alts = Array.isArray(result?.alternatives) ? result.alternatives : [];
  if (alts.length) {
    frag.appendChild(el("h3", "results__heading", t("sandbox.res.alts")));
    const ol = el("ol", "notes sandbox-alts");
    for (const a of alts) {
      const r = Array.isArray(a.route) ? a.route : [];
      const n = a.hops ?? Math.max(0, r.length - 1);
      ol.appendChild(el("li", null, t(n === 1 ? "sandbox.res.alt_1" : "sandbox.res.alt", {
        route: r.map(nm).join(" → "), hops: n, F: typeof (a.F_theory ?? a.theory_F) === "number" ? (a.F_theory ?? a.theory_F).toFixed(3) : "—", eta: etaText(a.eta),
      })));
    }
    frag.appendChild(ol);
  }
  return frag;
}

// Deterministic parity samples for the photons of one hop: share of "different" results
// = 2(1-F)/3 (Werner ZZ error). Purely illustrative when the backend sends no samples.
export function parityFromF(F, n = 16) {
  const q = (2 * (1 - F)) / 3;
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.floor((i + 1) * q + 0.5) > Math.floor(i * q + 0.5) ? 1 : 0);
  return out;
}
