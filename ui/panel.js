/*
  Control and results panels (plain DOM, no frameworks).

  The parameter form is built from api.info(). Parameters whose default is null
  (purify F/p, qkd F) are OPTIONAL: they have an explicit "off" state and the key
  is omitted from the call when off. Disabled or hidden controls are never read.
  Purify sends exactly one of gamma / F / p (radio choice); qkd sends F only when
  theta_deg = 0.

  Everything that comes from the backend (backend name, errors, notes, titles,
  explanations) is inserted with textContent, never innerHTML.
*/

import { t, dictionaries } from "./i18n.js";
import { iconEl } from "./icons.js";

const hasKey = (k) => k in dictionaries.en;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

// --- Form ------------------------------------------------------------------

function prettyName(name) {
  const base = name.replace(/_deg$/, " (°)").replace(/_/g, " ");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function labelSpan(name, tag = "span") {
  const s = el(tag, "field__label");
  const key = `param.${name}`;
  if (hasKey(key)) {
    s.dataset.i18n = key;
    s.textContent = t(key);
  } else {
    s.textContent = prettyName(name);
  }
  return s;
}

function chooseStep(min, max) {
  const span = max - min;
  if (span <= 2) return 0.01;
  if (span <= 20) return 0.1;
  return 1;
}

function fmtNum(v, unit) {
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return unit ? `${s} ${unit === "deg" ? "°" : unit}` : s;
}

// Slider + live value. Returns { row, range }.
function sliderRow(name, spec, def) {
  const row = el("div", "field__row");
  const range = document.createElement("input");
  range.type = "range";
  range.min = spec.min;
  range.max = spec.max;
  range.step = chooseStep(spec.min, spec.max);
  range.value = def;
  range.dataset.param = name;
  range.dataset.kind = "num";
  const out = el("span", "field__value", fmtNum(parseFloat(range.value), spec.unit));
  out.setAttribute("aria-hidden", "true");
  range.addEventListener("input", () => {
    out.textContent = fmtNum(parseFloat(range.value), spec.unit);
  });
  row.append(range, out);
  return { row, range };
}

function buildControl(name, spec) {
  const field = el("label", "field");
  field.dataset.field = name;
  field.appendChild(labelSpan(name));

  if (spec && Array.isArray(spec.options)) {
    const sel = document.createElement("select");
    for (const opt of spec.options) {
      const o = el("option", null, opt);
      o.value = opt;
      if (opt === spec.default) o.selected = true;
      sel.appendChild(o);
    }
    sel.dataset.param = name;
    sel.dataset.kind = "choice";
    field.appendChild(sel);
    return field;
  }
  if (spec && typeof spec.default === "boolean") {
    const row = el("div", "field__row");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = spec.default;
    cb.dataset.param = name;
    cb.dataset.kind = "bool";
    row.appendChild(cb);
    field.appendChild(row);
    return field;
  }
  if (spec && Array.isArray(spec.default)) {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = spec.default.join(", ");
    inp.dataset.param = name;
    inp.dataset.kind = "numlist";
    field.appendChild(inp);
    return field;
  }
  if (name === "shots") {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = spec.min;
    inp.max = spec.max;
    inp.step = 10;
    inp.value = spec.default ?? 1000;
    inp.dataset.param = name;
    inp.dataset.kind = "int";
    field.appendChild(inp);
    return field;
  }
  if (spec && spec.min !== undefined && spec.max !== undefined) {
    const def = spec.default ?? (spec.min + spec.max) / 2;
    const { row } = sliderRow(name, spec, def);
    field.appendChild(row);
    return field;
  }
  const inp = document.createElement("input");
  inp.type = "number";
  inp.value = spec?.default ?? 0;
  inp.dataset.param = name;
  inp.dataset.kind = "num";
  field.appendChild(inp);
  return field;
}

// Purify: exactly one of gamma / F / p.
function buildPurifyChannel(params) {
  const group = el("fieldset", "field field--group");
  group.dataset.field = "channel";
  const legend = el("legend", "field__label");
  legend.dataset.i18n = "param.channel";
  legend.textContent = t("param.channel");
  group.appendChild(legend);

  const name = nextId("purify-channel");
  const channels = [
    { id: "gamma", control: () => sliderRow("gamma", params.gamma, params.gamma.default ?? 0.2).row },
    { id: "F", control: () => sliderRow("F", params.F, 0.8).row },
    {
      id: "p",
      control: () => {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.value = "0.85, 0.05, 0.05, 0.05";
        inp.dataset.param = "p";
        inp.dataset.kind = "numlist";
        inp.dataset.i18nAria = "param.p";
        inp.setAttribute("aria-label", t("param.p"));
        return inp;
      },
    },
  ];
  const blocks = {};
  for (const ch of channels) {
    const block = el("div", "channel");
    const row = el("div", "radio-row");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = name;
    radio.value = ch.id;
    radio.id = nextId("ch");
    radio.checked = ch.id === "gamma";
    const lab = el("label", null, t(`param.channel.${ch.id}`));
    lab.htmlFor = radio.id;
    lab.dataset.i18n = `param.channel.${ch.id}`;
    row.append(radio, lab);
    const control = ch.control();
    if (ch.id === "p") control.classList.add("channel__text");
    block.append(row, control);
    group.appendChild(block);
    blocks[ch.id] = { radio, control };
  }
  const note = el("p", "field__note", t("param.precision_note"));
  note.dataset.i18n = "param.precision_note";
  note.hidden = true;
  group.appendChild(note);

  const sync = () => {
    for (const [id, b] of Object.entries(blocks)) {
      const inputs = b.control.matches("input") ? [b.control] : b.control.querySelectorAll("input");
      inputs.forEach((i) => (i.disabled = !b.radio.checked));
    }
  };
  group.addEventListener("change", sync);
  sync();
  group._blocks = blocks;
  group._note = note;
  group._sync = sync;
  return group;
}

// qkd F (Werner noise): optional, only valid with theta_deg = 0.
function buildQkdNoise(params, thetaRange, ionq) {
  const group = el("div", "field field--group");
  group.dataset.field = "F";
  const row = el("div", "radio-row");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.id = nextId("qkd-f");
  const lab = el("label", null, t("param.qkd_F.use"));
  lab.htmlFor = cb.id;
  lab.dataset.i18n = "param.qkd_F.use";
  row.append(cb, lab);
  const { row: srow, range } = sliderRow("F", params.F, 0.8);
  range.setAttribute("aria-label", t("param.F"));
  const note = el("p", "field__note", t("param.qkd_F.note"));
  note.dataset.i18n = "param.qkd_F.note";
  const ionqNote = el("p", "field__note", t("param.qkd_F.ionq"));
  ionqNote.dataset.i18n = "param.qkd_F.ionq";
  ionqNote.hidden = !ionq;
  group.append(row, srow, note, ionqNote);

  const sync = () => {
    const spyOn = parseFloat(thetaRange.value) > 0;
    const off = spyOn || ionq; // F is never sent with a spy, nor on IonQ
    cb.disabled = off;
    if (off) cb.checked = false;
    range.disabled = off || !cb.checked;
    note.hidden = !spyOn;
  };
  cb.addEventListener("change", sync);
  thetaRange.addEventListener("input", sync);
  sync();
  return group;
}

// Rescue: the damage_* fields depend on damage_kind.
function wireRescue(container) {
  const kindSel = container.querySelector('[data-param="damage_kind"]');
  if (!kindSel) return;
  const show = { damage_F: "werner", damage_gamma: "damping", damage_theta_deg: "spy" };
  const sync = () => {
    for (const [field, kind] of Object.entries(show)) {
      const f = container.querySelector(`[data-field="${field}"]`);
      if (f) f.hidden = kindSel.value !== kind;
    }
  };
  kindSel.addEventListener("change", sync);
  sync();
}

export function buildParamsForm(container, levelSpec, { ionq = false } = {}) {
  container.innerHTML = "";
  const params = levelSpec.params || {};
  const id = levelSpec.id;
  let thetaRange = null;
  for (const [name, spec] of Object.entries(params)) {
    if (id === "purify" && (name === "F" || name === "gamma" || name === "p")) continue;
    if (id === "qkd" && name === "F") continue;
    const ctl = buildControl(name, spec);
    container.appendChild(ctl);
    if (name === "theta_deg") thetaRange = ctl.querySelector("input");
  }
  if (id === "purify" && params.gamma && params.F && params.p) {
    const group = buildPurifyChannel(params);
    const modeField = container.querySelector('[data-field="strategy"]');
    container.insertBefore(group, modeField ?? container.firstChild?.nextSibling ?? null);
    const modeSel = container.querySelector('[data-param="mode"]');
    modeSel?.addEventListener("change", () => {
      const precision = modeSel.value === "precision";
      group._blocks.gamma.radio.disabled = precision;
      if (precision && group._blocks.gamma.radio.checked) group._blocks.F.radio.checked = true;
      group._note.hidden = !precision;
      group._sync();
    });
  }
  if (id === "qkd" && params.F && thetaRange) {
    const g = buildQkdNoise(params, thetaRange, ionq);
    container.insertBefore(g, container.querySelector('[data-field="smart_direct"]'));
  }
  if (id === "rescue") wireRescue(container);
}

// Current values as a params object. Disabled / hidden controls are skipped.
export function readParams(formEl) {
  const params = {};
  for (const el_ of formEl.querySelectorAll("[data-param]")) {
    if (el_.disabled || el_.closest("[hidden]")) continue;
    const name = el_.dataset.param;
    switch (el_.dataset.kind) {
      case "num":
        params[name] = parseFloat(el_.value);
        break;
      case "int":
        params[name] = Math.round(parseFloat(el_.value));
        break;
      case "bool":
        params[name] = el_.checked;
        break;
      case "numlist": {
        const list = el_.value.split(",").map((s) => s.trim()).filter((s) => s !== "").map(parseFloat);
        if (list.length) params[name] = list;
        break;
      }
      default:
        params[name] = el_.value;
    }
  }
  return params;
}

// --- Results ----------------------------------------------------------------

function fmtMetric(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v !== "number") return String(v);
  if (Math.abs(v) >= 100) return v.toFixed(1);
  return v.toFixed(3);
}

