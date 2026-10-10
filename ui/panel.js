/*
  Panel de control y de resultados (DOM puro, sin frameworks).

  El formulario de parámetros se construye desde api.info(): cada nivel declara
  sus parámetros con rangos/defaults, y aquí los traducimos a controles (sliders,
  selects, checkboxes, listas). Así la UI sigue al backend sin hardcodear.
*/

// --- Construcción del formulario de parámetros de un nivel -----------------

// Convierte un spec de parámetro de info() en un control del DOM.
function buildControl(name, spec) {
  const field = document.createElement("label");
  field.className = "field";

  const label = document.createElement("span");
  label.className = "field__label";
  label.textContent = prettyName(name, spec);
  field.appendChild(label);

  // Opciones -> <select>
  if (spec && Array.isArray(spec.options)) {
    const sel = document.createElement("select");
    for (const opt of spec.options) {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      if (opt === spec.default) o.selected = true;
      sel.appendChild(o);
    }
    sel.dataset.param = name;
    sel.dataset.kind = "choice";
    field.appendChild(sel);
    return field;
  }

  // Booleano -> checkbox
  if (spec && typeof spec.default === "boolean") {
    const row = document.createElement("div");
    row.className = "field__row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = spec.default;
    cb.dataset.param = name;
    cb.dataset.kind = "bool";
    row.appendChild(cb);
    field.appendChild(row);
    return field;
  }

  // Lista de números (p.ej. Fs) -> input de texto con CSV
  if (spec && Array.isArray(spec.default)) {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = spec.default.join(", ");
    inp.dataset.param = name;
    inp.dataset.kind = "numlist";
    field.appendChild(inp);
    return field;
  }

  // Número con rango -> slider + valor
  if (spec && spec.min !== undefined && spec.max !== undefined) {
    const row = document.createElement("div");
    row.className = "field__row";
    const range = document.createElement("input");
    range.type = "range";
    const def = spec.default ?? (spec.min + spec.max) / 2;
    const step = chooseStep(spec.min, spec.max);
    range.min = spec.min;
    range.max = spec.max;
    range.step = step;
    range.value = def;
    range.dataset.param = name;
    range.dataset.kind = "num";

    const out = document.createElement("span");
    out.className = "field__value";
    out.textContent = fmtNum(def, spec.unit);
    range.addEventListener("input", () => {
      out.textContent = fmtNum(parseFloat(range.value), spec.unit);
    });

    row.appendChild(range);
    row.appendChild(out);
    field.appendChild(row);
    return field;
  }

  // Fallback: input numérico libre
  const inp = document.createElement("input");
  inp.type = "number";
  inp.value = spec?.default ?? 0;
  inp.dataset.param = name;
  inp.dataset.kind = "num";
  field.appendChild(inp);
  return field;
}

function chooseStep(min, max) {
  const span = max - min;
  if (span <= 2) return 0.01;
  if (span <= 20) return 0.1;
  return 1;
}

function fmtNum(v, unit) {
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return unit ? `${s} ${unit}` : s;
}

function prettyName(name, spec) {
  const base = name.replace(/_deg$/, " (°)").replace(/_/g, " ");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// Lee los valores actuales del formulario como objeto de parámetros.
export function readParams(formEl) {
  const params = {};
  for (const el of formEl.querySelectorAll("[data-param]")) {
    const name = el.dataset.param;
    switch (el.dataset.kind) {
      case "num":
        params[name] = parseFloat(el.value);
        break;
      case "bool":
        params[name] = el.checked;
        break;
      case "numlist":
        params[name] = el.value
          .split(",")
          .map((s) => parseFloat(s.trim()))
          .filter((n) => !Number.isNaN(n));
        break;
      default:
        params[name] = el.value;
    }
  }
  return params;
}

// Construye el formulario completo de un nivel dentro de #params.
export function buildParamsForm(container, levelSpec) {
  container.innerHTML = "";
  const params = levelSpec.params || {};
  for (const [name, spec] of Object.entries(params)) {
    container.appendChild(buildControl(name, spec));
  }
}

// --- Render de resultados ---------------------------------------------------

function metricCard(name, m) {
  const card = document.createElement("div");
  card.className = "metric";

  const title = document.createElement("div");
  title.className = "metric__name";
  title.textContent = name;
  card.appendChild(title);

  const value = document.createElement("div");
  value.className = "metric__value";
  value.textContent = fmtMetric(m.value);
  card.appendChild(value);

  const detail = document.createElement("div");
  detail.className = "metric__detail";
  const bits = [];
  if (Array.isArray(m.ci95)) bits.push(`IC95 [${fmtMetric(m.ci95[0])}, ${fmtMetric(m.ci95[1])}]`);
  if (m.theory !== null && m.theory !== undefined) bits.push(`teoría ${fmtMetric(m.theory)}`);
  detail.textContent = bits.join(" · ");
  card.appendChild(detail);

  // Barra para métricas tipo probabilidad/fidelidad en [0,1].
  if (typeof m.value === "number" && m.value >= 0 && m.value <= 1) {
    const bar = document.createElement("div");
    bar.className = "metric__bar";
    const fill = document.createElement("div");
    fill.className = "metric__bar-fill";
    fill.style.width = `${Math.round(m.value * 100)}%`;
    bar.appendChild(fill);
    card.appendChild(bar);
  }
  return card;
}

function fmtMetric(v) {
  if (typeof v !== "number") return String(v);
  if (Math.abs(v) >= 100) return v.toFixed(1);
  return v.toFixed(3);
}

// Renderiza un resultado (envelope ok:true/false) en #results.
export function renderResult(container, result) {
  container.innerHTML = "";

  if (!result || result.ok === false) {
    const err = document.createElement("div");
    err.className = "results__error";
    err.textContent = result?.error
      ? `Error: ${result.error}`
      : "El backend devolvió un error.";
    container.appendChild(err);
    return;
  }

  // Recomendación destacada (nivel rescue).
  const rec = result.viz?.recommendation;
  if (rec) {
    const box = document.createElement("div");
    box.className = "metric";
    box.innerHTML = `<div class="metric__name">Recomendación</div><div class="metric__detail" style="font-size:13px;color:var(--text)">${rec.message}</div>`;
    container.appendChild(box);
  }

  // Métricas.
  const metrics = result.metrics || {};
  for (const [name, m] of Object.entries(metrics)) {
    if (m && typeof m === "object" && "value" in m) {
      container.appendChild(metricCard(name, m));
    }
  }

  // Notas de la viz.
  const notes = result.viz?.notes;
  if (Array.isArray(notes) && notes.length) {
    const ul = document.createElement("ul");
    ul.className = "notes";
    for (const n of notes) {
      const li = document.createElement("li");
      li.textContent = n;
      ul.appendChild(li);
    }
    container.appendChild(ul);
  }
}
