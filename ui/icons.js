/*
  Small inline SVG icons (no icon font, no image files). They replace the unicode
  status symbols; the text always stays next to them, so the icon is never the only
  signal. Icons are decorative (aria-hidden) and inherit the text colour.
*/

const NS = "http://www.w3.org/2000/svg";

// 16x16 viewBox, stroke icons unless `fill` is set.
const SHAPES = {
  ok: { d: "M3 8.6l3.1 3.1L13 4.6" },
  fail: { d: "M4 4l8 8M12 4l-8 8" },
  warn: { d: "M8 2.3l6.1 10.9H1.9zM8 6.4v3.1M8 11.3v.2" },
  info: { d: "M8 7.2v4.3M8 4.7v.2", circle: true },
  recorded: { d: "M2.5 4.5h11v7h-11zM5 8h6" },
  idle: { circle: true },
  running: { d: "M8 2a6 6 0 1 0 6 6", spin: true },
  rescued: { d: "M8 3v10M3 8h10" },
  diamond: { d: "M8 1.6l6.4 6.4L8 14.4 1.6 8z", fill: true },
  partial: { d: "M3 8h10", circle: true },
};

export function icon(name, size = 14) {
  const sh = SHAPES[name] ?? SHAPES.idle;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "ico" + (sh.spin ? " ico--spin" : ""));
  const attrs = { fill: sh.fill ? "currentColor" : "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" };
  if (sh.circle) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", "8");
    c.setAttribute("cy", "8");
    c.setAttribute("r", "6.2");
    for (const [k, v] of Object.entries(attrs)) c.setAttribute(k, v);
    svg.appendChild(c);
  }
  if (sh.d) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", sh.d);
    for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
    svg.appendChild(p);
  }
  return svg;
}

// Replace the content of `node` by "<icon> text" (text through textContent).
export function setIconText(node, name, text, size = 14) {
  const span = document.createElement("span");
  span.textContent = text;
  node.replaceChildren(icon(name, size), span);
  return node;
}

// A new element "<icon> text".
export function iconEl(tag, cls, name, text, size = 14) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return setIconText(e, name, text, size);
}
