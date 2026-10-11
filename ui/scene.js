/*
  3D scene of the quantum network over the REAL Colombia (three.js + bloom).

  Layers:
    - Terrain: real DEM (AWS Terrain Tiles, land + sea floor) over lon -92..-58,
      lat -8..16, draped with NASA Blue Marble. Colombia is highlighted (glowing border),
      its neighbours are dimmed. Data comes from ui/data/*.js (see tools/bake_terrain.py).
    - Sea: semi-transparent animated surface at 0 m over the bathymetry.
    - Labels: countries, seas, cordilleras (EN/ES through i18n).
    - Nodes: cities at their real lat/lon on top of the terrain; the challenge city has
      a different shape (diamond + octahedron), not only a different colour.
    - Links: arcs above the terrain with a floating badge "F = 0.95 + status text"
      (colour is never the only signal; width and dashing also change). Great-circle length
      is shown on hover or while the link is focused.
    - Photons: Bell pairs leave the middle of the link towards BOTH ends together, coloured
      by the parity sample. InstancedMesh: one draw call per link.
    - FogExp2 hides the far edges of the region; bloom + ACES tone mapping.

  One shared projection for everything: terrain.js toScene(lat, lon) = quantum/geo.py project().
  prefers-reduced-motion -> static render (no waves, pulses, photon flow or camera tween).
*/

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

import {
  BBOX, BORDERS, DEM, DEM_W, DEM_H, LON_SPAN, LAT_SPAN, EARTH_SIZE,
  toScene, fromScene, elevationM, surfaceUnits, surfaceAt, curveDrop, CURVE, SEA_LEVEL, haversineKm, paintEarth, loadEarthImage, makeFadeCanvas,
} from "./terrain.js";
import { icon, setIconText } from "./icons.js";
import { t, onLangChange } from "./i18n.js";

const COLORS = {
  city: 0x2fe0c0,          // turquoise (main node)
  cityChallenge: 0xffc23d, // amber (challenge city)
  linkHealthy: 0x2fe0c0,
  linkDegraded: 0xf5a623,
  linkBroken: 0xff5a6e,
  linkRescued: 0x7ef29a,
  linkIdle: 0x4f86a8,
  photon0: 0x58d8ff,       // parity 0 (equal): bright cyan
  photon1: 0xff7a1a,       // parity 1 (error): intense orange
};

const FOG_COLOR = 0x0e1628; // deep night blue: fog, sky horizon and the terrain vignette all match
const CLEARANCE = 0.3;     // minimum height of a link above the terrain (scene units)
const NODE_LIFT = 0.2;     // height of the qubit sphere above the ground

// Same thresholds as the legend: healthy F >= 0.9, degraded 0.6-0.9, broken below.
export function classifyFidelity(F) {
  if (F == null) return "healthy";
  if (F >= 0.9) return "healthy";
  if (F >= 0.6) return "degraded";
  return "broken";
}

// "healthy" | "degraded" | "broken" | "rescued" | "idle"
function statusKind(F, status) {
  if (status === "broken" || status === "damaged") return "broken";
  if (status === "rescued") return "rescued";
  if (F == null) return "idle";
  return classifyFidelity(F);
}

const KIND_COLOR = {
  healthy: COLORS.linkHealthy, degraded: COLORS.linkDegraded, broken: COLORS.linkBroken,
  rescued: COLORS.linkRescued, idle: COLORS.linkIdle,
};
const KIND_ICON = { healthy: "ok", degraded: "warn", broken: "fail", rescued: "rescued", idle: "idle" };
// Width multiplier and dashing: second and third signals besides colour.
const KIND_WIDTH = { healthy: 1.0, rescued: 1.0, idle: 0.7, degraded: 0.75, broken: 0.5 };

// Static map labels: [i18n key, css kind, lat, lon, lift above ground (scene units)].
const GEO_LABELS = [
  ["geo.colombia", "country colombia", 3.2, -71.6, 0.5],
  ["geo.panama", "country", 8.6, -80.4, 0.4],
  ["geo.venezuela", "country", 7.4, -65.8, 0.6],
  ["geo.ecuador", "country", -1.4, -78.4, 0.6],
  ["geo.peru", "country", -6.2, -75.8, 0.5],
  ["geo.brazil", "country", -3.4, -63.0, 0.5],
  ["geo.caribbean", "ocean", 14.2, -75.6, 0.15],
  ["geo.pacific", "ocean", 3.0, -85.8, 0.15],
  ["geo.cord_w", "range", 7.9, -76.7, 0.55],
  ["geo.cord_c", "range", 1.5, -76.2, 0.85],
  ["geo.cord_e", "range", 6.9, -72.7, 0.85],
  ["geo.llanos", "region", 4.4, -70.6, 0.3],
  ["geo.amazon", "region", -1.6, -70.8, 0.3],
];
// Collision priority (lower wins): cities and the active link badge 0, link badges 1,
// Colombia 2, other countries 3, oceans 4, cordilleras 5, regions 6.
const LABEL_PRIO = { colombia: 2, country: 3, ocean: 4, range: 5, region: 6 };

