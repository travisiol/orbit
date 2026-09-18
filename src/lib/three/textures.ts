import * as THREE from "three";
import { Noise3 } from "./noise";
import type { Surface as SurfaceKind } from "../planets";

/**
 * Procedural planet surfaces — no asset is loaded anywhere in the site.
 * Each surface is an equirectangular set of canvases (colour, roughness,
 * emissive, bump) painted once from seeded 3D noise sampled on the sphere.
 *
 * The palette is the brief's: black, white, chrome, one gold. Planets are
 * told apart by material and pattern, not by hue.
 */
export type Surface = {
  map: THREE.Texture;
  roughnessMap?: THREE.Texture;
  metalnessMap?: THREE.Texture;
  emissiveMap?: THREE.Texture;
  bumpMap?: THREE.Texture;
};

type Pixel = { r: number; g: number; b: number; rough: number; metal: number; emis: number; bump: number };

const W = 768;
const H = 384;

function tex(data: ImageData, srgb: boolean): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = data.width;
  c.height = data.height;
  c.getContext("2d")!.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function paint(shade: (nx: number, ny: number, nz: number, u: number, v: number, out: Pixel) => void, opts: { emissive?: boolean; bump?: boolean }): Surface {
  const color = new ImageData(W, H);
  const rough = new ImageData(W, H);
  const emis = opts.emissive ? new ImageData(W, H) : null;
  const bump = opts.bump ? new ImageData(W, H) : null;
  const px: Pixel = { r: 0, g: 0, b: 0, rough: 0.5, metal: 0, emis: 0, bump: 0.5 };
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const phi = v * Math.PI;
    const sp = Math.sin(phi);
    const ny = Math.cos(phi);
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const theta = u * Math.PI * 2;
      const nx = sp * Math.cos(theta);
      const nz = sp * Math.sin(theta);
      shade(nx, ny, nz, u, v, px);
      const i = (y * W + x) * 4;
      color.data[i] = clamp01(px.r) * 255;
      color.data[i + 1] = clamp01(px.g) * 255;
      color.data[i + 2] = clamp01(px.b) * 255;
      color.data[i + 3] = 255;
      // roughness in G, metalness in B (three reads .g for roughness, .b for metalness)
      rough.data[i] = 0;
      rough.data[i + 1] = clamp01(px.rough) * 255;
      rough.data[i + 2] = clamp01(px.metal) * 255;
      rough.data[i + 3] = 255;
      if (emis) {
        const e = clamp01(px.emis) * 255;
        emis.data[i] = e;
        emis.data[i + 1] = e;
        emis.data[i + 2] = e;
        emis.data[i + 3] = 255;
      }
      if (bump) {
        const b = clamp01(px.bump) * 255;
        bump.data[i] = b;
        bump.data[i + 1] = b;
        bump.data[i + 2] = b;
        bump.data[i + 3] = 255;
      }
    }
  }
  const roughTex = tex(rough, false);
  return {
    map: tex(color, true),
    roughnessMap: roughTex,
    metalnessMap: roughTex,
    emissiveMap: emis ? tex(emis, false) : undefined,
    bumpMap: bump ? tex(bump, false) : undefined,
  };
}

/** HOOD — a dark planet. Basalt, cratered, almost no albedo. */
function basalt(seed: number): Surface {
  const n = new Noise3(seed);
  return paint(
    (x, y, z, _u, _v, o) => {
      const base = n.fbm(x * 3, y * 3, z * 3, 4);
      const crater = n.ridged(x * 7 + 3, y * 7, z * 7, 3);
      const shade = 0.05 + base * 0.05 - crater * 0.03;
      o.r = shade * 1.0;
      o.g = shade * 1.02;
      o.b = shade * 1.08;
      o.rough = 0.92 - crater * 0.1;
      o.metal = 0;
      o.bump = 0.5 + (crater - 0.5) * 0.6;
    },
    { bump: true },
  );
}

/** TSLA — brushed steel. Streaks along the latitude, mirror-ish. */
function chrome(seed: number): Surface {
  const n = new Noise3(seed);
  return paint(
    (x, y, z, _u, _v, o) => {
      // Stretch the noise around the axis of rotation: horizontal brushing.
      const streak = n.fbm(x * 0.6, y * 22, z * 0.6, 3);
      const panel = n.fbm(x * 2.2, y * 2.2, z * 2.2, 2);
      const tone = 0.62 + streak * 0.18 + (panel - 0.5) * 0.08;
      o.r = tone * 0.98;
      o.g = tone;
      o.b = tone * 1.04;
      o.rough = 0.22 + streak * 0.28;
      o.metal = 1;
      o.bump = 0.5 + (streak - 0.5) * 0.15;
    },
    { bump: true },
  );
}

