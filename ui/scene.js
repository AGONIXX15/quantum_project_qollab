/*
  Escena 3D de alta calidad de la red cuántica (three.js + postprocesado).

  Capas visuales:
    - Terreno de Colombia con relieve procedural (Andes, Sierra Nevada, llanos),
      coloreado por altura (selva -> roca -> nieve) y recortado por el contorno
      real del país. Alrededor, un mar con shader de olas animadas.
    - Cielo/atmósfera con degradado y niebla para dar profundidad.
    - Ciudades como nodos luminosos con halo, pilar de luz y etiqueta HTML nítida.
    - Enlaces de fibra como tubos con shader de flujo de energía, coloreados por
      fidelidad/estado.
    - Fotones (pares de Bell) como InstancedMesh: miles a 60fps. Azul = paridad 0
      (iguales, sano), naranja = paridad 1 (error).
    - Postprocesado: Bloom (todo lo luminoso resplandece) + tone mapping ACES.

  Coordenadas: project() de colombia-geo.js (x este, z sur), igual que el backend.
  Todo se carga por import map; sin assets binarios, portable a Qollab.
*/

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

import { project, unproject, elevation, insideColombia, OUTLINE } from "./colombia-geo.js";

const COLORS = {
  city: 0x2fe0c0,          // turquesa (nodo principal)
  cityChallenge: 0xffc23d, // ámbar dorado (ciudad reto)
  linkHealthy: 0x2fe0c0,   // turquesa
  linkDegraded: 0xf5a623,  // ámbar
  linkBroken: 0xff5a6e,    // coral
  linkRescued: 0x7ef29a,   // verde menta
  photon0: 0x58d8ff,       // paridad 0 (iguales): cian brillante
  photon1: 0xff7a1a,       // paridad 1 (error): naranja cálido e intenso
};

const WORLD = 6;            // escala del mundo (coords de proyección ~[-1,1])
const TERRAIN_SPAN = WORLD * 2.6;
const SEG = 180;            // resolución de la malla del terreno (balance calidad/fps)
const HEIGHT_SCALE = 0.42;  // km -> unidades de escena

// Same thresholds as the legend: healthy F >= 0.9, degraded 0.6-0.9, broken below.
export function classifyFidelity(F) {
  if (F == null) return "healthy";
  if (F >= 0.9) return "healthy";
  if (F >= 0.6) return "degraded";
  return "broken";
}

function fidelityColor(F, status) {
  if (status === "broken" || status === "damaged") return COLORS.linkBroken;
  if (status === "rescued") return COLORS.linkRescued;
  const c = classifyFidelity(F);
  return c === "healthy" ? COLORS.linkHealthy : c === "degraded" ? COLORS.linkDegraded : COLORS.linkBroken;
}

// Altura de escena en (x,z) a partir del heightmap procedural.
function terrainHeight(x, z) {
  const { lat, lon } = unproject(x / WORLD, z / WORLD);
  const inside = insideColombia(lat, lon);
  const e = elevation(lat, lon);
  // Fuera del país el fondo se hunde bajo el mar (así el borde cuadrado del
  // plano queda sumergido y no se ve); dentro, el relieve se eleva.
  return inside ? e * HEIGHT_SCALE : -0.6;
}

export class NetworkScene {
  constructor(container, labelLayer) {
    this.container = container;
    this.labelLayer = labelLayer;
    this.cities = {};
    this.links = {};
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hoverHandlers = [];

    // prefers-reduced-motion: static render (no photon flow, waves, pulses or auto-rotation).
    this._motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    this.reducedMotion = !!this._motionQuery?.matches;
    this._motionQuery?.addEventListener?.("change", (e) => {
      this.reducedMotion = e.matches;
      if (e.matches) this.controls.autoRotate = false;
    });

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._initLights();
    this._initComposer();
    this._initSky();
    this._buildTerrain();
    this._buildSea();
    this._bindResize();
    this._bindPointer();
    this._animate();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // Renderer de etiquetas HTML (nítidas, no pixeladas).
    this.labelRenderer = new CSS2DRenderer({ element: this.labelLayer });
    this.labelRenderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    // Fondo "atardecer andino": azul petróleo profundo, cálido hacia el horizonte.
    this.scene.background = new THREE.Color(0x121a2b);
    this.scene.fog = new THREE.FogExp2(0x1a2338, 0.022);
  }

