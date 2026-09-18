/**
 * Seedable 3D value noise + fbm, sampled on the unit sphere so the
 * equirectangular textures have no seam. Plain JS, no dependencies: a
 * 768×384 texture with four octaves is ~150 ms on a laptop, and each
 * planet is painted once.
 */
export class Noise3 {
  private perm = new Uint8Array(512);
  private grad = new Float32Array(256);

  constructor(seed = 1) {
    let s = seed >>> 0 || 1;
    const rnd = () => {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      return s / 4294967296;
    };
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) this.grad[i] = rnd();
  }

  private lattice(x: number, y: number, z: number): number {
    return this.grad[this.perm[this.perm[this.perm[x & 255] + (y & 255)] + (z & 255)]];
  }

  /** Value noise in [0, 1]. */
  value(x: number, y: number, z: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const w = zf * zf * (3 - 2 * zf);
    const l = (dx: number, dy: number, dz: number) => this.lattice(xi + dx, yi + dy, zi + dz);
    const x00 = l(0, 0, 0) + (l(1, 0, 0) - l(0, 0, 0)) * u;
    const x10 = l(0, 1, 0) + (l(1, 1, 0) - l(0, 1, 0)) * u;
    const x01 = l(0, 0, 1) + (l(1, 0, 1) - l(0, 0, 1)) * u;
    const x11 = l(0, 1, 1) + (l(1, 1, 1) - l(0, 1, 1)) * u;
    const y0 = x00 + (x10 - x00) * v;
    const y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w;
  }

  /** Fractal sum in [0, 1]. */
  fbm(x: number, y: number, z: number, octaves = 4, lacunarity = 2.07, gain = 0.5): number {
    let amp = 0.5;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.value(x, y, z);
      norm += amp;
      x *= lacunarity;
      y *= lacunarity;
      z *= lacunarity;
      amp *= gain;
    }
    return sum / norm;
  }

  /** Ridged variant in [0, 1] — sharp creases, for crater rims and hammered metal. */
  ridged(x: number, y: number, z: number, octaves = 4): number {
    let amp = 0.5;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.value(x, y, z) * 2 - 1);
      sum += amp * n * n;
      norm += amp;
      x *= 2.1;
      y *= 2.1;
      z *= 2.1;
      amp *= 0.5;
    }
    return sum / norm;
  }
}