function metricCard(name, m) {
  const card = el("div", "metric");
  card.appendChild(el("div", "metric__name", name));
  card.appendChild(el("div", "metric__value", fmtMetric(m.value)));

  const bits = [];
  if (Array.isArray(m.ci95) && m.ci95.length === 2) bits.push(`${t("res.ci")} [${fmtMetric(m.ci95[0])}, ${fmtMetric(m.ci95[1])}]`);
  if (m.theory !== null && m.theory !== undefined) bits.push(`${t("res.theory")} ${fmtMetric(m.theory)}`);
  if (m.measured === false) bits.push(t("rescue.theory_only"));
  card.appendChild(el("div", "metric__detail", bits.join(" · ")));

  if (typeof m.value === "number" && m.value >= 0 && m.value <= 1) {
    const bar = el("div", "metric__bar");
    const fill = el("div", "metric__bar-fill");
    fill.style.width = `${Math.round(m.value * 100)}%`;
    bar.appendChild(fill);
    card.appendChild(bar);
  }
  return card;
}

function strategyTitle(s) {
  const key = `strategy.${s.key}`;
  if (!hasKey(key)) return s.title ?? s.key;
  const city = /^Reroute via (.+)$/.exec(s.title ?? "")?.[1] ?? "";
  return t(key, { city });
}

