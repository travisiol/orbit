import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { Surface } from "../planets";
import { massShare, outerRadius, type SystemState } from "../system";
import { systemStore } from "../systemStore";
import { stageAt, stagesFor, uiStore, type Focus, type Stage } from "../ui";
import { environmentTexture, glowTexture, paintSurface, sunTexture } from "./textures";

/**
 * The sky. One renderer, one scene, everything generated at runtime: the
 * Sun and its corona, the planets people have lit with painted surfaces,
 * their orbit paths, the rings a planet grows as its orbits are claimed and
 * the satellites that fly them, the dark candidates nobody has lit yet on
 * dashed orbits, a field of stars and a whisper of dust in the ecliptic.
 *
 * Bodies follow the system store: a planet lit on chain gets a node the
 * next frame, on the next orbit out. The camera is choreographed, never
 * free: the intro dolly from a point of light to the whole system, the
 * scroll journey from body to body, and the slow orbit around whatever
 * body has the focus. Every frame reads the two stores and writes nothing
 * back except the hover and the intro clock.
 */

const MAX_SATS = 48;
const RINGS = 12;
const SUN_RADIUS = 1.32;
const BASE_ORBIT = 3.4;

export type Projected = { key: string; x: number; y: number; radiusPx: number; visible: boolean; depth: number };

type BodyNode = {
  key: string;
  kind: "planet" | "ghost";
  group: THREE.Group;
  mesh: THREE.Mesh;
  rim: THREE.Mesh | null;
  pick: THREE.Mesh;
  rings: THREE.LineLoop[];
  sats: THREE.InstancedMesh;
  satState: { angle: number; speed: number; tilt: number }[];
  path: THREE.LineLoop;
  pathMat: THREE.LineBasicMaterial | THREE.LineDashedMaterial;
  /** Orbit radius it is flying at, eased toward `orbitTarget` when its slot moves. */
  orbit: number;
  orbitTarget: number;
  angle: number;
  speed: number;
  radius: number;
  disposables: { dispose(): void }[];
};

type View = { pos: THREE.Vector3; target: THREE.Vector3 };

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
/** Kepler on screen: HOOD's old orbit (3.4) takes 60 s, farther orbits slower by r^1.5. */
const omegaFor = (orbit: number) => (Math.PI * 2) / (60 * Math.pow(orbit / BASE_ORBIT, 1.5));
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};

const RIM_SHADER = {
  vertex: /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragment: /* glsl */ `
    uniform vec3 color;
    uniform float power;
    uniform float strength;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      float f = pow(1.0 - max(dot(vNormal, vView), 0.0), power);
      gl_FragColor = vec4(color, f * strength);
    }`,
};

export class Universe {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;

  private nodes = new Map<string, BodyNode>();
  private sun!: THREE.Mesh;
  private sunGlows: THREE.Sprite[] = [];
  private stars!: THREE.Points;
  private starsMat!: THREE.PointsMaterial;
  private dust!: THREE.Points;
  private dustMat!: THREE.PointsMaterial;
  private light!: THREE.PointLight;