/** META — slate under pale cloud bands. */
function slate(seed: number): Surface {
  const n = new Noise3(seed);
  return paint(
    (x, y, z, _u, _v, o) => {
      const bands = Math.sin(y * 18 + n.fbm(x * 1.5, y * 1.5, z * 1.5, 3) * 6) * 0.5 + 0.5;
      const cloud = n.fbm(x * 4 + 11, y * 9, z * 4, 4);
      const cover = clamp01((cloud - 0.42) * 3) * (0.35 + bands * 0.65);
      const sr = 0.16,
        sg = 0.18,
        sb = 0.22;
      const cr = 0.78,
        cg = 0.8,
        cb = 0.84;
      o.r = mix(sr, cr, cover);
      o.g = mix(sg, cg, cover);
      o.b = mix(sb, cb, cover);
      o.rough = 0.75 - cover * 0.15;
      o.metal = 0;
      o.bump = 0.5 + (cover - 0.5) * 0.2;
    },
    { bump: true },
  );
}

/** AAPL — white porcelain, barely mottled. */
function porcelain(seed: number): Surface {
  const n = new Noise3(seed);
  return paint(
    (x, y, z, _u, _v, o) => {
      const mottle = n.fbm(x * 5, y * 5, z * 5, 4);
      const vein = n.ridged(x * 3 + 7, y * 3, z * 3, 3);
      const tone = 0.9 + (mottle - 0.5) * 0.08 - vein * 0.05;
      o.r = tone;
      o.g = tone * 0.995;
      o.b = tone * 0.985;
      o.rough = 0.3 + vein * 0.15;
      o.metal = 0;
      o.bump = 0.5 + (vein - 0.5) * 0.1;
    },
    { bump: true },
  );
}

/** NVDA — dark silicon lit from within: a grid of traces, gaps where the noise says so. */
function circuit(seed: number): Surface {
  const n = new Noise3(seed);
  return paint(
    (x, y, z, u, v, o) => {
      const base = n.fbm(x * 4, y * 4, z * 4, 3);
      const tone = 0.06 + base * 0.05;
      o.r = tone;
      o.g = tone * 1.05;
      o.b = tone * 1.1;
      o.rough = 0.55;
      o.metal = 0.15;
      // Traces: latitude lines every 1/28 of the height, longitude lines every 1/56 of the width,
      // present only where a coarse noise field is high, so the grid breaks into districts.
      const lat = Math.abs(((v * 28) % 1) - 0.5) < 0.05 ? 1 : 0;
      const lon = Math.abs(((u * 56) % 1) - 0.5) < 0.05 ? 1 : 0;
      const district = n.fbm(x * 2.5 + 31, y * 2.5, z * 2.5, 3);
      const on = district > 0.5 ? 1 : district > 0.44 ? (district - 0.44) / 0.06 : 0;
      const pad = Math.abs(((v * 28) % 1) - 0.5) < 0.12 && Math.abs(((u * 56) % 1) - 0.5) < 0.12 ? 0.6 : 0;
      const pole = clamp01((Math.abs(y) - 0.86) * 8); // traces fade at the poles
      o.emis = clamp01(Math.max(lat, lon) * 0.85 + pad * 0.4) * on * (1 - pole);
      o.bump = 0.5;
    },
    { emissive: true },
  );
}

/** GOLD — hammered gold. */
function gold(seed: number): Surface {
  const n = new Noise3(seed);
  return paint(
    (x, y, z, _u, _v, o) => {
      const hammer = n.ridged(x * 9, y * 9, z * 9, 4);
      const tarnish = n.fbm(x * 2, y * 2, z * 2, 3);
      const tone = 0.86 + (hammer - 0.5) * 0.14 - tarnish * 0.08;
      o.r = tone * 0.95;
      o.g = tone * 0.74;
      o.b = tone * 0.36;
      o.rough = 0.26 + hammer * 0.16;
      o.metal = 1;
      o.bump = 0.5 + (hammer - 0.5) * 0.5;
    },
    { bump: true },
  );
}

/** SLV — hammered silver: gold's geometry, a cooler metal. */
function silver(seed: number): Surface {
  const n = new Noise3(seed);
  return paint(
    (x, y, z, _u, _v, o) => {
      const hammer = n.ridged(x * 9, y * 9, z * 9, 4);
      const tarnish = n.fbm(x * 2, y * 2, z * 2, 3);
      const tone = 0.8 + (hammer - 0.5) * 0.14 - tarnish * 0.1;
      o.r = tone * 0.96;
      o.g = tone * 0.97;
      o.b = tone;
      o.rough = 0.24 + hammer * 0.18;
      o.metal = 1;
      o.bump = 0.5 + (hammer - 0.5) * 0.5;
    },
    { bump: true },
  );
}