function strategyCard(s) {
  const card = el("div", `metric strategy strategy--${s.status}`);
  const head = el("div", "strategy__head");
  head.appendChild(el("span", "strategy__title", strategyTitle(s)));
  const ic = s.status === "ok" ? "ok" : s.status === "not_run" ? "idle" : "warn";
  head.appendChild(iconEl("span", "strategy__status", ic, t(`rescue.status.${s.status}`), 12));
  card.appendChild(head);

  if (s.status === "no_data" || !s.fidelity) {
    card.appendChild(el("div", "metric__detail", t("rescue.no_data_text")));
    return card;
  }
  const notRun = s.status === "not_run";
  const f = s.fidelity;
  const line = el("div", "metric__value", fmtMetric(f.value));
  card.appendChild(line);
  const bits = [`${t("rescue.fidelity")}`];
  if (!notRun && Array.isArray(f.ci95)) bits.push(`${t("res.ci")} [${fmtMetric(f.ci95[0])}, ${fmtMetric(f.ci95[1])}]`);
  if (notRun) bits.push(t("rescue.theory_only"));
  card.appendChild(el("div", "metric__detail", bits.join(" · ")));
  if (s.raw_pairs) {
    card.appendChild(
      el("div", "metric__detail", `${t("rescue.raw_pairs")}: ${fmtMetric(s.raw_pairs.value)}${notRun ? ` (${t("rescue.theory_only")})` : ""}`),
    );
  }
  const meets = notRun ? s.theory_meets_target : s.meets_target;
  card.appendChild(
    el("div", "metric__detail", t(notRun ? "rescue.theory_meets" : "rescue.meets", { v: t(meets ? "rescue.yes" : "rescue.no") })),
  );
  if (s.explanation) card.appendChild(el("div", "metric__detail strategy__expl", s.explanation));
  return card;
}

