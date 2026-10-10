/*
  Intro tour: a dismissible 5-step card for non-experts. Keyboard: Tab is trapped inside
  the card, Esc closes, Enter/Space on the buttons. It never blocks the autorun (the card
  is the only thing that takes pointer events; the map and the run keep going behind it).
  All text lives in ui/i18n.js (tour.*).
*/

import { t } from "./i18n.js";
import { decorate } from "./glossary.js";

const STEPS = 5;

export function createTour(root, { onClose } = {}) {
  const $ = (sel) => root.querySelector(sel);
  const stepEl = $("#tour-step"), titleEl = $("#tour-step-title"), textEl = $("#tour-text");
  const dots = $("#tour-dots");
  const back = $("#tour-back"), next = $("#tour-next"), skip = $("#tour-skip");
  let i = 0;
  let opener = null;
  const inerted = [];
  const introBtn = () => document.getElementById("tour-btn");

  dots.replaceChildren(...Array.from({ length: STEPS }, () => {
    const d = document.createElement("span");
    d.className = "tour__dot";
    return d;
  }));

  function render() {
    stepEl.textContent = t("tour.step", { n: i + 1, total: STEPS });
    titleEl.textContent = t(`tour.${i + 1}.title`);
    textEl.textContent = t(`tour.${i + 1}.text`);
    decorate(textEl);
    [...dots.children].forEach((d, k) => d.classList.toggle("is-on", k <= i));
    back.disabled = i === 0;
    next.textContent = i === STEPS - 1 ? t("tour.start") : t("tour.next");
  }

  const focusables = () => [...root.querySelectorAll('button:not([disabled]), [tabindex="0"]')].filter((e) => !e.closest("[hidden]"));

  function onKey(e) {
    if (root.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (!root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function open(from) {
    opener = from ?? introBtn() ?? document.activeElement;
    i = 0;
    // Everything behind the card is inert (no focus, no clicks, hidden from assistive tech).
    for (const node of root.parentElement.children) {
      if (node === root || node.id === "loader" || node.id === "glossary-pop" || node.inert) continue;
      node.inert = true;
      inerted.push(node);
    }
    root.hidden = false;
    render();
    document.addEventListener("keydown", onKey);
    next.focus();
  }

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    document.removeEventListener("keydown", onKey);
    for (const node of inerted.splice(0)) node.inert = false;
    const target = opener && document.contains(opener) && !opener.disabled ? opener : introBtn();
    target?.focus();
    onClose?.();
  }

  next.addEventListener("click", () => {
    if (i === STEPS - 1) close();
    else { i++; render(); }
  });
  back.addEventListener("click", () => { if (i > 0) { i--; render(); } });
  skip.addEventListener("click", close);

  return { open, close, render: () => { if (!root.hidden) render(); }, isOpen: () => !root.hidden };
}