/** Indexes (SPY, GOOGL) — pale marble, grey veins. */
function marble(seed: number): Surface {
  const n = new Noise3(seed);
  return paint(
    (x, y, z, _u, _v, o) => {
      const vein = Math.pow(n.ridged(x * 2.2 + 5, y * 2.2, z * 2.2, 4), 2.2);
      const cloud = n.fbm(x * 3, y * 3, z * 3, 3);
      const tone = 0.84 + (cloud - 0.5) * 0.08 - vein * 0.42;
      o.r = tone;
      o.g = tone * 0.995;
      o.b = tone * 0.99;
      o.rough = 0.28 + vein * 0.2;
      o.metal = 0;
      o.bump = 0.5 - vein * 0.15;
    },
    { bump: true },
  );
}

/** QQQ, SGOV — pale blue-white ice, cracked. */
function ice(seed: number): Surface {
  const n = new Noise3(seed);
  return paint(
    (x, y, z, _u, _v, o) => {
      const crack = Math.pow(n.ridged(x * 5 + 9, y * 5, z * 5, 3), 3);
      const frost = n.fbm(x * 6, y * 6, z * 6, 4);
      const tone = 0.76 + frost * 0.14 - crack * 0.3;
      o.r = tone * 0.93;
      o.g = tone * 0.97;
      o.b = tone;
      o.rough = 0.18 + frost * 0.2;
      o.metal = 0;
      o.bump = 0.5 - crack * 0.3;
    },
    { bump: true },
  );
}

/** Small caps (SNAP) — charcoal with faint warm cracks: the discreet gold, glowing. */
function ember(seed: number): Surface {
  const n = new Noise3(seed);
  return paint(
    (x, y, z, _u, _v, o) => {
      const base = n.fbm(x * 4, y * 4, z * 4, 4);
      const crack = Math.pow(n.ridged(x * 6 + 2, y * 6, z * 6, 3), 4);
      const tone = 0.07 + base * 0.06;
      o.r = tone * 1.1;
      o.g = tone;
      o.b = tone * 0.9;
      o.rough = 0.85 - crack * 0.3;
      o.metal = 0;
      o.emis = crack * 0.5;
      o.bump = 0.5 + (base - 0.5) * 0.3;
    },
    { emissive: true, bump: true },
  );
}

const painters: Record<SurfaceKind, (seed: number) => Surface> = { basalt, chrome, slate, porcelain, circuit, gold, silver, marble, ice, ember };

export function paintSurface(surface: SurfaceKind, seed = 101): Surface {
  return painters[surface](Math.floor(seed) + 101);
}

/** A soft radial glow, for the Sun's corona and the planets' rims. */
export function glowTexture(size = 256, inner = 0.0, hard = 0.35): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, inner * size * 0.5, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(hard, "rgba(255,255,255,0.35)");
  g.addColorStop(0.7, "rgba(255,255,255,0.06)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The environment the metals reflect: deep black, one white sun disc, a
 * faint band of haze — enough for chrome and gold to read as such.
 */
export function environmentTexture(): THREE.Texture {
  const w = 512;
  const h = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);
  // haze band along the ecliptic
  const band = ctx.createLinearGradient(0, h * 0.38, 0, h * 0.62);
  band.addColorStop(0, "rgba(255,255,255,0)");
  band.addColorStop(0.5, "rgba(255,255,255,0.10)");
  band.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, w, h);
  // the sun
  const sun = ctx.createRadialGradient(w * 0.25, h * 0.5, 0, w * 0.25, h * 0.5, 70);
  sun.addColorStop(0, "rgba(255,250,235,1)");
  sun.addColorStop(0.18, "rgba(255,246,225,0.9)");
  sun.addColorStop(0.4, "rgba(255,240,210,0.25)");
  sun.addColorStop(1, "rgba(255,240,210,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);
  // a cool fill from the opposite side so the dark limb is not pure black
  const fill = ctx.createRadialGradient(w * 0.78, h * 0.42, 0, w * 0.78, h * 0.42, 160);
  fill.addColorStop(0, "rgba(200,210,230,0.16)");
  fill.addColorStop(1, "rgba(200,210,230,0)");
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The Sun's photosphere: near-white, darkening toward the limb, faintly granulated. */
export function sunTexture(): THREE.Texture {
  const w = 512;
  const h = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const n = new Noise3(4242);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    const phi = v * Math.PI;
    const sp = Math.sin(phi);
    const ny = Math.cos(phi);
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const th = u * Math.PI * 2;
      const nx = sp * Math.cos(th);
      const nz = sp * Math.sin(th);
      const g = n.fbm(nx * 14, ny * 14, nz * 14, 3);
      const t = 0.93 + (g - 0.5) * 0.09;
      const i = (y * w + x) * 4;
      img.data[i] = 255 * Math.min(1, t * 1.0);
      img.data[i + 1] = 255 * Math.min(1, t * 0.965);
      img.data[i + 2] = 255 * Math.min(1, t * 0.87);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