function renderRescue(container, result) {
  const viz = result.viz || {};
  const rec = viz.recommendation;
  if (rec) {
    const box = el("div", "metric");
    box.appendChild(el("div", "metric__name", t("rescue.recommendation")));
    box.appendChild(el("div", "metric__detail metric__detail--text", rec.message ?? ""));
    if (rec.incomplete) {
      const list = (rec.not_measured ?? []).join(", ");
      box.appendChild(iconEl("div", "banner banner--warn", "warn", t("rescue.incomplete", { list })));
    }
    container.appendChild(box);
  }
  if (Array.isArray(viz.strategies) && viz.strategies.length) {
    container.appendChild(el("h3", "results__heading", t("rescue.strategies")));
    for (const s of viz.strategies) container.appendChild(strategyCard(s));
  }
}

function sourceLabel(result) {
  const src = result.source ?? (result.mode === "recorded" ? "recorded" : "live");
  return hasKey(`res.source.${src}`) ? t(`res.source.${src}`) : String(src);
}

function renderBody(container, result) {
  // Meta line: where did this come from?
  const meta = el("div", "meta");
  meta.appendChild(el("span", "badge badge--source", sourceLabel(result)));
  const parts = [`${t("res.backend")}: ${result.backend ?? "?"}`, `${t("res.shots")}: ${result.shots ?? "?"}`];
  if (result.timestamp) parts.push(`${t("res.time")}: ${result.timestamp}`);
  meta.appendChild(el("div", "meta__line", parts.join(" · ")));
  container.appendChild(meta);

  if (result.cached_run) container.appendChild(iconEl("div", "banner", "info", t("res.cached")));
  if (result.params_ignored) {
    const b = iconEl("div", "banner banner--warn", "warn", t("res.params_ignored"));
    b.appendChild(el("code", "banner__code", JSON.stringify(result.params ?? {})));
    container.appendChild(b);
  }
  if (result.ionq_reduced) {
    const b = iconEl("div", "banner banner--warn", "warn", t("res.reduced"));
    const ul = el("ul", "notes");
    for (const n of [].concat(result.ionq_note ?? [])) ul.appendChild(el("li", null, String(n)));
    b.appendChild(ul);
    container.appendChild(b);
  }

  if (result.level === "rescue" && result.viz?.strategies) {
    renderRescue(container, result);
  } else {
    for (const [name, m] of Object.entries(result.metrics || {})) {
      if (m && typeof m === "object" && "value" in m) container.appendChild(metricCard(name, m));
    }
  }

  const notes = result.viz?.notes;
  if (Array.isArray(notes) && notes.length) {
    container.appendChild(el("h3", "results__heading", t("res.notes")));
    const ul = el("ul", "notes");
    for (const n of notes) ul.appendChild(el("li", null, String(n)));
    container.appendChild(ul);
  }

  if (result.params && !result.params_ignored) {
    const d = el("details", "params-used");
    d.appendChild(el("summary", null, t("res.params")));
    d.appendChild(el("code", "banner__code", JSON.stringify(result.params)));
    container.appendChild(d);
  }
}