export class NetworkScene {
  constructor(container, labelLayer) {
    this.container = container;
    this.labelLayer = labelLayer;
    this.cities = {};
    this.links = {};
    this.geoLabels = [];
    this.labelItems = []; // every collidable HTML label: { el, prio | link }
    this._frame = 0;
    this._userMoved = false;
    this.viewMode = "network";
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hoverHandlers = [];
    this._tween = null;
    this._activeIds = new Set(); // links with the highlighted badge (one link, or a whole route)
    this._hoverLinkId = null;
    this._main = null; // stash of the main network while the sandbox chapter is shown
    this._pickCb = null;

    // prefers-reduced-motion: static render (no photon flow, waves, pulses or camera tween).
    this._motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    this.reducedMotion = !!this._motionQuery?.matches;
    this._motionQuery?.addEventListener?.("change", (e) => {
      this.reducedMotion = e.matches;
      if (this.controls) this.controls.enableDamping = !e.matches;
    });

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._initLights();
    this._initComposer();
    this._initSky();
    this._buildTerrain();
    this._buildBorderLine();
    this._buildSea();
    this._buildGeoLabels();
    this._bindResize();
    this._bindPointer();
    onLangChange(() => this._retext());
    this._animate();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    // Tone mapping + sRGB output are set right after construction.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.55;
    this.container.appendChild(this.renderer.domElement);

    // Crisp HTML labels (not pixelated).
    this.labelRenderer = new CSS2DRenderer({ element: this.labelLayer });
    this.labelRenderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(FOG_COLOR);
    // Atmospheric fog: Colombia (distance ~18) stays crisp, the far region fades out and
    // the edges of the data window disappear.
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.017);
  }

  _initCamera() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 200);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.reducedMotion;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 3.5;
    this.controls.maxDistance = 30;
    this.controls.maxPolarAngle = 1.32; // never below the horizon: the map cannot be lost
    this.controls.minPolarAngle = 0.12;
    this.controls.screenSpacePanning = false;
    this.controls.autoRotate = false;

    this.controls.addEventListener("start", () => { this._userMoved = true; this.viewMode = "custom"; });

    // Explicit framing before the first render. Two named views: the whole region, and the
    // Bogota-Medellin-Cali triangle (recomputed from the cities in buildFromGeo).
    this.views = {
      region: this._view(new THREE.Vector3(0, 0, 0.5), 19, 0.9),
      network: this._view(new THREE.Vector3(-0.4, 0.2, -0.2), 9, 0.95),
    };
    this.camera.position.copy(this.views.network.position);
    this.controls.target.copy(this.views.network.target);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  // A camera pose looking at `target` from `dist`, polar angle from vertical, north up.
  _view(target, dist, polar, az = 0) {
    return {
      target,
      position: new THREE.Vector3(
        target.x + dist * Math.sin(polar) * Math.sin(az),
        target.y + dist * Math.cos(polar),
        target.z + dist * Math.sin(polar) * Math.cos(az)
      ),
    };
  }

  _initLights() {
    this.scene.add(new THREE.HemisphereLight(0xdbe8ff, 0x3a3024, 1.5));
    // Low sun from the west-northwest: grazing light makes the N-S cordilleras read.
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
    sun.position.set(-11, 6, -4);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x5f86d8, 0.5);
    fill.position.set(9, 5, 8);
    this.scene.add(fill);
  }

  _initComposer() {
    const size = new THREE.Vector2(this.container.clientWidth, this.container.clientHeight);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Low strength + high threshold: only photons, nodes and the border glow.
    this.bloom = new UnrealBloomPass(size, 0.4, 0.6, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  // Sky: dome with a vertical gradient.
  _initSky() {
    const uniforms = {
      zenith: { value: new THREE.Color(0x04070f) },
      mid: { value: new THREE.Color(0x0a1122) },
      horizon: { value: new THREE.Color(FOG_COLOR) },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(90, 32, 20),
      new THREE.ShaderMaterial({
        uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: `
          varying vec3 vWorld;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: `
          uniform vec3 zenith; uniform vec3 mid; uniform vec3 horizon;
          varying vec3 vWorld;
          void main() {
            float h = normalize(vWorld).y;
            float t = clamp(h, 0.0, 1.0);
            vec3 col = (t < 0.4)
              ? mix(horizon, mid, smoothstep(0.0, 0.4, t))
              : mix(mid, zenith, smoothstep(0.4, 1.0, t));
            gl_FragColor = vec4(col, 1.0);
          }`,
      })
    );
    this.scene.add(sky);

    // A few faint stars on the upper dome (static; deep-space feel behind the fading map).
    const N = 450, arr = new Float32Array(N * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      const u = rnd() * Math.PI * 2, y = 0.08 + rnd() * 0.92, r = Math.sqrt(1 - y * y);
      arr.set([Math.cos(u) * r * 85, y * 85, Math.sin(u) * r * 85], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    this.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({
      color: 0xbcd0ff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.55, fog: false, depthWrite: false,
    })));
  }

  // Real DEM mesh (one vertex per DEM cell, ~185k vertices) with the Blue Marble draped.
  _buildTerrain() {
    const W = DEM_W, H = DEM_H;
    const pos = new Float32Array(W * H * 3);
    const uv = new Float32Array(W * H * 2);
    for (let j = 0; j < H; j++) {
      const lat = BBOX.north - ((j + 0.5) / H) * LAT_SPAN;
      for (let i = 0; i < W; i++) {
        const lon = BBOX.west + ((i + 0.5) / W) * LON_SPAN;
        const p = toScene(lat, lon);
        const k = j * W + i;
        pos[3 * k] = p.x;
        pos[3 * k + 1] = surfaceUnits(DEM[k], lat, lon, p.x, p.z);
        pos[3 * k + 2] = p.z;
        uv[2 * k] = (i + 0.5) / W;
        uv[2 * k + 1] = 1 - (j + 0.5) / H;
      }
    }
    const idx = new Uint32Array((W - 1) * (H - 1) * 6);
    let n = 0;
    for (let j = 0; j < H - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
        idx[n++] = a; idx[n++] = c; idx[n++] = b;
        idx[n++] = b; idx[n++] = c; idx[n++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    this.terrainVertices = W * H;

    // Texture: Blue Marble once it decodes (elevation colour ramp if it cannot).
    const canvas = document.createElement("canvas");
    canvas.width = EARTH_SIZE.w;
    canvas.height = EARTH_SIZE.h;
    const c0 = canvas.getContext("2d");
    c0.fillStyle = "#0e1628";
    c0.fillRect(0, 0, canvas.width, canvas.height);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    loadEarthImage().then((img) => {
      paintEarth(canvas, img); // img === null -> elevation colour ramp fallback
      tex.needsUpdate = true;
    });

    const fadeTex = new THREE.CanvasTexture(makeFadeCanvas());
    this.terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, alphaMap: fadeTex, transparent: true, roughness: 1, metalness: 0 }));
    this.scene.add(this.terrain);
  }

  // Colombia border draped over the terrain (thin line; the glowing stroke is in the texture).
  _buildBorderLine() {
    const pts = [];
    for (const ring of BORDERS.colombia) {
      const segs = [];
      for (let i = 0; i < ring.length; i++) {
        const [lon0, lat0] = ring[i];
        const [lon1, lat1] = ring[(i + 1) % ring.length];
        const steps = Math.max(1, Math.ceil(Math.hypot(lon1 - lon0, lat1 - lat0) / 0.05));
        for (let s = 0; s < steps; s++) {
          const f = s / steps;
          const p = toScene(lat0 + (lat1 - lat0) * f, lon0 + (lon1 - lon0) * f);
          const y = surfaceAt(p.x, p.z) + 0.02;
          segs.push(new THREE.Vector3(p.x, y, p.z));
        }
      }
      pts.push(...segs.flatMap((v, i) => [v, segs[(i + 1) % segs.length]]));
    }
    const line = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xb8fff0, transparent: true, opacity: 0.5, depthWrite: false })
    );
    this.scene.add(line);
    this.borderLine = line;
  }

  // Sea surface at 0 m: transparent, so the bathymetry shows through.
  _buildSea() {
    const w = toScene(0, BBOX.west), e = toScene(0, BBOX.east);
    const n = toScene(BBOX.north, 0), s = toScene(BBOX.south, 0);
    const sx = e.x - w.x, sz = s.z - n.z;
    this.seaUniforms = {
      time: { value: 0 },
      sunDir: { value: new THREE.Vector3(-11, 6, -4).normalize() },
    };
    const geo = new THREE.PlaneGeometry(sx, sz, 160, 112);
    geo.rotateX(-Math.PI / 2);
    const sea = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.seaUniforms,
        transparent: true,
        depthWrite: false,
        vertexShader: `
          varying vec3 vWorld;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            wp.y -= ${CURVE.toFixed(5)} * (wp.x * wp.x + wp.z * wp.z); // same curvature as the terrain
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: `
          uniform vec3 sunDir; uniform float time;
          varying vec3 vWorld;
          varying vec2 vUv;
          void main() {
            // Analytic wave normal (static when time = 0).
            vec2 p = vWorld.xz;
            float dx = cos(p.x * 1.7 + time * 0.7) * 0.06 + cos((p.x + p.y) * 2.6 - time * 0.9) * 0.04;
            float dz = cos(p.y * 2.1 + time * 0.6) * 0.06 + cos((p.x - p.y) * 3.1 + time * 0.8) * 0.04;
            vec3 n = normalize(vec3(-dx, 1.0, -dz));
            vec3 v = normalize(cameraPosition - vWorld);
            float fres = pow(1.0 - max(dot(v, n), 0.0), 3.0);
            vec3 col = vec3(0.02, 0.12, 0.22);
            col = mix(col, vec3(0.45, 0.28, 0.2), fres * 0.55);
            vec3 h = normalize(v + normalize(sunDir));
            col += vec3(1.0, 0.85, 0.65) * pow(max(dot(n, h), 0.0), 90.0) * 0.55;
            float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
            float r = length((vUv - 0.5) * 2.0);
            float fade = 1.0 - smoothstep(0.5, 0.9, r);
            float a = (0.3 + 0.35 * fres) * fade;
            gl_FragColor = vec4(col, a);
          }`,
      })
    );
    sea.position.set((w.x + e.x) / 2, SEA_LEVEL, (n.z + s.z) / 2);
    sea.renderOrder = 1;
    this.scene.add(sea);
  }

  _buildGeoLabels() {
    for (const [key, kind, lat, lon, lift] of GEO_LABELS) {
      const el = document.createElement("div");
      el.className = "geo-label " + kind.split(" ").map((k) => `geo-label--${k}`).join(" ");
      const label = new CSS2DObject(el);
      const p = toScene(lat, lon);
      label.position.set(p.x, surfaceAt(p.x, p.z) + lift, p.z);
      this.scene.add(label);
      this.geoLabels.push({ key, el });
      const base = kind.split(" ")[1] ?? kind.split(" ")[0];
      this.labelItems.push({ el, prio: LABEL_PRIO[base] ?? 6 });
    }
    this._retext();
  }

  // Re-render every translatable text of the scene (language change).
  _retext() {
    for (const g of this.geoLabels) g.el.textContent = t(g.key);
    for (const l of Object.values(this.links)) this._renderLinkLabel(l);
    for (const l of Object.values(this._main?.links ?? {})) this._renderLinkLabel(l);
  }

  // --- Construction from the backend geography ------------------------------
  buildFromGeo(geo) {
    for (const [id, c] of Object.entries(geo.cities)) this._buildCity(id, c);
    for (const link of geo.links) this._buildLink(link);
    this._retext();

    // Opening view: the triangle of the three main cities, region still visible around it.
    const main = Object.values(this.cities).filter((c) => !c.data.challenge);
    if (main.length) {
      const cen = main.reduce((a, c) => a.add(c.pos), new THREE.Vector3()).multiplyScalar(1 / main.length);
      this.views.network = this._view(new THREE.Vector3(cen.x, 0.15, cen.z), 8.6, 0.95);
      if (!this._userMoved && !this._tween) {
        this.camera.position.copy(this.views.network.position);
        this.controls.target.copy(this.views.network.target);
        this.camera.lookAt(this.controls.target);
        this.controls.update();
      }
    }
  }

  _buildCity(id, c) {
    const p = toScene(c.lat, c.lon); // same projection as the terrain
    const ground = surfaceAt(p.x, p.z) + 0.02;
    const pos = new THREE.Vector3(p.x, ground, p.z);
    const challenge = !!c.challenge;
    const color = challenge ? COLORS.cityChallenge : COLORS.city;
    const group = new THREE.Group();
    group.position.copy(pos);

    const additive = { color, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending };
    // Glowing base ring (diamond for the challenge city) + pulsing outer ring.
    const base = new THREE.Mesh(
      challenge ? new THREE.RingGeometry(0.19, 0.27, 4) : new THREE.RingGeometry(0.16, 0.22, 48),
      new THREE.MeshBasicMaterial({ ...additive, opacity: 0.95 })
    );
    base.rotation.x = -Math.PI / 2;
    if (challenge) base.rotation.z = Math.PI / 4;
    base.position.y = 0.01;
    group.add(base);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.16, 40),
      new THREE.MeshBasicMaterial({ ...additive, opacity: 0.2 })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.008;
    group.add(disc);
    const pulse = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.315, 64),
      new THREE.MeshBasicMaterial({ ...additive, opacity: 0.4 })
    );
    pulse.rotation.x = -Math.PI / 2;
    pulse.position.y = 0.012;
    group.add(pulse);

    // Thin pillar + the qubit itself (sphere; octahedron for the challenge city).
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, NODE_LIFT, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false })
    );
    pillar.position.y = NODE_LIFT / 2;
    group.add(pillar);
    const core = new THREE.Mesh(
      challenge ? new THREE.OctahedronGeometry(0.11, 0) : new THREE.IcosahedronGeometry(0.08, 2),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.1, roughness: 0.3, metalness: 0.1 })
    );
    core.position.y = NODE_LIFT;
    group.add(core);

    // Generous invisible hit target for hover.
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.12;
    group.add(hit);

    const el = document.createElement("div");
    el.className = "city-label" + (challenge ? " city-label--challenge" : "");
    if (challenge) el.appendChild(icon("diamond", 10));
    el.appendChild(document.createTextNode(c.name));
    const label = new CSS2DObject(el);
    label.position.set(0, 0.55, 0);
    group.add(label);
    this.labelItems.push({ el, prio: 0 });

    this.scene.add(group);
    const entry = { group, core, hit, pulse, pos, data: c, color, label };
    this.cities[id] = entry;
    return entry;
  }

  _buildLink(linkData) {
    const { id, a: aId, b: bId } = linkData;
    const ca = this.cities[aId], cb = this.cities[bId];
    if (!ca || !cb) return;
    const a = ca.pos.clone().add(new THREE.Vector3(0, NODE_LIFT, 0));
    const b = cb.pos.clone().add(new THREE.Vector3(0, NODE_LIFT, 0));

    // Arc: a lifted line between the nodes that always clears the terrain underneath.
    const N = 48;
    const dist = a.distanceTo(b);
    const xs = [], zs = [], ys = [], ground = [];
    for (let i = 0; i <= N; i++) {
      const f = i / N;
      const x = THREE.MathUtils.lerp(a.x, b.x, f), z = THREE.MathUtils.lerp(a.z, b.z, f);
      xs.push(x); zs.push(z);
      ground.push(surfaceAt(x, z));
      ys.push(THREE.MathUtils.lerp(a.y, b.y, f) + Math.sin(Math.PI * f) * dist * 0.1);
    }
    for (let pass = 0; pass < 4; pass++) { // lift over ridges, then smooth
      for (let i = 1; i < N; i++) ys[i] = Math.max(ys[i], ground[i] + CLEARANCE);
      const prev = ys.slice();
      for (let i = 1; i < N; i++) ys[i] = (prev[i - 1] + 2 * prev[i] + prev[i + 1]) / 4;
    }
    for (let i = 1; i < N; i++) ys[i] = Math.max(ys[i], ground[i] + CLEARANCE * 0.8);
    const curve = new THREE.CatmullRomCurve3(xs.map((x, i) => new THREE.Vector3(x, ys[i], zs[i])));

    const uniforms = {
      time: { value: 0 },
      color: { value: new THREE.Color(COLORS.linkIdle) },
      intensity: { value: 1.0 },
      flow: { value: 1.0 },
      width: { value: KIND_WIDTH.idle },
      dashed: { value: 0 },
    };
    const R = 0.045;
    const mat = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        uniform float width;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position + normal * ${R.toFixed(3)} * (width - 1.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform float time; uniform vec3 color; uniform float intensity; uniform float flow; uniform float dashed;
        varying vec2 vUv;
        void main() {
          if (dashed > 0.5 && fract(vUv.x * 40.0) > 0.55) discard;
          float pulse = pow(sin(vUv.x * 18.0 - time * flow * 3.0) * 0.5 + 0.5, 2.5);
          float core = 0.45 + 0.55 * pulse;
          gl_FragColor = vec4(color * (0.3 + 0.4 * core) * intensity, 0.7 + 0.3 * core);
        }`,
    });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, R, 8, false), mat);
    this.scene.add(tube);

    const hit = new THREE.Mesh(new THREE.TubeGeometry(curve, 36, 0.14, 5, false), new THREE.MeshBasicMaterial({ visible: false }));
    this.scene.add(hit);

    // Pair source in the middle of the link (visual): bright core + flat ring, clearly not a photon.
    const mid = curve.getPointAt(0.5);
    const src = new THREE.Group();
    src.position.copy(mid);
    src.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), new THREE.MeshBasicMaterial({ color: 0xfff1b8 })));
    const srcRing = new THREE.Mesh(
      new THREE.RingGeometry(0.13, 0.155, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    srcRing.rotation.x = -Math.PI / 2;
    src.add(srcRing);
    this.scene.add(src);

    // Floating badge: F value + status text (+ great-circle km while hovered/focused),
    // anchored to the arc apex by a thin leader line.
    const el = document.createElement("div");
    el.className = "link-label";
    const fEl = document.createElement("div"); fEl.className = "link-label__f";
    const sEl = document.createElement("div"); sEl.className = "link-label__status";
    const kEl = document.createElement("div"); kEl.className = "link-label__km";
    el.append(fEl, sEl, kEl);
    const label = new CSS2DObject(el);
    const apex = curve.getPoints(80).reduce((best, p) => (p.y > best.y ? p : best));
    // Push the badge outwards from the centre of the main triangle so the three badges
    // do not pile up on top of each other (the cities are only ~1 unit apart).
    const main = Object.values(this.cities).filter((c) => !c.data.challenge);
    const cen = main.reduce((acc, c) => acc.add(c.pos), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, main.length));
    const out = new THREE.Vector3(apex.x - cen.x, 0, apex.z - cen.z);
    if (out.lengthSq() > 1e-6) out.normalize().multiplyScalar(0.9);
    const badgePos = apex.clone().add(out).add(new THREE.Vector3(0, 0.6, 0));
    label.position.copy(badgePos);
    this.scene.add(label);
    const leader = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([apex, badgePos.clone().sub(new THREE.Vector3(0, 0.12, 0))]),
      new THREE.LineBasicMaterial({ color: COLORS.linkIdle, transparent: true, opacity: 0.8 })
    );
    this.scene.add(leader);

    const km = haversineKm(ca.data.lat, ca.data.lon, cb.data.lat, cb.data.lon);
    const entry = {
      id, tube, hit, src, srcRing, uniforms, curve, a: aId, b: bId, km, geo: linkData,
      F: null, status: null, photons: null, el, fEl, sEl, kEl, leader, label, dim: false, baseF: null,
      objs: [tube, hit, src, label, leader],
    };
    this.links[id] = entry;
    this.labelItems.push({ el, link: entry });
    this._renderLinkLabel(this.links[id]);
  }

  _renderLinkLabel(l) {
    const kind = statusKind(l.F, l.status);
    l.fEl.textContent = l.F == null ? "F = —" : `F = ${l.F.toFixed(2)}`;
    setIconText(l.sEl, KIND_ICON[kind], t(`link.${kind}`), 12);
    l.kEl.textContent = t("link.km", { km: Math.round(l.km) });
    l.el.style.setProperty("--lk", "#" + KIND_COLOR[kind].toString(16).padStart(6, "0"));
    l.leader.material.color.setHex(KIND_COLOR[kind]);
  }

  _applyKind(l) {
    const kind = statusKind(l.F, l.status);
    l.uniforms.color.value.setHex(KIND_COLOR[kind]);
    l.uniforms.width.value = KIND_WIDTH[kind];
    l.uniforms.dashed.value = kind === "broken" ? 1 : 0;
    const f = l.F ?? 0.8;
    l.uniforms.intensity.value = (0.6 + 0.9 * f) * (l.dim ? 0.4 : 1);
    l.uniforms.flow.value = 0.4 + 1.0 * f;
    this._renderLinkLabel(l);
  }

  // --- Link states from viz.links ----------------------------------------------
  setLinkStates(vizLinks) {
    if (!vizLinks) return;
    for (const [id, state] of Object.entries(vizLinks)) {
      const link = this.links[id];
      if (!link) continue;
      link.F = state.F ?? null;
      link.status = state.status ?? null;
      this._applyKind(link);
    }
  }

  // --- Photons: Bell pairs leave the middle of the link towards both ends ---------
  emitPhotons(linkId, samples) {
    const link = this.links[linkId];
    if (!link || !samples?.length) return;
    this._disposePhotons(link);
    const pairs = Math.min(samples.length, 16);
    const geo = new THREE.SphereGeometry(0.07, 18, 18);
    // Opaque, saturated colours (no additive blending): parity 0 reads as clear cyan-blue and
    // parity 1 as orange; they stay below the bloom threshold so ACES/bloom do not turn them white.
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute vec3 instanceColor;
        varying vec3 vColor;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        void main() {
          vColor = instanceColor;
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vNormalV = normalize(mat3(modelViewMatrix * instanceMatrix) * normal);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        void main() {
          float facing = max(dot(normalize(vNormalV), normalize(vViewDir)), 0.0);
          vec3 col = vColor * (0.8 + 0.5 * facing);
          col = mix(col, col * 0.35, pow(1.0 - facing, 3.0)); // dark rim = crisp outline
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, pairs * 2);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3; // after the (non depth-writing) tubes so the pairs are never tinted by them
    const colorArr = new Float32Array(pairs * 6);
    const c0 = new THREE.Color(COLORS.photon0), c1 = new THREE.Color(COLORS.photon1);
    const data = [];
    for (let i = 0; i < pairs; i++) {
      const bit = samples[i] & 1;
      const col = bit === 1 ? c1 : c0;
      // Both members of a pair share the colour (same parity sample).
      for (const k of [2 * i, 2 * i + 1]) {
        colorArr[3 * k] = col.r; colorArr[3 * k + 1] = col.g; colorArr[3 * k + 2] = col.b;
      }
      data.push({ phase: i / pairs, speed: 0.16 + (i % 5) * 0.012 });
    }
    geo.setAttribute("instanceColor", new THREE.InstancedBufferAttribute(colorArr, 3));
    this.scene.add(mesh);
    link.photons = { mesh, data, curve: link.curve };
    this._placePhotons(link, 0); // visible immediately, also when motion is reduced
  }

  _placePhotons(link, time) {
    const ph = link.photons;
    if (!ph) return;
    const dummy = this._dummy ?? (this._dummy = new THREE.Object3D());
    for (let i = 0; i < ph.data.length; i++) {
      const p = ph.data[i];
      const s = (p.phase + p.speed * time) % 1; // 0 at the source, 1 at the ends
      const sc = 0.35 + 0.65 * Math.sin(Math.PI * s);
      dummy.scale.setScalar(sc);
      dummy.position.copy(ph.curve.getPointAt(0.5 - 0.5 * s));
      dummy.updateMatrix();
      ph.mesh.setMatrixAt(2 * i, dummy.matrix);
      dummy.position.copy(ph.curve.getPointAt(0.5 + 0.5 * s));
      dummy.updateMatrix();
      ph.mesh.setMatrixAt(2 * i + 1, dummy.matrix);
    }
    ph.mesh.instanceMatrix.needsUpdate = true;
  }

  _disposePhotons(link) {
    if (!link.photons) return;
    this.scene.remove(link.photons.mesh);
    link.photons.mesh.geometry.dispose();
    link.photons.mesh.material.dispose();
    link.photons = null;
  }

  // Back to the neutral state before drawing a new result.
  resetLinks() {
    for (const link of Object.values(this.links)) {
      link.F = link.baseF; // null on the main network; the configured F of a sandbox link
      link.status = null;
      link.dim = false;
      link.el.classList.remove("link-label--route");
      this._applyKind(link);
    }
    this._activeIds.clear();
    this._syncLinkActive();
  }

  clearPhotons() {
    for (const link of Object.values(this.links)) this._disposePhotons(link);
  }

  // --- Camera -------------------------------------------------------------------
  // Scripted move: OrbitControls is disabled while it runs so it completes, then re-enabled.
  _flyTo(target, dist, polar = 0.85) {
    const off = this.camera.position.clone().sub(this.controls.target);
    const az = Math.atan2(off.x, off.z);
    const toPos = new THREE.Vector3(
      target.x + dist * Math.sin(polar) * Math.sin(az),
      target.y + dist * Math.cos(polar),
      target.z + dist * Math.sin(polar) * Math.cos(az)
    );
    this._moveCamera(target.clone(), toPos);
    this.viewMode = "focus";
  }

  _moveCamera(toTarget, toPos) {
    if (this.reducedMotion) {
      this._tween = null;
      this.controls.enabled = true;
      this.controls.target.copy(toTarget);
      this.camera.position.copy(toPos);
      this.camera.lookAt(toTarget);
      this.controls.update();
      return;
    }
    this._tween = {
      t0: performance.now(), dur: 1100,
      fromT: this.controls.target.clone(), toT: toTarget,
      fromP: this.camera.position.clone(), toP: toPos,
    };
    this.controls.enabled = false;
  }

  _stepTween() {
    const tw = this._tween;
    if (!tw) return;
    const u = Math.min(1, (performance.now() - tw.t0) / tw.dur);
    const e = u * u * u * (u * (u * 6 - 15) + 10); // smootherstep
    this.controls.target.lerpVectors(tw.fromT, tw.toT, e);
    this.camera.position.lerpVectors(tw.fromP, tw.toP, e);
    if (u >= 1) {
      this._tween = null;
      this.controls.enabled = true;
    }
  }

  focusCity(cityId) {
    const c = this.cities[cityId];
    if (!c) return;
    this._flyTo(c.pos, 7);
  }

  focusLink(linkId) {
    const link = this.links[linkId];
    if (!link) return;
    const mid = link.curve.getPointAt(0.5);
    const target = new THREE.Vector3(mid.x, Math.max(0, mid.y - 0.5), mid.z);
    this._flyTo(target, THREE.MathUtils.clamp(4.5 + link.curve.getLength() * 1.6, 7, 13));
  }

  // Named views: "region" (everything around Colombia) and "network" (the three cities).
  viewRegion() {
    this._moveCamera(this.views.region.target.clone(), this.views.region.position.clone());
    this.viewMode = "region";
    return this.viewMode;
  }

  viewNetwork() {
    this._moveCamera(this.views.network.target.clone(), this.views.network.position.clone());
    this.viewMode = "network";
    return this.viewMode;
  }

  toggleRegion() {
    return this.viewMode === "region" ? this.viewNetwork() : this.viewRegion();
  }

  highlightLink(linkId) {
    this._activeIds = new Set(linkId ? [linkId] : []);
    this._syncLinkActive();
  }

  _syncLinkActive() {
    for (const l of Object.values(this.links)) {
      l.el.classList.toggle("is-active", this._activeIds.has(l.id) || l.id === this._hoverLinkId);
    }
  }

  // --- Sandbox (chapter 9): user-built network drawn with the same node/link visuals ------
  // While active, this.cities / this.links hold the SANDBOX objects (so hover, photons, states and
  // camera helpers work unchanged) and the main network is stashed in this._main, hidden.
  get sandboxActive() {
    return !!this._main;
  }

  _enterSandbox() {
    if (this._main) return;
    this.clearPhotons();
    this.resetLinks();
    for (const c of Object.values(this.cities)) {
      c.group.visible = false;
      c.label.visible = false;
    }
    for (const l of Object.values(this.links)) for (const o of l.objs) o.visible = false;
    this._main = { cities: this.cities, links: this.links };
    this.cities = {};
    this.links = {};
    this._hoverLinkId = null;
    this._hoveredKey = null;
    for (const cb of this.hoverHandlers) cb(null); // hide any open tooltip
    this._activeIds = new Set();
  }

  _disposeObject(o) {
    o.traverse((c) => {
      c.geometry?.dispose?.();
      const m = c.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose?.();
    });
    this.scene.remove(o);
  }

  // Removes every sandbox object (geometry, material, HTML labels, label-collision entries).
  _disposeSandboxObjects() {
    const gone = new Set();
    for (const c of Object.values(this.cities)) {
      gone.add(c.label.element);
      this._disposeObject(c.group);
      c.label.element.remove();
    }
    for (const l of Object.values(this.links)) {
      this._disposePhotons(l);
      gone.add(l.el);
      for (const o of l.objs) this._disposeObject(o);
      l.el.remove();
    }
    this.cities = {};
    this.links = {};
    this.labelItems = this.labelItems.filter((it) => !gone.has(it.el));
  }

  // nodes: [{id, name, lat, lon}], links: [{a, b, F}]. Replaces the previous sandbox drawing.
  setSandbox(nodes, links) {
    this._enterSandbox();
    this._disposeSandboxObjects();
    for (const n of nodes) this._buildCity(n.id, { name: n.name, lat: n.lat, lon: n.lon, sandbox: true });
    for (const l of links) {
      const ca = this.cities[l.a], cb = this.cities[l.b];
      if (!ca || !cb) continue;
      const fibre = haversineKm(ca.data.lat, ca.data.lon, cb.data.lat, cb.data.lon) * 1.3; // info only
      this._buildLink({ id: `${l.a}-${l.b}`, a: l.a, b: l.b, F: l.F, length_km: fibre, eta: 10 ** (-0.02 * fibre) });
      const built = this.links[`${l.a}-${l.b}`];
      if (!built) continue;
      built.baseF = l.F;
      built.F = l.F;
      this._applyKind(built);
    }
    this._retext();
  }

  // Back to the main network: sandbox objects are disposed, the main ones shown again.
  leaveSandbox() {
    if (!this._main) return;
    this.setPickMode(false);
    this._disposeSandboxObjects();
    this.cities = this._main.cities;
    this.links = this._main.links;
    this._main = null;
    for (const c of Object.values(this.cities)) {
      c.group.visible = true;
      c.label.visible = true;
    }
    for (const l of Object.values(this.links)) for (const o of l.objs) o.visible = true;
    this._hoverLinkId = null;
    this._hoveredKey = null;
    for (const cb of this.hoverHandlers) cb(null); // hide any open tooltip
    this._activeIds = new Set();
    this.resetLinks();
  }

  // id of the sandbox link between two nodes, in either orientation (or null).
  findLinkId(a, b) {
    if (this.links[`${a}-${b}`]) return `${a}-${b}`;
    if (this.links[`${b}-${a}`]) return `${b}-${a}`;
    return null;
  }

  // Highlights a route (badges) and dims the links that are not part of it.
  emphasizeRoute(linkIds) {
    const set = new Set(linkIds);
    for (const l of Object.values(this.links)) {
      l.dim = set.size > 0 && !set.has(l.id);
      l.el.classList.toggle("link-label--route", set.has(l.id));
      this._applyKind(l);
    }
    this._activeIds = set;
    this._syncLinkActive();
  }

  focusNodes(ids) {
    const pts = ids.map((id) => this.cities[id]?.pos).filter(Boolean);
    if (!pts.length) return;
    const cen = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
    const r = pts.reduce((m, p) => Math.max(m, p.distanceTo(cen)), 0);
    this._flyTo(new THREE.Vector3(cen.x, 0.15, cen.z), THREE.MathUtils.clamp(7 + r * 2.4, 8, 22));
  }

  // Click-to-place: while on, a click (not a drag) on the terrain calls cb({lat, lon, elevation_m}).
  setPickMode(on, cb = null) {
    this._pickCb = on ? cb : null;
    this.renderer.domElement.style.cursor = on ? "crosshair" : "";
  }

  _pickTerrain(e) {
    const el = this.renderer.domElement;
    const rect = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.terrain, false)[0];
    if (!hit) return null;
    const { lat, lon } = fromScene(hit.point.x, hit.point.z);
    return { lat, lon, elevation_m: elevationM(lat, lon) };
  }

  // --- Pointer / hover ----------------------------------------------------------
  _bindPointer() {
    const el = this.renderer.domElement;
    el.addEventListener("pointermove", (e) => {
      const rect = el.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this._lastPointerClient = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener("pointerleave", () => {
      this._lastPointerClient = null;
    });
    // A click that is not a drag (OrbitControls uses drags) places a node when pick mode is on.
    let down = null;
    el.addEventListener("pointerdown", (e) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    });
    el.addEventListener("pointerup", (e) => {
      const d = down;
      down = null;
      if (!d || !this._pickCb) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || performance.now() - d.t > 700) return;
      const p = this._pickTerrain(e);
      this._pickCb(p);
    });
  }

  onHover(cb) {
    this.hoverHandlers.push(cb);
  }

  _checkHover() {
    let hovered = null;
    if (this._lastPointerClient) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const cities = Object.entries(this.cities);
      const cHits = this.raycaster.intersectObjects(cities.map(([, c]) => c.hit), false);
      if (cHits.length) {
        const [id, c] = cities.find(([, x]) => x.hit === cHits[0].object);
        hovered = { type: "city", id, data: c.data };
      } else {
        const links = Object.values(this.links);
        const lHits = this.raycaster.intersectObjects(links.map((l) => l.hit), false);
        if (lHits.length) {
          const l = links.find((x) => x.hit === lHits[0].object);
          hovered = { type: "link", id: l.id, data: this.linkInfo(l.id) };
        }
      }
    }
    const key = hovered ? `${hovered.type}:${hovered.id}` : null;
    if (key !== this._hoveredKey) {
      this._hoveredKey = key;
      this._hoverLinkId = hovered?.type === "link" ? hovered.id : null;
      this._syncLinkActive();
      for (const cb of this.hoverHandlers) cb(hovered && { ...hovered, client: this._lastPointerClient });
    } else if (hovered) {
      for (const cb of this.hoverHandlers) cb({ ...hovered, client: this._lastPointerClient });
    }
  }

  // Plain data about a link for tooltips (lengths, last F and status).
  linkInfo(linkId) {
    const l = this.links[linkId];
    if (!l) return null;
    const ca = this.cities[l.a].data, cb = this.cities[l.b].data;
    return {
      id: l.id, from: ca.name, to: cb.name, great_circle_km: l.km,
      length_km: l.geo.length_km, eta: l.geo.eta, F: l.F, kind: statusKind(l.F, l.status),
    };
  }

  _bindResize() {
    this._onResize = () => {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (!w || !h) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.labelRenderer.setSize(w, h);
      this.composer.setSize(w, h);
    };
    window.addEventListener("resize", this._onResize);
  }

  _animate = () => {
    this._raf = requestAnimationFrame(this._animate);
    this.clock.getDelta();
    if (this._idle && this._frame++ % 30 !== 0) return; // ~2 fps behind the leak view
    const time = this.reducedMotion ? 0 : this.clock.elapsedTime;

    if (this.seaUniforms) this.seaUniforms.time.value = time;

    for (const c of Object.values(this.cities)) {
      const k = (time * 0.6 + c.pos.x * 0.3) % 1; // expanding ring
      c.pulse.scale.setScalar(this.reducedMotion ? 1 : 0.8 + 0.5 * k);
      c.pulse.material.opacity = this.reducedMotion ? 0.4 : 0.5 * (1 - k);
      c.core.rotation.y = time * 0.8;
      c.core.position.y = NODE_LIFT + (this.reducedMotion ? 0 : 0.015 * Math.sin(time * 2 + c.pos.x));
    }

    for (const link of Object.values(this.links)) {
      link.uniforms.time.value = time;
      const k = this.reducedMotion ? 0.5 : (time * 0.7) % 1;
      link.srcRing.scale.setScalar(0.85 + 0.6 * k);
      link.srcRing.material.opacity = this.reducedMotion ? 0.9 : 0.9 * (1 - k);
      if (link.photons && !this.reducedMotion) this._placePhotons(link, time);
    }

    if (this.borderLine) { // thinner/dimmer border when close
      const d = this.camera.position.distanceTo(this.controls.target);
      this.borderLine.material.opacity = THREE.MathUtils.clamp((d - 6) / 18, 0.08, 0.5);
    }
    this._stepTween();
    this._checkHover();
    this.controls.update();
    // Keep the view over the map: clamp the orbit target (and drag the camera with it).
    const tg = this.controls.target;
    const cx = THREE.MathUtils.clamp(tg.x, -9, 9), cz = THREE.MathUtils.clamp(tg.z, -6.5, 7.5);
    if (cx !== tg.x || cz !== tg.z) {
      this.camera.position.x += cx - tg.x;
      this.camera.position.z += cz - tg.z;
      tg.x = cx;
      tg.z = cz;
    }
    this.composer.render();
    this.labelRenderer.render(this.scene, this.camera);
    if (this._frame++ % 6 === 0) this._cullLabels();
  };

  // Screen-space label collision culling: highest priority first, a label that overlaps an
  // already accepted one is hidden (visibility only, so layout and CSS2D stay untouched).
  // All rects are read first, then visibility is written (no layout thrash); arrays are reused.
  _cullLabels() {
    const items = this.labelItems;
    const n = items.length;
    if (!this._cull || this._cull.n !== n) {
      this._cull = { n, rect: new Float32Array(n * 4), live: new Uint8Array(n), prio: new Int16Array(n), order: Array.from({ length: n }, (_, i) => i), keptIdx: new Int16Array(n) };
    }
    const { rect, live, prio, order, keptIdx } = this._cull;
    const view = this.container.getBoundingClientRect();
    for (let i = 0; i < n; i++) { // read phase
      const it = items[i];
      const r = it.el.getBoundingClientRect();
      rect[4 * i] = r.left; rect[4 * i + 1] = r.top; rect[4 * i + 2] = r.right; rect[4 * i + 3] = r.bottom;
      live[i] = it.el.style.display !== "none" && r.width > 0 && r.right > view.left && r.left < view.right && r.bottom > view.top && r.top < view.bottom ? 1 : 0;
      prio[i] = it.link ? (this._activeIds.has(it.link.id) || it.link.id === this._hoverLinkId ? 0 : 1) : it.prio;
    }
    // insertion sort of the persistent index array by (priority, index): no allocation
    for (let i = 1; i < n; i++) {
      const v = order[i];
      let j = i - 1;
      while (j >= 0 && (prio[order[j]] > prio[v] || (prio[order[j]] === prio[v] && order[j] > v))) { order[j + 1] = order[j]; j--; }
      order[j + 1] = v;
    }
    const PAD = 4;
    let nk = 0;
    for (let q = 0; q < n; q++) { // decide phase (pure arithmetic)
      const i = order[q];
      let ok = live[i] === 1;
      if (ok) {
        const l = rect[4 * i], t = rect[4 * i + 1], r = rect[4 * i + 2], b = rect[4 * i + 3];
        for (let k = 0; k < nk; k++) {
          const o = keptIdx[k] * 4;
          if (l < rect[o + 2] + PAD && r + PAD > rect[o] && t < rect[o + 3] + PAD && b + PAD > rect[o + 1]) { ok = false; break; }
        }
      }
      if (ok) keptIdx[nk++] = i;
      live[i] = ok ? 2 : 0;
    }
    for (let i = 0; i < n; i++) { // write phase
      const it = items[i];
      const ok = live[i] === 2;
      if (it._vis !== ok) { it.el.style.visibility = ok ? "visible" : "hidden"; it._vis = ok; }
      if (it.link) it.link.leader.visible = ok;
    }
  }

  // While the leak view covers the map there is nothing to see: render rarely.
  setIdle(v) {
    this._idle = !!v;
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener("resize", this._onResize);
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