  // shared geometry
  private sphereGeo = new THREE.SphereGeometry(1, 96, 64);
  private pickGeo = new THREE.SphereGeometry(1, 16, 12);
  private satGeo = new THREE.SphereGeometry(1, 8, 6);
  private satMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.92, 0.93, 0.96) });
  private circleGeo: THREE.BufferGeometry;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(-10, -10);
  private pointerActive = false;

  private camPos = new THREE.Vector3(0, 6, 420);
  private camTarget = new THREE.Vector3();
  private focusAngle = 0.6;
  private sunAngle = 0.2;
  private wideDrift = 0;
  private introClock = 0;
  private introStart = -1;
  private lastIntroPush = -1;
  private snapUntil = -1;
  private reduced = false;
  private hovered: string | null = null;
  private outer = 11.15;

  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private tmp3 = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private mat4 = new THREE.Matrix4();
  private up = new THREE.Vector3(0, 1, 0);

  readonly quality: "high" | "low";
  disposed = false;

  constructor(canvas: HTMLCanvasElement, opts: { reducedMotion: boolean; quality: "high" | "low" }) {
    this.reduced = opts.reducedMotion;
    this.quality = opts.quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: opts.quality === "high", alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.quality === "high" ? 1.5 : 1.1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x000000, 1);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
    this.camera.position.copy(this.camPos);

    this.circleGeo = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 256 }, (_, i) => {
        const a = (i / 256) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      }),
    );
    // Dashed ghosts need the running length along the loop.
    new THREE.LineLoop(this.circleGeo).computeLineDistances();

    this.scene.environment = this.makeEnvironment();
    this.scene.environmentIntensity = 0.55;

    this.buildLights();
    this.buildSun();
    this.buildStars();
    this.buildDust();
    if (opts.quality === "high") this.buildPost();

    this.syncBodies(systemStore.get().system);

    if (this.reduced) {
      this.introClock = 10;
      this.camPos.set(0, 15, 32);
    }
  }

  // ───────────────────────────────────────────── build ──

  private makeEnvironment(): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromEquirectangular(environmentTexture()).texture;
    pmrem.dispose();
    return env;
  }

  private buildLights() {
    this.light = new THREE.PointLight(0xfff1dc, 42, 0, 0.92);
    this.light.position.set(0, 0, 0);
    this.scene.add(this.light);
    this.scene.add(new THREE.AmbientLight(0x8090b0, 0.045));
  }

  private buildSun() {
    const geo = new THREE.SphereGeometry(SUN_RADIUS, 64, 48);
    // Limb darkening: a photosphere is brightest at its centre. Painted once.
    const disc = sunTexture();
    const mat = new THREE.MeshBasicMaterial({ map: disc, color: new THREE.Color(1.5, 1.46, 1.36) });
    this.sun = new THREE.Mesh(geo, mat);
    this.scene.add(this.sun);
    const glow = glowTexture(256, 0, 0.3);
    const halos: [number, number, number][] = [
      [4.4, 0.75, 0xfffaf4],
      [10, 0.2, 0xfff6ea],
      [24, 0.07, 0xfff1de],
    ];
    for (const [size, opacity, color] of halos) {
      const sm = new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
      const s = new THREE.Sprite(sm);
      s.scale.setScalar(size);
      this.scene.add(s);
      this.sunGlows.push(s);
    }
  }

  /** Materials for a lit planet: the painted surface under physical shading. */
  private planetMaterial(surface: Surface): { material: THREE.MeshPhysicalMaterial; disposables: { dispose(): void }[] } {
    const painted = paintSurface(surface, hash(surface) * 1000);
    const metal = surface === "gold" || surface === "chrome" || surface === "silver";
    const material = new THREE.MeshPhysicalMaterial({
      map: painted.map,
      roughnessMap: painted.roughnessMap,
      metalnessMap: painted.metalnessMap,
      roughness: 1,
      metalness: 1,
      bumpMap: painted.bumpMap,
      bumpScale: surface === "gold" || surface === "silver" ? 0.02 : 0.008,
      emissiveMap: painted.emissiveMap,
      emissive: painted.emissiveMap ? (surface === "ember" ? new THREE.Color(1.0, 0.72, 0.4) : new THREE.Color(0.85, 1.0, 0.92)) : new THREE.Color(0, 0, 0),
      emissiveIntensity: painted.emissiveMap ? (surface === "ember" ? 1.4 : 0.95) : 0,
      clearcoat: surface === "porcelain" || surface === "marble" ? 0.7 : surface === "slate" || surface === "ice" ? 0.2 : 0,
      clearcoatRoughness: 0.25,
      envMapIntensity: metal ? 1.6 : 0.7,
    });
    const disposables: { dispose(): void }[] = [material];
    for (const t of [painted.map, painted.roughnessMap, painted.emissiveMap, painted.bumpMap]) if (t) disposables.push(t);
    return { material, disposables };
  }

  private makeNode(key: string, kind: "planet" | "ghost", surface: Surface, orbit: number): BodyNode {
    const group = new THREE.Group();
    const disposables: { dispose(): void }[] = [];

    let mesh: THREE.Mesh;
    let rim: THREE.Mesh | null = null;
    if (kind === "planet") {
      const { material, disposables: d } = this.planetMaterial(surface);
      disposables.push(...d);
      mesh = new THREE.Mesh(this.sphereGeo, material);
      const rimMat = new THREE.ShaderMaterial({
        uniforms: {
          color: { value: new THREE.Color(surface === "gold" ? 0xffe6b0 : surface === "ember" ? 0xffd0b8 : 0xdfe8ff) },
          power: { value: 3.2 },
          strength: { value: surface === "gold" ? 0.55 : 0.42 },
        },
        vertexShader: RIM_SHADER.vertex,
        fragmentShader: RIM_SHADER.fragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      disposables.push(rimMat);
      rim = new THREE.Mesh(this.sphereGeo, rimMat);
      rim.scale.setScalar(1.035);
      group.add(rim);
    } else {
      // A ghost: the body is there, unlit — near-black, barely catching the Sun.
      const mat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95, metalness: 0, envMapIntensity: 0.25 });
      disposables.push(mat);
      mesh = new THREE.Mesh(this.sphereGeo, mat);
    }
    mesh.rotation.z = 0.12 + hash(key) * 0.3;
    group.add(mesh);

    const pick = new THREE.Mesh(this.pickGeo, new THREE.MeshBasicMaterial({ visible: false }));
    pick.userData.key = key;
    group.add(pick);

    const rings: THREE.LineLoop[] = [];
    for (let k = 0; k < RINGS; k++) {
      const m = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false });
      disposables.push(m);
      const ring = new THREE.LineLoop(this.circleGeo, m);
      // Each ring leans a little, deterministically, so a full planet reads as a gyroscope.
      ring.rotation.x = ((k * 37) % 11) * 0.028 - 0.14;
      ring.rotation.z = ((k * 53) % 13) * 0.02 - 0.12;
      ring.visible = false;
      group.add(ring);
      rings.push(ring);
    }

    const sats = new THREE.InstancedMesh(this.satGeo, this.satMat, MAX_SATS);
    sats.count = 0;
    sats.frustumCulled = false;
    group.add(sats);
    const satState = Array.from({ length: MAX_SATS }, (_, i) => ({
      angle: (i * 2.399 + hash(key) * 6) % (Math.PI * 2),
      speed: 0.5 + ((i * 7919) % 100) / 100,
      tilt: (((i * 31) % 17) / 17 - 0.5) * 0.4,
    }));

    const pathMat =
      kind === "planet"
        ? new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.13, depthWrite: false })
        : new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0.09, depthWrite: false, dashSize: 0.045, gapSize: 0.03 });
    disposables.push(pathMat);
    const path = new THREE.LineLoop(this.circleGeo, pathMat);
    path.scale.setScalar(orbit);
    this.scene.add(path);
    this.scene.add(group);

    return {
      key,
      kind,
      group,
      mesh,
      rim,
      pick,
      rings,
      sats,
      satState,
      path,
      pathMat,
      orbit,
      orbitTarget: orbit,
      angle: hash(key + ":angle") * Math.PI * 2,
      speed: 1,
      radius: kind === "ghost" ? 0.3 : 0.5,
      disposables,
    };
  }

  private removeNode(node: BodyNode) {
    this.scene.remove(node.group);
    this.scene.remove(node.path);
    for (const d of node.disposables) d.dispose();
    this.nodes.delete(node.key);
  }

  /** Bring the set of bodies in line with the store: planets people lit, candidates as ghosts. */
  private syncBodies(system: SystemState) {
    const wanted = new Set<string>();
    for (const p of system.planets) {
      wanted.add(p.key);
      let node = this.nodes.get(p.key);
      if (node && node.kind !== "planet") {
        this.removeNode(node);
        node = undefined;
      }
      if (!node) {
        node = this.makeNode(p.key, "planet", p.surface, p.orbitRadius);
        this.nodes.set(p.key, node);
      }
      node.orbitTarget = p.orbitRadius;
    }
    for (const g of system.ghosts) {
      wanted.add(g.key);
      let node = this.nodes.get(g.key);
      if (node && node.kind !== "ghost") {
        this.removeNode(node);
        node = undefined;
      }
      if (!node) {
        node = this.makeNode(g.key, "ghost", g.candidate.surface, g.orbitRadius);
        this.nodes.set(g.key, node);
      }
      node.orbitTarget = g.orbitRadius;
    }
    for (const node of Array.from(this.nodes.values())) {
      if (!wanted.has(node.key)) this.removeNode(node);
    }
    this.outer = outerRadius(system);
  }

  private buildStars() {
    const n = this.quality === "high" ? 5200 : 2600;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    let s = 12345;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < n; i++) {
      // uniform on a sphere, far away
      const u = rnd() * 2 - 1;
      const t = rnd() * Math.PI * 2;
      const r = 320 + rnd() * 260;
      const q = Math.sqrt(1 - u * u);
      pos[i * 3] = r * q * Math.cos(t);
      pos[i * 3 + 1] = r * u;
      pos[i * 3 + 2] = r * q * Math.sin(t);
      const b = 0.25 + Math.pow(rnd(), 3.2) * 0.75;
      const warm = rnd() < 0.18;
      col[i * 3] = b * (warm ? 1 : 0.9);
      col[i * 3 + 1] = b * (warm ? 0.93 : 0.94);
      col[i * 3 + 2] = b * (warm ? 0.82 : 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.starsMat = new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
    this.stars = new THREE.Points(geo, this.starsMat);
    this.scene.add(this.stars);
  }

  private buildDust() {
    const n = this.quality === "high" ? 900 : 400;
    const pos = new Float32Array(n * 3);
    let s = 777;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < n; i++) {
      const r = 2.6 + Math.pow(rnd(), 0.7) * 14;
      const a = rnd() * Math.PI * 2;
      pos[i * 3] = r * Math.cos(a);
      pos[i * 3 + 1] = (rnd() - 0.5) * 0.5;
      pos[i * 3 + 2] = r * Math.sin(a);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.dustMat = new THREE.PointsMaterial({ size: 1.2, sizeAttenuation: false, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.scene.add(this.dust);
  }

  private buildPost() {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.3, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  // ───────────────────────────────────────────── input ──

  setPointer(ndcX: number, ndcY: number, active: boolean) {
    this.pointer.set(ndcX, ndcY);
    this.pointerActive = active;
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(width, height);
  }

  /** Which body the pointer is over, or null. */
  pickAt(ndcX: number, ndcY: number): string | null {
    this.pointer.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const picks: THREE.Object3D[] = [];
    for (const n of this.nodes.values()) if (n.group.visible) picks.push(n.pick);
    const hits = this.raycaster.intersectObjects(picks, false);
    return hits.length ? (hits[0].object.userData.key as string) : null;
  }

  /** Skip the intro (captures, reduced motion): the camera starts where the page wants it. */
  skipIntro() {
    this.reduced = true;
    this.introClock = 10;
    this.snapUntil = performance.now() + 1500;
    uiStore.set({ intro: 1 });
  }

  // ───────────────────────────────────────────── views ──

  private wideView(out: View, farther = 1): View {
    const aspect = this.camera.aspect || 1;
    // Frame the outermost orbit, whatever the sky has grown to.
    const dist = 32 * Math.max(1, this.outer / 11.15) * Math.max(1, 1.3 / aspect) * farther;
    const a = this.wideDrift;
    out.pos.set(Math.sin(a) * dist * 0.85, dist * 0.5, Math.cos(a) * dist * 0.85);
    // On a wide screen the system sits up and to the right; the title owns the lower left.
    const wide = aspect > 1.05;
    const forward = this.tmp.copy(out.pos).multiplyScalar(-1).normalize();
    const right = this.tmp2.crossVectors(forward, this.up).normalize();
    // Portrait: the system rides high, the title takes the lower half.
    out.target.set(0, -0.6 - (wide ? dist * 0.1 : dist * 0.16), 0).addScaledVector(right, wide ? -dist * 0.13 : 0);
    return out;
  }

  private bodyView(out: View, node: BodyNode, orbitAngle: number, tight: boolean): View {
    const p = node.group.position;
    const r = node.radius;
    // Portrait screens see less width: stand farther back so the planet keeps its margins.
    const portrait = Math.max(1, 1.3 / (this.camera.aspect || 1));
    const dist = (r * (tight ? 5.2 : 6.4) + (tight ? 1.4 : 1.9)) * portrait;
    // Toward the Sun, then swung around by `orbitAngle`, and lifted: the
    // camera sees the lit limb and the terminator, never a flat disc.
    const toSun = this.tmp.copy(p).multiplyScalar(-1).normalize();
    const side = this.tmp2.crossVectors(this.up, toSun).normalize();
    const dir = this.tmp3.copy(toSun).multiplyScalar(Math.cos(orbitAngle)).addScaledVector(side, Math.sin(orbitAngle)).addScaledVector(this.up, 0.42).normalize();
    out.pos.copy(p).addScaledVector(dir, dist);
    // Shift the aim so the planet sits in the left half; the sheet takes the right.
    const forward = this.tmp.copy(p).sub(out.pos).normalize();
    const right = this.tmp2.crossVectors(forward, this.up).normalize();
    const wide = this.camera.aspect > 1.05;
    out.target.copy(p).addScaledVector(right, wide ? dist * 0.2 : 0).addScaledVector(this.up, wide ? 0 : -dist * 0.3);
    return out;
  }

  private sunView(out: View, close: boolean): View {
    const d = close ? 8.6 : 12.5;
    out.pos.set(Math.sin(this.sunAngle) * d, close ? 2.2 : 3.4, Math.cos(this.sunAngle) * d);
    // The Sun sits in the left half; the sheet takes the right.
    const forward = this.tmp.copy(out.pos).multiplyScalar(-1).normalize();
    const right = this.tmp2.crossVectors(forward, this.up).normalize();
    const wide = this.camera.aspect > 1.05;
    out.target.set(0, close ? 0.1 : 0.4, 0).addScaledVector(right, wide ? d * 0.22 : 0).addScaledVector(this.up, wide ? 0 : -1.6);
    return out;
  }

  private howView(out: View): View {
    const aspect = this.camera.aspect || 1;
    const dist = 31 * Math.max(1, this.outer / 11.15) * Math.max(1, 1.25 / aspect);
    out.pos.set(dist * 0.12, dist * 0.94, dist * 0.3);
    // Aim short of the Sun so the system rides in the upper half; the three steps take the lower.
    out.target.set(0, 0, aspect > 1.05 ? dist * 0.18 : dist * 0.24);
    return out;
  }

  private viewFor(out: View, stage: Stage): View {
    switch (stage.kind) {
      case "wide":
        return this.wideView(out);
      case "planet":
      case "ghost": {
        const node = stage.bodyKey ? this.nodes.get(stage.bodyKey) : undefined;
        return node ? this.bodyView(out, node, 1.05, false) : this.wideView(out);
      }
      case "sun":
        return this.sunView(out, false);
      case "how":
        return this.howView(out);
      case "end":
        return this.wideView(out, 1.35);
    }
  }

  private viewA: View = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private viewB: View = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private desiredView: View = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

  /** Where the camera wants to be this frame, given focus and scroll. */
  private desired(out: View, focus: Focus, progress: number, stages: Stage[]): View {
    if (focus.kind === "planet") {
      const node = this.nodes.get(focus.key);
      if (node) return this.bodyView(out, node, this.focusAngle, true);
    }
    if (focus.kind === "sun") {
      return this.sunView(out, true);
    }
    const s = stageAt(progress, stages.length);
    const i = Math.floor(s);
    const f = smoothstep(s - i);
    this.viewFor(this.viewA, stages[i]);
    if (f <= 0 || i >= stages.length - 1) {
      out.pos.copy(this.viewA.pos);
      out.target.copy(this.viewA.target);
      return out;
    }
    this.viewFor(this.viewB, stages[i + 1]);
    out.pos.lerpVectors(this.viewA.pos, this.viewB.pos, f);
    out.target.lerpVectors(this.viewA.target, this.viewB.target, f);
    return out;
  }

  // ───────────────────────────────────────────── frame ──

  update(dt: number, now: number) {
    if (this.disposed) return;
    dt = Math.min(dt, 0.05);
    const ui = uiStore.get();
    const system = systemStore.get().system;
    this.syncBodies(system);

    // intro clock — from frame timestamps, not summed deltas, so a throttled or
    // virtual-time frame loop (a headless capture) still reaches the end
    if (this.introClock < 4) {
      if (this.introStart < 0) this.introStart = now;
      this.introClock = this.reduced ? 10 : (now - this.introStart) / 1000;
      const t = Math.min(1, Math.max(0, (this.introClock - 0.35) / 3.1));
      if (t - this.lastIntroPush >= 0.04 || (t >= 1 && this.lastIntroPush < 1)) {
        this.lastIntroPush = t;
        uiStore.set({ intro: t });
      }
    }
    const intro = this.reduced ? 1 : Math.min(1, Math.max(0, (this.introClock - 0.35) / 3.1));
    const introE = easeInOutCubic(intro);

    // clocks
    const motion = this.reduced ? 0.15 : 1;
    this.wideDrift += dt * 0.004 * motion;
    this.sunAngle += dt * 0.045 * motion;
    this.focusAngle += dt * 0.07 * motion;

    this.updateBodies(dt, system, ui.hover, ui.focus, motion);

    // sun breathing; the wide halos thin out as the camera comes close, or they would wash the frame
    const pulse = 1 + Math.sin(now * 0.0011) * 0.012;
    this.sun.scale.setScalar(pulse);
    this.sun.rotation.y += dt * 0.02;
    this.sunGlows[0].scale.setScalar(4.4 * (1 + Math.sin(now * 0.0017) * 0.03));
    this.sunGlows[1].scale.setScalar(10 * (1 + Math.sin(now * 0.0009 + 1) * 0.04));
    const near = Math.min(1, Math.max(0, (this.camPos.length() - 7) / 16));
    (this.sunGlows[0].material as THREE.SpriteMaterial).opacity = 0.75 * (0.4 + 0.6 * near);
    (this.sunGlows[1].material as THREE.SpriteMaterial).opacity = 0.2 * (0.1 + 0.9 * near);
    (this.sunGlows[2].material as THREE.SpriteMaterial).opacity = 0.07 * near;

    // fades
    this.starsMat.opacity = 0.9 * smoothstep(Math.min(1, Math.max(0, (intro - 0.25) / 0.6)));
    this.dustMat.opacity = 0.28 * smoothstep(Math.min(1, Math.max(0, (intro - 0.45) / 0.5)));
    const bodiesIn = smoothstep(Math.min(1, Math.max(0, (intro - 0.3) / 0.5)));
    for (const n of this.nodes.values()) {
      n.group.visible = bodiesIn > 0.02;
      n.path.visible = bodiesIn > 0.02;
      const lit = this.hovered === n.key || (ui.focus.kind === "planet" && ui.focus.key === n.key);
      n.pathMat.opacity = (n.kind === "ghost" ? 0.09 : 0.13) * bodiesIn * (lit ? 3.2 : 1);
    }
    this.dust.rotation.y += dt * 0.004 * motion;

    // camera
    const stages = stagesFor(system);
    this.desired(this.desiredView, ui.focus, ui.progress, stages);
    if (intro < 1 && !this.reduced) {
      // Dolly along the wide view's own axis: the point of light is the Sun, seen from far.
      const wide = this.wideView(this.viewA);
      const far = this.tmp.copy(wide.pos).normalize().multiplyScalar(420);
      this.camPos.lerpVectors(far, wide.pos, introE);
      this.camTarget.copy(wide.target).multiplyScalar(introE);
    } else if (now < this.snapUntil) {
      // Just after a skipped intro: no easing, the first frames are already in place.
      this.camPos.copy(this.desiredView.pos);
      this.camTarget.copy(this.desiredView.target);
    } else {
      const rate = ui.focus.kind === "none" ? 3.2 : 2.4;
      this.camPos.lerp(this.desiredView.pos, damp(rate, dt));
      this.camTarget.lerp(this.desiredView.target, damp(rate * 1.2, dt));
    }
    // parallax from the pointer, a hand's breadth
    const px = this.pointerActive ? ui.pointerX : 0;
    const py = this.pointerActive ? ui.pointerY : 0;
    this.camera.position.copy(this.camPos);
    const dist = this.camPos.distanceTo(this.camTarget);
    const forward = this.tmp.copy(this.camTarget).sub(this.camPos).normalize();
    const right = this.tmp2.crossVectors(forward, this.up).normalize();
    const camUp = this.tmp3.crossVectors(right, forward).normalize();
    this.camera.position.addScaledVector(right, px * dist * 0.02 * motion).addScaledVector(camUp, py * dist * 0.012 * motion);
    this.camera.lookAt(this.camTarget);

    // hover
    if (this.pointerActive && intro >= 0.95) {
      const key = this.pickAt(this.pointer.x, this.pointer.y);
      if (key !== this.hovered) {
        this.hovered = key;
        uiStore.set({ hover: key });
      }
    } else if (this.hovered !== null && !this.pointerActive) {
      this.hovered = null;
      uiStore.set({ hover: null });
    }

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private updateBodies(dt: number, system: SystemState, hover: string | null, focus: Focus, motion: number) {
    for (const n of this.nodes.values()) {
      const planet = n.kind === "planet" ? system.planets.find((p) => p.key === n.key) : undefined;
      const share = planet ? massShare(system, planet.idx) : 0;
      const targetR = n.kind === "ghost" ? 0.3 : 0.36 + 0.9 * Math.sqrt(share);
      n.radius += (targetR - n.radius) * damp(2, dt);

      // a body whose slot moved (a ghost after a new planet was lit) eases to its new orbit
      n.orbit += (n.orbitTarget - n.orbit) * damp(1.5, dt);
      n.path.scale.setScalar(n.orbit);

      // hovered bodies slow to a crawl; focused ones too, so the sheet holds still
      const held = hover === n.key || (focus.kind === "planet" && focus.key === n.key);
      const targetSpeed = held ? 0.1 : 1;
      n.speed += (targetSpeed - n.speed) * damp(4, dt);
      n.angle += omegaFor(n.orbit) * n.speed * dt * motion;

      n.group.position.set(Math.cos(n.angle) * n.orbit, 0, Math.sin(n.angle) * n.orbit);
      n.mesh.scale.setScalar(n.radius);
      n.mesh.rotation.y += dt * 0.12 * motion;
      if (n.rim) n.rim.scale.setScalar(n.radius * 1.035);
      n.pick.scale.setScalar(Math.max(n.radius * 1.9, 0.75));

      // claimed orbits become rings; bodies become satellites on them
      const claimed = Math.min(RINGS, planet?.orbitsClaimed ?? 0);
      for (let k = 0; k < RINGS; k++) {
        const ring = n.rings[k];
        ring.visible = k < claimed;
        if (ring.visible) {
          ring.scale.setScalar(n.radius * (1.55 + 0.11 * k));
          ring.rotation.y += dt * 0.05 * (k % 2 ? 1 : -1) * motion;
        }
      }
      const bodies = planet?.bodies ?? 0;
      const count = Math.min(MAX_SATS, bodies === 0 ? 0 : Math.max(4, Math.round(Math.sqrt(bodies) * 2.2)));
      n.sats.count = count;
      for (let i = 0; i < count; i++) {
        const s = n.satState[i];
        const ringIdx = claimed > 0 ? i % claimed : -1;
        const rr = ringIdx >= 0 ? n.radius * (1.55 + 0.11 * ringIdx) : n.radius * 1.4;
        s.angle += dt * s.speed * 0.35 * motion;
        const x = Math.cos(s.angle) * rr;
        const z = Math.sin(s.angle) * rr;
        const y = Math.sin(s.angle * 2 + s.tilt) * rr * 0.08;
        this.tmp.set(x, y, z);
        this.quat.identity();
        this.mat4.compose(this.tmp, this.quat, this.tmp2.setScalar(0.006 + n.radius * 0.005));
        n.sats.setMatrixAt(i, this.mat4);
      }
      if (count > 0) n.sats.instanceMatrix.needsUpdate = true;
    }
  }

  /** Screen positions of every body and the Sun for the HUD. */
  project(width: number, height: number, out: Projected[]): Projected[] {
    const fovTan = Math.tan((this.camera.fov * Math.PI) / 360);
    out.length = 0;
    const camPos = this.camera.position;
    for (const n of this.nodes.values()) {
      const p = n.group.position;
      const depth = p.distanceTo(camPos);
      this.tmp.copy(p).project(this.camera);
      const visible = this.tmp.z < 1 && n.group.visible;
      out.push({
        key: n.key,
        x: (this.tmp.x * 0.5 + 0.5) * width,
        y: (-this.tmp.y * 0.5 + 0.5) * height,
        radiusPx: (n.radius / (depth * fovTan)) * (height / 2),
        visible,
        depth,
      });
    }
    const sd = camPos.length();
    this.tmp.set(0, 0, 0).project(this.camera);
    out.push({ key: "sun", x: (this.tmp.x * 0.5 + 0.5) * width, y: (-this.tmp.y * 0.5 + 0.5) * height, radiusPx: (SUN_RADIUS / (sd * fovTan)) * (height / 2), visible: this.tmp.z < 1, depth: sd });
    return out;
  }

  dispose() {
    this.disposed = true;
    for (const node of Array.from(this.nodes.values())) this.removeNode(node);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.sphereGeo.dispose();
    this.pickGeo.dispose();
    this.satGeo.dispose();
    this.circleGeo.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
