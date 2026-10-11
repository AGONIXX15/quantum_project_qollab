/*
  Educational layer ("What am I seeing?"): simple-language explanation of each
  level plus a one-line reading of the result. All texts live in ui/i18n.js
  (EN/ES). `before` / `after` return OUR OWN static markup (dictionary text and
  formatted numbers only); backend strings are returned as { text } and must be
  inserted with textContent by the caller.
*/

import { t } from "./i18n.js";

const LEVELS = ["link", "teleport", "noise", "leak", "swap", "purify", "qkd", "rescue"];

export function hasExplain(levelId) {
  return LEVELS.includes(levelId);
}

export function explainTitle(levelId) {
  return t(`ex.${levelId}.title`);
}

export function explainBefore(levelId) {
  return t(`ex.${levelId}.before`);
}

function fidelityLine(r, levelId) {
  const F = r?.metrics?.fidelity?.value;
  if (typeof F !== "number") return "";
  return `${t("ex.F", { F: F.toFixed(3) })} ${t(F >= 0.9 ? `ex.${levelId}.good` : `ex.${levelId}.bad`)}`;
}

// Returns a markup string, { text } (plain backend text), or "" for no line.
export function explainAfter(levelId, r) {
  switch (levelId) {
    case "link":
    case "teleport":
    case "swap":
      return fidelityLine(r, levelId);
    case "noise":
      return t("ex.noise.after");
    case "purify": {
      const a = r?.metrics?.fidelity_adaptive?.value;
      const i = r?.metrics?.fidelity_input?.value;
      if (typeof a === "number" && typeof i === "number") {
        return t("ex.purify.after", { i: i.toFixed(3), a: a.toFixed(3) });
      }
      return t("ex.purify.generic");
    }
    case "qkd": {
      const s = r?.metrics?.chsh_standard?.value;
      const qx = r?.metrics?.qber_X?.value;
      if (typeof s !== "number") return t("ex.qkd.generic");
      if (s <= 2) return t("ex.qkd.lost", { S: s.toFixed(2) });
      // CHSH > 2 alone does not mean "safe": a partial spy keeps S > 2 but pushes QBER past 11 %.
      if (typeof qx === "number" && qx > 0.11) return t("ex.qkd.leaky", { S: s.toFixed(2), Q: (qx * 100).toFixed(1) });
      return t("ex.qkd.safe", { S: s.toFixed(2) });
    }
    case "rescue": {
      const msg = r?.viz?.recommendation?.message;
      return msg ? { text: msg } : t("ex.rescue.generic");
    }
    default:
      return "";
  }
}

// Tooltip / detail of a city (QPU node). Plain text rows.
export function cityTooltip(data) {
  return {
    title: data.name,
    rows: [
      t(data.challenge ? "city.challenge" : "city.main"),
      t("city.coords", { lat: data.lat.toFixed(3), lon: data.lon.toFixed(3) }),
    ],
  };
}
