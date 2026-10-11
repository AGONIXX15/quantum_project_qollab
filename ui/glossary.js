/*
  Glossary tooltips: the first mention of a technical term inside a text block becomes a
  focusable "term" (Tab / hover / focus shows a short definition; Esc hides it).
  decorate(root) wraps text nodes only (never touches markup attributes), so it is safe on
  dictionary text; backend text is never passed through it.
*/

import { t, getLang } from "./i18n.js";

// term id -> regex per language (first match per block is wrapped)
const PATTERNS = {
  bell: { en: /\bBell pairs?\b/i, es: /\bpares? de Bell\b/i },
  fidelity: { en: /\bfidelity\b/i, es: /\bfidelidad\b/i },
  qber: { en: /\bQBER\b/, es: /\bQBER\b/ },
  chsh: { en: /\bCHSH\b/, es: /\bCHSH\b/ },
  decoherence: { en: /\bdecoherence\b/i, es: /\bdecoherencia\b/i },
};

let pop = null;
let current = null;

function ensurePop() {
  if (pop) return pop;
  pop = document.createElement("div");
  pop.id = "glossary-pop";
  pop.className = "glossary-pop";
  pop.setAttribute("role", "tooltip");
  pop.hidden = true;
  (document.getElementById("app") ?? document.body).appendChild(pop);
  return pop;
}

function show(termEl) {
  const p = ensurePop();
  const id = termEl.dataset.term;
  current = termEl;
  p.replaceChildren();
  const h = document.createElement("strong");
  h.textContent = t(`gl.${id}.name`);
  const body = document.createElement("span");
  body.textContent = t(`gl.${id}.def`);
  p.append(h, body);
  p.hidden = false;
  termEl.setAttribute("aria-describedby", "glossary-pop");
  const r = termEl.getBoundingClientRect();
  const pw = p.offsetWidth, ph = p.offsetHeight;
  const left = Math.min(window.innerWidth - pw - 8, Math.max(8, r.left + r.width / 2 - pw / 2));
  const above = r.top - ph - 8;
  p.style.left = `${left}px`;
  p.style.top = `${above > 8 ? above : r.bottom + 8}px`;
}

function hide() {
  if (!pop) return;
  pop.hidden = true;
  current?.removeAttribute("aria-describedby");
  current = null;
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  const termOf = (e) => e.target?.closest?.(".term[data-term]");
  document.addEventListener("mouseover", (e) => { const x = termOf(e); if (x) show(x); });
  const inPop = (n) => !!(n && pop && pop.contains(n));
  // The tooltip is hoverable (WCAG 1.4.13): leaving the term for the pop, or the pop for the term, keeps it open.
  document.addEventListener("mouseout", (e) => {
    const from = termOf(e) || inPop(e.target);
    if (from && !termOf({ target: e.relatedTarget }) && !inPop(e.relatedTarget)) hide();
  });
  document.addEventListener("focusin", (e) => { const x = termOf(e); if (x) show(x); });
  document.addEventListener("focusout", (e) => { if (termOf(e)) hide(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && pop && !pop.hidden) { hide(); e.stopPropagation(); }
  }, true);
}

// Wrap the first occurrence of each term in the text nodes under `root`.
export function decorate(root) {
  wire();
  const lang = getLang();
  const done = new Set();
  for (const [id, pats] of Object.entries(PATTERNS)) {
    if (done.has(id)) continue;
    const rx = pats[lang] ?? pats.en;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest(".term, button, select, option, input, textarea, code, svg") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const m = rx.exec(n.nodeValue);
      if (!m) continue;
      const after = n.splitText(m.index);
      after.splitText(m[0].length);
      const span = document.createElement("span");
      span.className = "term";
      span.tabIndex = 0;
      span.setAttribute("role", "button");
      span.dataset.term = id;
      span.textContent = after.nodeValue;
      after.replaceWith(span);
      done.add(id);
      break;
    }
  }
}
