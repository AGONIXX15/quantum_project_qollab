/*
  Geografía de Colombia para el terreno 3D.

  Dos piezas:
    1. OUTLINE: contorno (frontera + costas) de Colombia como polígono lat/lon.
       Simplificado a mano a partir de la silueta del país; suficiente para una
       silueta reconocible (Caribe al norte, Pacífico al oeste, Amazonía/Orinoquía
       al sureste). No es cartográficamente exacto, es un realce visual.
    2. elevation(lat, lon): altura procedural en km (aprox) que modela las TRES
       cordilleras de los Andes (Occidental, Central, Oriental), la Sierra Nevada
       de Santa Marta, y las planicies bajas del oriente. Sin datos externos.

  Las coordenadas de escena usan la MISMA proyección que quantum/geo.py
  (project): x = este, z = sur, centradas en Colombia. Así el terreno encaja con
  las ciudades y enlaces que ya coloca el backend.
*/

const CENTER = [4.57, -74.3]; // lat, lon (igual que geo.py)
const HALF_EXTENT_DEG = 8.8;
const rad = (d) => (d * Math.PI) / 180;

// Proyección equirectangular idéntica a geo.project.
export function project(lat, lon) {
  const k = Math.cos(rad(CENTER[0]));
  return {
    x: ((lon - CENTER[1]) * k) / HALF_EXTENT_DEG,
    z: -(lat - CENTER[0]) / HALF_EXTENT_DEG,
  };
}

// Inversa aproximada (de escena a lat/lon), para muestrear el heightmap.
export function unproject(x, z) {
  const k = Math.cos(rad(CENTER[0]));
  return {
    lat: CENTER[0] - z * HALF_EXTENT_DEG,
    lon: CENTER[1] + (x * HALF_EXTENT_DEG) / k,
  };
}

/*
  Contorno de Colombia (lat, lon). Recorrido horario desde el Caribe.
  Puntos escogidos a ojo sobre la silueta del país: la península de La Guajira,
  el Caribe, el tapón del Darién, la costa Pacífica, la frontera sur con
  Ecuador/Perú, el trapecio amazónico, y las fronteras con Brasil y Venezuela.
*/
export const OUTLINE = [
  [12.2, -71.3], // Punta Gallinas (La Guajira, extremo norte)
  [11.1, -74.2], // Santa Marta
  [10.4, -75.5], // Cartagena
  [9.4, -76.1], // Golfo de Morrosquillo
  [8.6, -77.35], // Golfo de Urabá
  [7.9, -77.4], // Darién
  [6.3, -77.9], // Pacífico norte (Chocó)
  [4.0, -77.4], // Buenaventura
  [2.6, -78.6], // Tumaco (Pacífico sur)
  [1.4, -78.8], // frontera Pacífico-Ecuador
  [0.8, -77.6], // frontera sur (Ipiales/Ecuador)
  [0.4, -76.4], // Putumayo
  [-0.6, -75.2], // frontera Perú (río Putumayo)
  [-2.3, -73.2], // Amazonas (hacia Leticia)
  [-4.2, -69.95], // Leticia (trapecio amazónico, extremo sur)
  [-1.5, -69.6], // frontera Brasil (río)
  [1.2, -69.8], // frontera Brasil/Venezuela
  [2.9, -67.9], // Guainía
  [4.1, -67.8], // Orinoco (frontera Venezuela)
  [6.2, -67.5], // Vichada / río Orinoco
  [7.1, -70.0], // Arauca
  [9.3, -72.0], // Norte de Santander (Catatumbo)
  [11.0, -72.5], // Sierra Nevada / Guajira sur
  [12.2, -71.3], // cierre en La Guajira
];

// Picos/macizos como "gaussianas" sumadas: [lat, lon, altura_km, radio_deg].
// Las tres cordilleras se representan como cadenas de montículos a lo largo de
// su eje aproximado; se afinan para que las ciudades caigan en valles/altiplanos.
const RANGES = [
  // Cordillera Occidental (paralela al Pacífico)
  [7.5, -76.3, 1.9, 0.7], [6.0, -76.2, 2.1, 0.7], [4.5, -76.3, 2.3, 0.7],
  [3.0, -76.4, 2.2, 0.7], [1.8, -77.2, 2.4, 0.8],
  // Cordillera Central (la más alta: nevados)
  [7.0, -75.4, 2.4, 0.6], [5.5, -75.4, 3.0, 0.55], [4.8, -75.3, 3.4, 0.5], // Nevado del Ruiz
  [4.2, -75.3, 3.2, 0.55], [2.8, -76.0, 2.9, 0.6], [1.9, -76.4, 3.0, 0.6],
  // Cordillera Oriental (Bogotá está en su altiplano)
  [7.3, -72.6, 2.6, 0.7], [6.3, -73.1, 2.7, 0.6], [5.3, -73.4, 2.6, 0.6],
  [4.7, -74.0, 2.6, 0.55], // altiplano cundiboyacense (Bogotá ~2640 m)
  [3.6, -74.6, 2.3, 0.6],
  // Sierra Nevada de Santa Marta (macizo aislado junto al Caribe, muy alto)
  [10.8, -73.7, 3.6, 0.4],
];

// Ruido fBm barato y determinista (no criptográfico), para rugosidad.
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x, y) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < 5; i++) {
    sum += amp * valueNoise(x * freq, y * freq);
    freq *= 2;
    amp *= 0.5;
  }
  return sum;
}

/**
 * Elevación procedural en "km aproximados" para una lat/lon.
 * Combina las cadenas montañosas (gaussianas) con rugosidad fBm. El oriente
 * (Orinoquía/Amazonía) queda bajo; los Andes y la Sierra Nevada, altos.
 */
export function elevation(lat, lon) {
  let h = 0;
  for (const [mlat, mlon, peak, r] of RANGES) {
    const d2 = ((lat - mlat) ** 2 + (lon - mlon) ** 2) / (r * r);
    h += peak * Math.exp(-d2);
  }
  // Planicie base ligera + rugosidad (más marcada en zona andina).
  const andean = Math.min(1, h / 1.5);
  const rough = (fbm(lon * 1.8 + 10, lat * 1.8 + 10) - 0.5) * (0.25 + 0.9 * andean);
  h += rough;
  // Llanura oriental muy baja (al este de lon -73, altura decae).
  if (lon > -73) h *= Math.max(0.15, 1 - (lon + 73) * 0.18);
  return Math.max(0, h);
}

// ¿Está (lat, lon) dentro del polígono del contorno? (ray casting)
export function insideColombia(lat, lon) {
  let inside = false;
  const pts = OUTLINE;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [yi, xi] = pts[i];
    const [yj, xj] = pts[j];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Contorno ya proyectado a coords de escena (para dibujar la línea de costa).
export function outlineProjected() {
  return OUTLINE.map(([lat, lon]) => project(lat, lon));
}
