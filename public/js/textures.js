// Procedural texture library. Every prop/character texture is generated at the
// same 128px resolution so texel density stays consistent across the world.
// (The terrain is baked separately at higher resolution in terrain.js.)
import * as THREE from 'three';

const S = 128;
function hash(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed + 7, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// tileable value noise: u,v in [0,1), per = lattice period
function tn(u, v, per, seed) {
  const x = u * per, y = v * per, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const w = (a, b) => hash(((a % per) + per) % per, ((b % per) + per) % per, seed);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = w(ix, iy), b = w(ix + 1, iy), c = w(ix, iy + 1), d = w(ix + 1, iy + 1);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}
function fbmT(u, v, per, seed) { return tn(u, v, per, seed) * 0.55 + tn(u, v, per * 2, seed + 1) * 0.3 + tn(u, v, per * 4, seed + 2) * 0.15; }

function make(size, painter, { alpha = false } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  painter(ctx, size);
  return c;
}
// per-pixel painter: fn(u,v,x,y) -> [r,g,b,(a)]
function pixels(size, fn, alpha = false) {
  return make(size, (ctx) => {
    const img = ctx.createImageData(size, size), d = img.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const c = fn(x / size, y / size, x, y), i = (y * size + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = alpha ? (c[3] ?? 255) : 255;
    }
    ctx.putImageData(img, 0, 0);
  });
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

const cache = new Map();
let maxAniso = 4;
export function setAnisotropy(n) { maxAniso = n; }

function tex(key, canvasFn, { repeat = [1, 1], srgb = true, wrap = true } = {}) {
  if (cache.has(key)) return cache.get(key);
  const t = new THREE.CanvasTexture(canvasFn());
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping; else t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  cache.set(key, t);
  return t;
}
// Return an independent copy with its own repeat (shares the image).
export function repeated(t, rx, ry) { const c = t.clone(); c.repeat.set(rx, ry); c.needsUpdate = true; return c; }

// ---- surface textures ------------------------------------------------------
export const T = {
  bark: () => tex('bark', () => pixels(S, (u, v) => {
    const n = fbmT(u * 0.3, v, 8, 1), streak = tn(u, v * 0.15, 16, 3);
    return mul(mix([70, 50, 34], [112, 82, 55], n), 0.7 + streak * 0.5);
  })),
  needles: () => tex('needles', () => pixels(S, (u, v) => {
    const n = fbmT(u, v, 10, 5), f = tn(u, v, 32, 8);
    const c = mix([30, 62, 46], [58, 98, 62], n);
    return f > 0.8 ? mix(c, [120, 150, 90], 0.5) : c;
  })),
  palm: () => tex('palm', () => pixels(S, (u, v) => {
    const vein = Math.abs(Math.sin(v * Math.PI * 16)) * 0.5, mid = Math.abs(u - 0.5) < 0.03 ? 0.5 : 0;
    const n = fbmT(u, v, 8, 11);
    return mul(mix([66, 120, 58], [112, 160, 72], n), 0.8 + vein * 0.3 + mid);
  })),
  basalt: () => tex('basalt', () => pixels(S, (u, v) => {
    // cellular cracks
    const cells = 7; let d1 = 9, d2 = 9;
    const cx = Math.floor(u * cells), cy = Math.floor(v * cells);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const ax = ((cx + i) % cells + cells) % cells, ay = ((cy + j) % cells + cells) % cells;
      const px = cx + i + hash(ax, ay, 21), py = cy + j + hash(ax, ay, 22);
      const d = Math.hypot(u * cells - px, v * cells - py);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    const edge = Math.min(1, (d2 - d1) * 5);
    const n = fbmT(u, v, 12, 31);
    return mul(mix([52, 54, 62], [92, 92, 98], n), 0.5 + edge * 0.5);
  })),
  sandstone: () => tex('sandstone', () => pixels(S, (u, v) => {
    const layer = Math.sin(v * Math.PI * 10 + fbmT(u, v, 6, 41) * 5) * 0.5 + 0.5;
    return mul(mix([170, 144, 104], [208, 184, 140], layer), 0.85 + fbmT(u, v, 16, 43) * 0.3);
  })),
  mossrock: () => tex('mossrock', () => pixels(S, (u, v) => {
    const n = fbmT(u, v, 10, 51), m = fbmT(u, v, 5, 53);
    return mix(mix([88, 86, 80], [126, 120, 108], n), [64, 96, 58], m > 0.55 ? (m - 0.55) * 3 : 0);
  })),
  planks: () => tex('planks', () => pixels(S, (u, v) => {
    const boards = 5, b = Math.floor(v * boards), fv = (v * boards) % 1;
    const tone = 0.75 + hash(b, 0, 61) * 0.5, grain = fbmT(u * 0.2 + b * 0.37, v * 0.3, 8, 63);
    const gap = fv < 0.06 ? 0.45 : 1;
    return mul(mix([112, 80, 52], [158, 118, 76], grain), tone * gap);
  })),
  hull: () => tex('hull', () => pixels(S, (u, v) => {
    const boards = 4, b = Math.floor(u * boards), fu = (u * boards) % 1;
    const grain = fbmT(u * 0.4, v * 0.12 + b * 0.31, 8, 71), tone = 0.7 + hash(b, 2, 73) * 0.4;
    const weather = fbmT(u, v, 6, 75);
    const c = mix([86, 66, 50], [122, 104, 84], grain);
    return mul(mix(c, [110, 122, 112], weather > 0.6 ? (weather - 0.6) * 1.6 : 0), tone * (fu < 0.05 ? 0.4 : 1));
  })),
  thatch: () => tex('thatch', () => pixels(S, (u, v) => {
    const s = Math.sin((u * 40 + fbmT(u, v, 8, 81) * 6)) * 0.5 + 0.5;
    return mul(mix([150, 124, 70], [200, 172, 104], fbmT(u, v, 10, 83)), 0.72 + s * 0.35);
  })),
  lighthouse: () => tex('lighthouse', () => pixels(S, (u, v) => {
    const band = Math.floor(v * 4) % 2;
    const n = fbmT(u, v, 14, 91);
    const base = band ? [176, 62, 46] : [232, 224, 204];
    return mul(base, 0.86 + n * 0.25);
  })),
  stone: () => tex('stone', () => pixels(S, (u, v) => {
    const n = fbmT(u, v, 9, 101), l = fbmT(u, v, 4, 103);
    return mix(mix([100, 100, 98], [150, 146, 138], n), [92, 118, 80], l > 0.6 ? (l - 0.6) * 2 : 0);
  })),
  cloth: () => tex('cloth', () => pixels(S, (u, v) => {
    const w = (Math.sin(u * S * 1.6) + Math.sin(v * S * 1.6)) * 0.04;
    return mul(mix([196, 184, 152], [226, 214, 182], fbmT(u, v, 8, 111)), 0.9 + w);
  })),
  brass: () => tex('brass', () => pixels(S, (u, v) => mul(mix([150, 112, 48], [214, 170, 80], fbmT(u, v, 6, 121)), 0.85 + tn(u, v, 24, 123) * 0.3))),
  steel: () => tex('steel', () => pixels(S, (u, v) => mul([170, 178, 184], 0.8 + tn(u * 0.1, v, 32, 131) * 0.3))),
  jersey: () => tex('jersey', () => pixels(S, (u, v) => ((Math.floor(v * 8) % 2) ? [36, 56, 92] : [226, 218, 194]).map((c) => c * (0.9 + tn(u, v, 24, 141) * 0.2)))),
  slicker: () => tex('slicker', () => pixels(S, (u, v) => mul([232, 184, 40], 0.86 + fbmT(u, v, 6, 151) * 0.3))),
  coat: () => tex('coat', () => pixels(S, (u, v) => mul(mix([36, 44, 78], [54, 62, 100], fbmT(u, v, 10, 161)), 0.9 + Math.sin(v * S * 1.2) * 0.04))),
  feather: () => tex('feather', () => pixels(S, (u, v) => {
    const f = Math.sin((u + Math.abs(v - 0.5) * 0.6) * Math.PI * 14) * 0.5 + 0.5;
    return mul([236, 238, 236], 0.8 + f * 0.22);
  })),
  shell: () => tex('shell', () => pixels(S, (u, v) => {
    const a = Math.atan2(v - 0.5, u - 0.5), r = Math.hypot(u - 0.5, v - 0.5);
    const sp = Math.sin(a * 2 + r * 28) * 0.5 + 0.5;
    return mul(mix([190, 96, 70], [238, 196, 150], sp), 0.85 + fbmT(u, v, 8, 171) * 0.25);
  })),
  skin: () => tex('skin', () => pixels(S, (u, v) => mul([222, 176, 140], 0.92 + fbmT(u, v, 6, 181) * 0.16))),
  crab: () => tex('crab', () => pixels(S, (u, v) => mul(mix([184, 70, 48], [224, 110, 72], fbmT(u, v, 8, 191)), 0.9 + tn(u, v, 20, 193) * 0.2))),
  rust: () => tex('rust', () => pixels(S, (u, v) => mix([70, 70, 74], [150, 82, 48], fbmT(u, v, 8, 201)))),
  leather: () => tex('leather', () => pixels(S, (u, v) => mul(mix([70, 46, 30], [104, 70, 44], fbmT(u, v, 12, 211)), 0.9))),
  gold: () => tex('gold', () => pixels(S, (u, v) => mul(mix([200, 150, 40], [250, 210, 100], fbmT(u, v, 6, 221)), 0.9))),
  pearl: () => tex('pearl', () => pixels(S, (u, v) => mix([226, 232, 238], [210, 190, 226], fbmT(u, v, 5, 231)))),
};

// ---- alpha-cut textures ----------------------------------------------------
export const A = {
  tuft: () => tex('tuft', () => make(S, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {
      const x = s * (0.1 + hash(i, 1, 301) * 0.8), h = s * (0.35 + hash(i, 2, 303) * 0.6), lean = (hash(i, 3, 305) - 0.5) * s * 0.3;
      const g = 90 + hash(i, 4, 307) * 70;
      ctx.strokeStyle = `rgb(${g * 0.55 | 0},${g | 0},${g * 0.45 | 0})`; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(x, s); ctx.quadraticCurveTo(x + lean * 0.3, s - h * 0.6, x + lean, s - h); ctx.stroke();
    }
  }), { wrap: false }),
  reed: () => tex('reed', () => make(S, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    for (let i = 0; i < 12; i++) {
      const x = s * (0.12 + hash(i, 1, 311) * 0.76), h = s * (0.55 + hash(i, 2, 313) * 0.42), lean = (hash(i, 3, 315) - 0.5) * s * 0.22;
      ctx.strokeStyle = `rgb(${130 + hash(i, 4, 317) * 40 | 0},${150 + hash(i, 5, 319) * 40 | 0},${78 | 0})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, s); ctx.quadraticCurveTo(x, s - h * 0.5, x + lean, s - h); ctx.stroke();
      if (i % 3 === 0) { ctx.fillStyle = '#5a4630'; ctx.beginPath(); ctx.ellipse(x + lean, s - h - 3, 3, 9, 0, 0, 7); ctx.fill(); }
    }
  }), { wrap: false }),
  glow: () => tex('glow', () => make(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }), { wrap: false }),
  cloud: () => tex('cloud', () => make(128, (ctx, s) => {
    for (let i = 0; i < 14; i++) {
      const x = s * (0.2 + hash(i, 1, 331) * 0.6), y = s * (0.42 + hash(i, 2, 333) * 0.2), r = s * (0.12 + hash(i, 3, 335) * 0.14);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,248,236,0.55)'); g.addColorStop(1, 'rgba(255,248,236,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    }
  }), { wrap: false }),
  ring: () => tex('ring', () => make(128, (ctx, s) => {
    ctx.clearRect(0, 0, s, s); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.42, 0, 7); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.3, 0, 7); ctx.stroke();
  }), { wrap: false }),
  rune: () => tex('rune', () => make(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(255,196,110,0.95)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.46, 0, 7); ctx.stroke();
    ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.38, 0, 7); ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, r1 = s * 0.38, r2 = s * 0.46;
      ctx.beginPath(); ctx.moveTo(s / 2 + Math.cos(a) * r1, s / 2 + Math.sin(a) * r1); ctx.lineTo(s / 2 + Math.cos(a) * r2, s / 2 + Math.sin(a) * r2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,196,110,0.8)'; ctx.beginPath(); ctx.arc(s / 2 + Math.cos(a + 0.26) * s * 0.42, s / 2 + Math.sin(a + 0.26) * s * 0.42, 3, 0, 7); ctx.fill();
    }
  }), { wrap: false }),
  beam: () => tex('beam', () => make(64, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, s, 0);
    g.addColorStop(0, 'rgba(255,236,170,0.9)'); g.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }), { wrap: false }),
  column: () => tex('column', () => make(64, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.75)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }), { wrap: false }),
};

// Tileable water normal map (sum of periodic waves, analytic derivatives).
export function waterNormal() {
  return tex('waterN', () => {
    const size = 256;
    const waves = [[3, 1, 0.5, 0.0], [-2, 4, 0.4, 1.3], [5, -3, 0.25, 2.1], [1, 6, 0.2, 0.7], [-6, -2, 0.18, 4.0], [8, 5, 0.1, 5.2]];
    return pixels(size, (u, v) => {
      let dx = 0, dy = 0;
      for (const [fx, fy, a, ph] of waves) { const c = Math.cos(Math.PI * 2 * (fx * u + fy * v) + ph) * a * Math.PI * 2; dx += c * fx; dy += c * fy; }
      const k = 0.04; let nx = -dx * k, ny = -dy * k, nz = 1; const l = Math.hypot(nx, ny, nz);
      return [(nx / l * 0.5 + 0.5) * 255, (ny / l * 0.5 + 0.5) * 255, (nz / l * 0.5 + 0.5) * 255];
    });
  }, { srgb: false });
}

export function disposeAll() { for (const t of cache.values()) t.dispose(); cache.clear(); }