function errorMessage(res) {
  switch (res.code) {
    case "ionq_job_used":
      return t("err.ionq_job_used");
    case "ionq_too_wide":
      return t("err.ionq_too_wide", { needed: res.needed_qubits ?? "?", max: res.max_qubits ?? "?" });
    case "previous_pending":
      return t("err.previous_pending");
    case "ionq_use_run_level":
      return t("err.ionq_use_run_level");
    default:
      break;
  }
  if (res.error === "timeout") return t("res.timeout", { s: res.timeout_s ?? 180 });
  if (res.input_error) return t("err.input_error");
  return null;
}

// Renders a run_level result (ok true or false) into `container`.
export function renderResult(container, result) {
  container.replaceChildren();
  if (!result) {
    container.appendChild(el("div", "results__error", t("res.error.generic")));
    return;
  }
  if (result.ok === false) {
    const fb = result.fallback;
    const hasFb = !!(fb && fb.result);
    // With a recorded result on screen this is a neutral notice, not a failure.
    const box = el("div", hasFb || result.code === "previous_pending" ? "banner" : "results__error");
    const head = hasFb
      ? iconEl("strong", null, "info", t("res.live_unavailable"))
      : result.code === "previous_pending" ? iconEl("strong", null, "info", "") : iconEl("strong", null, "fail", t("res.failed"));
    box.appendChild(head);
    const friendly = errorMessage(result);
    if (friendly) box.appendChild(el("p", "results__error-text", friendly));
    const detail = result.error ? t("res.error", { error: result.error }) : t("res.error.generic");
    if (!friendly || (result.error && !hasFb && result.code !== "previous_pending")) box.appendChild(el("p", "results__error-detail", detail));
    container.appendChild(box);

    if (hasFb) {
      const banner = iconEl(
        "div",
        "banner banner--recorded",
        "recorded",
        t("res.recorded", { backend: fb.backend ?? fb.result.backend ?? "?", timestamp: fb.timestamp ?? fb.result.timestamp ?? "?" }),
      );
      container.appendChild(banner);
      container.appendChild(el("div", "meta__line", t("res.recorded_note")));
      renderBody(container, { ...fb.result, source: "recorded" });
    } else if (!result.input_error) {
      container.appendChild(el("div", "meta__line", t("res.no_fallback")));
    }
    return;
  }
  renderBody(container, result);
}

// "Link BOG-CAL · degraded ⚠ · F = 0.78": the 3D link colour, also as text.
const STATE_ICON = { healthy: "ok", degraded: "warn", broken: "fail", damaged: "fail", rescued: "rescued" };
export function linkStatusCard({ label, F, status }) {
  const card = el("div", "metric linkstatus");
  const s = hasKey(`state.${status}`) ? t(`state.${status}`) : status;
  card.appendChild(el("div", "metric__name", t("res.link_status", { link: label })));
  card.appendChild(
    iconEl("div", "metric__value linkstatus__value", STATE_ICON[status] ?? "idle", `${s}${typeof F === "number" ? ` · ${t("res.f_value", { F: F.toFixed(3) })}` : ""}`, 16),
  );
  return card;
}
