// Paints public/orbit-logo.png (512×512) with nothing but Node: a black
// disc, a thin white orbit seen at an angle, the Sun at the centre, one
// gold body on the ring. `node scripts/make-logo.mjs`
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const S = 512;
const px = new Float32Array(S * S * 3);

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) return;
  const i = (y * S + x) * 3;
  px[i] += (r - px[i]) * a;
  px[i + 1] += (g - px[i + 1]) * a;
  px[i + 2] += (b - px[i + 2]) * a;
}

/** Anti-aliased disc with a soft edge. */
function disc(cx, cy, radius, [r, g, b], soft = 1.2, alpha = 1) {
  const R = Math.ceil(radius + soft + 1);
  for (let y = Math.floor(cy - R); y <= cy + R; y++) {
    for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const a = Math.min(1, Math.max(0, (radius + soft / 2 - d) / soft));
      blend(x, y, r, g, b, a * alpha);
    }
  }
}

/** Radial glow falling off to zero at `radius`. */
function glow(cx, cy, radius, [r, g, b], strength) {
  for (let y = Math.floor(cy - radius); y <= cy + radius; y++) {
    for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
      if (d >= 1) continue;
      const a = Math.pow(1 - d, 2.4) * strength;
      blend(x, y, r, g, b, a);
    }
  }
}

/** Anti-aliased ellipse outline. */
function ellipse(cx, cy, rx, ry, width, [r, g, b], alpha = 1) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      // implicit distance approximation: |f(x,y)| / |grad f|
      const f = dx * dx + dy * dy - 1;
      const gx = (2 * dx) / rx;
      const gy = (2 * dy) / ry;
      const d = Math.abs(f) / Math.max(1e-6, Math.hypot(gx, gy));
      const a = Math.min(1, Math.max(0, width / 2 + 0.7 - d));
      if (a > 0) blend(x, y, r, g, b, a * alpha);
    }
  }
}

// background: black disc on transparent-black (Pons shows it on dark anyway)
disc(S / 2, S / 2, S / 2 - 2, [0, 0, 0], 1.5, 1);

const white = [0.96, 0.96, 0.95];
const gold = [0.79, 0.65, 0.35];
const sunCore = [1, 0.97, 0.9];

// the orbit, tilted
ellipse(S / 2, S / 2 + 6, 196, 74, 2.2, white, 0.85);
// corona then core
glow(S / 2, S / 2, 150, [1, 0.94, 0.82], 0.55);
disc(S / 2, S / 2, 46, sunCore, 2.5);
// the body on the ring — front, lower right
const t = 0.62;
const bx = S / 2 + Math.cos(t) * 196;
const by = S / 2 + 6 + Math.sin(t) * 74;
disc(bx, by, 17, gold, 1.5);
disc(bx - 5, by - 5, 5, [0.95, 0.88, 0.7], 3, 0.6);

// encode PNG (RGBA, straight-alpha; fully opaque except outside the disc)
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 3;
    const o = y * (S * 4 + 1) + 1 + x * 4;
    const d = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2);
    const alpha = Math.min(1, Math.max(0, S / 2 - 1 - d));
    raw[o] = Math.round(Math.min(1, px[i]) * 255);
    raw[o + 1] = Math.round(Math.min(1, px[i + 1]) * 255);
    raw[o + 2] = Math.round(Math.min(1, px[i + 2]) * 255);
    raw[o + 3] = Math.round(alpha * 255);
  }
}

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
mkdirSync("public", { recursive: true });
writeFileSync("public/orbit-logo.png", png);
console.log(`wrote public/orbit-logo.png (${png.length} bytes)`);