  _initCamera() {
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(48, aspect, 0.1, 200);
    this.camera.position.set(2.5, 10, 11);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 30;
    this.controls.maxPolarAngle = Math.PI / 2.05;
    this.controls.target.set(0, 0.4, 0);
    this.controls.autoRotate = !this.reducedMotion;
    this.controls.autoRotateSpeed = 0.25;
    // Al interactuar, se detiene la rotación automática.
    this.controls.addEventListener("start", () => (this.controls.autoRotate = false));
  }

  _initLights() {
    // Cielo malva-durazno, suelo tierra cálida.
    this.scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x2a1d14, 0.75));
    // Sol de atardecer: luz dorada rasante (ilumina el relieve lateralmente).
    const sun = new THREE.DirectionalLight(0xffd9a0, 2.4);
    sun.position.set(10, 9, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.bias = -0.0003;
    this.scene.add(sun);
    // Relleno frío desde el lado opuesto (contraluz azulado del cielo).
    const fill = new THREE.PointLight(0x4e78c8, 0.55, 60);
    fill.position.set(-9, 7, -9);
    this.scene.add(fill);
  }

  _initComposer() {
    const size = new THREE.Vector2(this.container.clientWidth, this.container.clientHeight);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // strength bajo + threshold alto: solo lo MUY brillante (fotones, núcleos
    // pequeños) resplandece, sin lavar el centro del mapa.
    this.bloom = new UnrealBloomPass(size, 0.42, 0.65, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  // Cielo: domo con degradado vertical por shader.
  _initSky() {
    // Degradado de atardecer en tres zonas: cenit azul profundo, cielo medio
    // malva, horizonte durazno cálido.
    const uniforms = {
      zenith: { value: new THREE.Color(0x14213f) },
      mid: { value: new THREE.Color(0x3b3a63) },
      horizon: { value: new THREE.Color(0xd98b63) },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(90, 32, 20),
      new THREE.ShaderMaterial({
        uniforms,
        side: THREE.BackSide,
        depthWrite: false,
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
            float h = normalize(vWorld).y;         // -1..1
            float t = clamp(h, 0.0, 1.0);
            // Horizonte -> medio en la primera mitad, medio -> cenit en la segunda.
            vec3 col = (t < 0.4)
              ? mix(horizon, mid, smoothstep(0.0, 0.4, t))
              : mix(mid, zenith, smoothstep(0.4, 1.0, t));
            gl_FragColor = vec4(col, 1.0);
          }`,
      })
    );
    this.scene.add(sky);
  }

  // Terreno de Colombia: malla deformada por el heightmap, coloreada como un
  // mapa físico (color por ALTURA y PENDIENTE) para que se vea realista.
  _buildTerrain() {
    const geo = new THREE.PlaneGeometry(TERRAIN_SPAN, TERRAIN_SPAN, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;

    // Paleta tipo mapa físico (de bajo a alto).
    const cCoast = new THREE.Color(0x3a5a3a);  // verde costa/húmedo
    const cJungle = new THREE.Color(0x2f6b3a); // selva
    const cPlain = new THREE.Color(0x5c7f3e);  // planicie / sabana
    const cFoot = new THREE.Color(0x8a7d45);   // piedemonte ocre
    const cRock = new THREE.Color(0x7d6b55);   // roca
    const cHigh = new THREE.Color(0x9a9282);   // alta montaña
    const cSnow = new THREE.Color(0xf4f6fb);   // nieve
    const cSlope = new THREE.Color(0x5c4e3a);  // laderas empinadas (tierra/roca)
    const maxH = 3.6 * HEIGHT_SCALE;

    // Alturas en una grilla para calcular pendiente por diferencias finitas.
    const span = TERRAIN_SPAN;
    const nx = SEG + 1;
    const h = (ix, iz) => {
      const x = -span / 2 + (span * ix) / SEG;
      const z = -span / 2 + (span * iz) / SEG;
      return terrainHeight(x, z);
    };

    const colors = new Float32Array(pos.count * 3);
    const tmp = new THREE.Color();
    const cell = span / SEG;
    for (let iz = 0; iz <= SEG; iz++) {
      for (let ix = 0; ix <= SEG; ix++) {
        const i = iz * nx + ix;
        const H = h(ix, iz);
        pos.setY(i, H);

        if (H <= 0.001) {
          // Franja costera (bajo nivel del mar o justo en la orilla).
          tmp.copy(cCoast);
        } else {
          // Pendiente: magnitud del gradiente de altura.
          const hx = h(Math.min(ix + 1, SEG), iz) - h(Math.max(ix - 1, 0), iz);
          const hz = h(ix, Math.min(iz + 1, SEG)) - h(ix, Math.max(iz - 1, 0));
          const slope = Math.min(1, Math.hypot(hx, hz) / (cell * 2.2));

          const t = Math.min(1, H / maxH);
          // Color base por altura.
          if (t < 0.1) tmp.copy(cJungle).lerp(cPlain, t / 0.1);
          else if (t < 0.35) tmp.copy(cPlain).lerp(cFoot, (t - 0.1) / 0.25);
          else if (t < 0.6) tmp.copy(cFoot).lerp(cRock, (t - 0.35) / 0.25);
          else if (t < 0.82) tmp.copy(cRock).lerp(cHigh, (t - 0.6) / 0.22);
          else tmp.copy(cHigh).lerp(cSnow, (t - 0.82) / 0.18);

          // Laderas empinadas: tierra/roca expuesta (menos vegetación, sin nieve).
          const slopeMix = slope * (t < 0.82 ? 0.75 : 0.35);
          tmp.lerp(cSlope, slopeMix);
          // Variación sutil para romper lo uniforme.
          const n = (Math.sin(ix * 0.7) * Math.cos(iz * 0.6)) * 0.03;
          tmp.offsetHSL(0, 0, n);
        }
        colors[i * 3] = tmp.r;
        colors[i * 3 + 1] = tmp.g;
        colors[i * 3 + 2] = tmp.b;
      }
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1.0,
      metalness: 0.0,
    });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);

    // Línea de costa/frontera, discreta y cálida (no neón).
    const outlinePts = OUTLINE.map(([lat, lon]) => {
      const p = project(lat, lon);
      return new THREE.Vector3(p.x * WORLD, 0.04, p.z * WORLD);
    });
    const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePts);
    const outline = new THREE.Line(
      outlineGeo,
      new THREE.LineBasicMaterial({ color: 0xf0e2c8, transparent: true, opacity: 0.35 })
    );
    this.scene.add(outline);
  }

  // Mar sobrio: olas de baja amplitud, color por profundidad, reflejo del cielo
  // (fresnel) y brillo especular del sol. Sin espuma exagerada.
  _buildSea() {
    this.seaUniforms = {
      time: { value: 0 },
      colorDeep: { value: new THREE.Color(0x0a2238) },
      colorShallow: { value: new THREE.Color(0x1d4a63) },
      skyTint: { value: new THREE.Color(0xd98b63) }, // reflejo cálido del horizonte
      sunDir: { value: new THREE.Vector3(10, 9, 5).normalize() },
    };
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 220, 128, 128),
      new THREE.ShaderMaterial({
        uniforms: this.seaUniforms,
        transparent: true,
        vertexShader: `
          uniform float time;
          varying float vWave;
          varying vec3 vWorld;
          void main() {
            vec3 p = position;
            // Olas suaves (amplitud pequeña) combinando varias frecuencias.
            float w = sin(p.x * 0.5 + time * 0.6) * 0.012
                    + cos(p.y * 0.65 + time * 0.5) * 0.010
                    + sin((p.x * 0.9 + p.y * 0.7) + time * 0.35) * 0.008;
            p.z += w;
            vWave = w;
            vec4 wp = modelMatrix * vec4(p, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: `
          uniform vec3 colorDeep; uniform vec3 colorShallow; uniform vec3 skyTint;
          uniform vec3 sunDir; uniform float time;
          varying float vWave;
          varying vec3 vWorld;
          void main() {
            // Normal aproximada de la ola para iluminación.
            float nx = cos(vWorld.x * 0.5 + time * 0.6) * 0.5;
            float nz = -sin(vWorld.z * 0.65 + time * 0.5) * 0.5;
            vec3 n = normalize(vec3(nx, 1.0, nz));
            vec3 viewDir = normalize(cameraPosition - vWorld);
            // Fresnel: a vista rasante refleja el cielo cálido.
            float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
            vec3 base = mix(colorDeep, colorShallow, smoothstep(-0.015, 0.015, vWave));
            vec3 col = mix(base, skyTint, fres * 0.6);
            // Especular suave del sol (reflejo del atardecer en el agua).
            vec3 h = normalize(viewDir + normalize(sunDir));
            float spec = pow(max(dot(n, h), 0.0), 60.0);
            col += vec3(1.0, 0.85, 0.6) * spec * 0.5;
            gl_FragColor = vec4(col, 0.95);
          }`,
      })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.06;
    this.scene.add(sea);
  }

  _toWorld(x, z, y = 0) {
    return new THREE.Vector3(x * WORLD, y, z * WORLD);
  }

  // --- Construcción desde la geografía del backend -------------------------
  buildFromGeo(geo) {
    for (const [id, c] of Object.entries(geo.cities)) {
      this._buildCity(id, c);
    }
    for (const link of geo.links) {
      this._buildLink(link.id, link.a, link.b);
    }
  }

  _cityWorldPos(c) {
    // Altura del terreno en la ciudad + un pequeño offset para apoyar el nodo.
    const wx = c.x * WORLD;
    const wz = c.z * WORLD;
    const h = Math.max(0.05, terrainHeight(wx, wz));
    return new THREE.Vector3(wx, h, wz);
  }

  _buildCity(id, c) {
    const pos = this._cityWorldPos(c);
    const color = c.challenge ? COLORS.cityChallenge : COLORS.city;
    const group = new THREE.Group();
    group.position.copy(pos);

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.1, 2),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.75,
        roughness: 0.35,
        metalness: 0.1,
      })
    );
    core.castShadow = true;
    group.add(core);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 24, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false })
    );
    group.add(halo);

    // Anillo plano en la base (plataforma).
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.21, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.08;
    group.add(ring);

    // Pilar de luz, fino y tenue (solo una pista vertical, no un foco).
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.009, 0.009, 2.2, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false })
    );
    beam.position.y = 1.1;
    group.add(beam);

    // Etiqueta HTML nítida.
    const el = document.createElement("div");
    el.className = "city-label" + (c.challenge ? " city-label--challenge" : "");
    el.textContent = c.name;
    const label = new CSS2DObject(el);
    label.position.set(0, 0.5, 0);
    group.add(label);

    this.scene.add(group);
    this.cities[id] = { group, halo, core, pos, data: c, color };
  }

  _buildLink(id, aId, bId) {
    const a = this.cities[aId]?.pos;
    const b = this.cities[bId]?.pos;
    if (!a || !b) return;

    // Curva que se arquea sobre el relieve (varios puntos de control siguiendo
    // el terreno, elevados para no atravesar montañas).
    const pts = [];
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = THREE.MathUtils.lerp(a.x, b.x, t);
      const z = THREE.MathUtils.lerp(a.z, b.z, t);
      const ground = Math.max(0, terrainHeight(x, z));
      const arc = Math.sin(Math.PI * t) * a.distanceTo(b) * 0.14;
      pts.push(new THREE.Vector3(x, ground + 0.18 + arc, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts);

    const uniforms = {
      time: { value: 0 },
      color: { value: new THREE.Color(COLORS.linkHealthy) },
      intensity: { value: 1.0 },
      flow: { value: 1.0 },
    };
    const tubeGeo = new THREE.TubeGeometry(curve, 80, 0.03, 10, false);
    const mat = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float time; uniform vec3 color; uniform float intensity; uniform float flow;
        varying vec2 vUv;
        void main() {
          // Pulsos de energía viajando a lo largo del tubo (vUv.x).
          float pulse = sin((vUv.x * 18.0 - time * flow * 3.0)) * 0.5 + 0.5;
          pulse = pow(pulse, 2.5);
          float core = 0.45 + 0.55 * pulse;
          vec3 col = color * (0.6 + 0.9 * core) * intensity;
          gl_FragColor = vec4(col, 0.55 + 0.4 * core);
        }`,
    });
    const tube = new THREE.Mesh(tubeGeo, mat);
    this.scene.add(tube);

    this.links[id] = { tube, uniforms, curve, F: null, status: "healthy", photons: null, a: aId, b: bId };
  }

  // --- Estado de enlaces desde viz.links -----------------------------------
  setLinkStates(vizLinks) {
    if (!vizLinks) return;
    for (const [id, state] of Object.entries(vizLinks)) {
      const link = this.links[id];
      if (!link) continue;
      const color = fidelityColor(state.F, state.status);
      link.uniforms.color.value.setHex(color);
      link.F = state.F ?? null;
      link.status = state.status ?? "healthy";
      const f = state.F ?? 1;
      link.uniforms.intensity.value = 0.6 + 0.9 * f;
      // Enlaces malos: flujo más lento y errático.
      link.uniforms.flow.value = 0.4 + 1.0 * f;
    }
  }

  // --- Fotones instanciados -------------------------------------------------
  // InstancedMesh con un ShaderMaterial que lee `instanceColor` por instancia y
  // añade un glow radial. Los colores van en HDR (>1) para que el bloom haga que
  // tanto el cian como el naranja brillen de verdad (antes salían apagados/negros
  // porque un MeshBasicMaterial con vertexColors no usa instanceColor).
  emitPhotons(linkId, samples) {
    const link = this.links[linkId];
    if (!link || !samples?.length) return;
    if (link.photons) {
      this.scene.remove(link.photons.mesh);
      link.photons.mesh.geometry.dispose();
      link.photons.mesh.material.dispose();
    }
    const n = Math.min(samples.length, 60);
    const geo = new THREE.SphereGeometry(0.07, 16, 16);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
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
          // Núcleo brillante + borde (fresnel) que irradia -> glow para el bloom.
          float facing = max(dot(normalize(vNormalV), normalize(vViewDir)), 0.0);
          float core = pow(facing, 1.2);
          float rim = pow(1.0 - facing, 2.0);
          vec3 col = vColor * (0.9 + 1.6 * core) + vColor * rim * 1.2;
          float alpha = clamp(core + rim * 0.8, 0.0, 1.0);
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false;
    // Atributo de color por instancia que el shader lee directamente.
    const colorArr = new Float32Array(n * 3);
    const c0 = new THREE.Color(COLORS.photon0);
    const c1 = new THREE.Color(COLORS.photon1);
    const data = [];
    for (let i = 0; i < n; i++) {
      const bit = samples[i] & 1;
      const col = bit === 1 ? c1 : c0;
      colorArr[i * 3] = col.r;
      colorArr[i * 3 + 1] = col.g;
      colorArr[i * 3 + 2] = col.b;
      data.push({ t: i / n, speed: 0.12 + Math.random() * 0.05, bit });
    }
    geo.setAttribute("instanceColor", new THREE.InstancedBufferAttribute(colorArr, 3));
    this.scene.add(mesh);
    link.photons = { mesh, data, curve: link.curve };
  }

  // Back to the neutral state before drawing a new result.
  resetLinks() {
    for (const link of Object.values(this.links)) {
      link.uniforms.color.value.setHex(COLORS.linkHealthy);
      link.uniforms.intensity.value = 1.0;
      link.uniforms.flow.value = 1.0;
      link.F = null;
      link.status = "healthy";
    }
  }

  clearPhotons() {
    for (const link of Object.values(this.links)) {
      if (!link.photons) continue;
      this.scene.remove(link.photons.mesh);
      link.photons.mesh.geometry.dispose();
      link.photons.mesh.material.dispose();
      link.photons = null;
    }
  }

  // Keyboard / list access: look at a city.
  focusCity(cityId) {
    const c = this.cities[cityId];
    if (!c) return;
    this.controls.target.lerp(c.pos, 0.6);
  }

  highlightLink(linkId) {
    this.activeLink = linkId;
  }

  // --- Interacción (hover para tooltips) -----------------------------------
  _bindPointer() {
    this.renderer.domElement.addEventListener("pointermove", (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this._lastPointerClient = { x: e.clientX, y: e.clientY };
    });
  }

  onHover(cb) {
    this.hoverHandlers.push(cb);
  }

  _checkHover() {
    if (!this._lastPointerClient) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const cores = Object.entries(this.cities).map(([id, c]) => ({ id, mesh: c.core, data: c.data }));
    const hits = this.raycaster.intersectObjects(cores.map((c) => c.mesh), false);
    let hovered = null;
    if (hits.length) {
      const hit = cores.find((c) => c.mesh === hits[0].object);
      if (hit) hovered = { type: "city", id: hit.id, data: hit.data, client: this._lastPointerClient };
    }
    if (hovered?.id !== this._hoveredId) {
      this._hoveredId = hovered?.id ?? null;
      for (const cb of this.hoverHandlers) cb(hovered);
    } else if (hovered) {
      hovered.client = this._lastPointerClient;
      for (const cb of this.hoverHandlers) cb(hovered);
    }
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
    const delta = this.clock.getDelta();
    // Reduced motion: time stands still, so everything is a static frame.
    const dt = this.reducedMotion ? 0 : delta;
    const t = this.reducedMotion ? 0 : this.clock.elapsedTime;

    if (this.seaUniforms) this.seaUniforms.time.value = t;

    for (const c of Object.values(this.cities)) {
      const s = 1 + 0.1 * Math.sin(t * 2 + c.pos.x);
      c.halo.scale.setScalar(s);
      c.core.rotation.y += dt * 0.5;
    }

    const dummy = new THREE.Object3D();
    for (const link of Object.values(this.links)) {
      link.uniforms.time.value = t;
      const ph = link.photons;
      if (!ph) continue;
      for (let i = 0; i < ph.data.length; i++) {
        const p = ph.data[i];
        p.t = (p.t + p.speed * dt) % 1;
        const pos = ph.curve.getPointAt(p.t);
        dummy.position.copy(pos);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        ph.mesh.setMatrixAt(i, dummy.matrix);
      }
      ph.mesh.instanceMatrix.needsUpdate = true;
    }

    this._checkHover();
    this.controls.update();
    this.composer.render();
    this.labelRenderer.render(this.scene, this.camera);
  };

  // Vuela la cámara a enfocar un enlace (usado al cambiar de nivel).
  focusLink(linkId) {
    const link = this.links[linkId];
    if (!link) return;
    const mid = link.curve.getPointAt(0.5);
    this.controls.target.lerp(mid, 0.6);
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
