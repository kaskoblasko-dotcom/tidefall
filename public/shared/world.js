// Deterministic, handcrafted world definition shared by server and client.
// The server uses it for line-of-sight, validation and relic placement; the
// client uses it for terrain mesh, props, collision and the minimap.
import { WORLD, PLAYER, clamp, lerp, smoothstep } from './constants.js';

// ---- noise ----------------------------------------------------------------
function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm(x, z, seed = 0, oct = 3) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * (vnoise(x * f, z * f, seed + i * 17) * 2 - 1); f *= 2.03; a *= 0.5; }
  return s;
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- landmass description --------------------------------------------------
export const LIGHTHOUSE = { x: 2, z: -8, plateauY: 15, plateauR: 13 };
export const BANK = { x: LIGHTHOUSE.x, z: LIGHTHOUSE.z + 8, r: 4.6 };

const LUMPS = [
  { x: 0,   z: -6,  s: 46, h: 8.4 },   // central massif
  { x: 2,   z: -8,  s: 19, h: 14 },    // Basalt Peak
  { x: -42, z: -46, s: 25, h: 12.5 },  // Pine Cliffs
  { x: -64, z: -22, s: 15, h: 8.5 },
  { x: 46,  z: 34,  s: 30, h: 8.6 },   // Sunbaked Shoals
  { x: 62,  z: 6,   s: 14, h: 6.4 },
  { x: 8,   z: 62,  s: 30, h: 7.4 },   // Salt Marsh
  { x: -30, z: 58,  s: 16, h: 6.2 },
  { x: -96, z: 38,  s: 12, h: 15.5 },  // Gull Rock
  { x: 88,  z: -36, s: 10, h: 19 },    // Kraken Teeth
  { x: 98,  z: -54, s: 6.5, h: 16 },
  { x: 77,  z: -18, s: 6.5, h: 12 },
  { x: 30,  z: -72, s: 18, h: 8.6 },   // north headland
];
const RIDGES = [ // tidal causeways: crest is only exposed at low tide
  { ax: -66, az: 22, bx: -90, bz: 36, w: 3.2, h: 5.3 },
  { ax: 56, az: -4, bx: 76, bz: -17, w: 3.4, h: 5.2 },
];
const PITS = [ // tidal basins carved into the lowlands
  { x: 10, z: 66, s: 9, h: -3.2 },
  { x: 62, z: 52, s: 9, h: -3.2 },
  { x: 28, z: -92, s: 8, h: -3.0 },
  { x: -64, z: 62, s: 9, h: -3.2 },
  { x: 8, z: 98, s: 6, h: -2.4 },
  { x: 74, z: -74, s: 6, h: -2.4 },
];

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  const cx = ax + dx * t - px, cz = az + dz * t - pz;
  return Math.sqrt(cx * cx + cz * cz);
}

function heightRaw(x, z) {
  let h = -5.5;
  for (const l of LUMPS) { const d2 = (x - l.x) ** 2 + (z - l.z) ** 2; h += l.h * Math.exp(-d2 / (2 * l.s * l.s)); }
  for (const r of RIDGES) { const d = segDist(x, z, r.ax, r.az, r.bx, r.bz); h += r.h * Math.exp(-(d * d) / (2 * r.w * r.w)); }
  for (const p of PITS) { const d2 = (x - p.x) ** 2 + (z - p.z) ** 2; h += p.h * Math.exp(-d2 / (2 * p.s * p.s)); }
  const land = clamp((h + 2) / 6, 0, 1);
  h += (fbm(x * 0.035, z * 0.035, 3, 4) * 2.6 + fbm(x * 0.12, z * 0.12, 9, 2) * 0.55) * land;
  // tidal shelf: gentle flats between low and high tide
  const sh = smoothstep(-2.6, -1.2, h) * (1 - smoothstep(1.6, 3.0, h));
  h += (0.45 - h) * 0.5 * sh;
  // Beacon plateau
  const lr = Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z);
  h = lerp(h, LIGHTHOUSE.plateauY, smoothstep(LIGHTHOUSE.plateauR + 9, LIGHTHOUSE.plateauR, lr));
  // deep water beyond the playable sea limit
  const r = Math.hypot(x, z);
  h -= smoothstep(96, 126, r) * 7;
  return h;
}

// ---- height grid -----------------------------------------------------------
const N = Math.round(WORLD.size / WORLD.cell);   // cells per side
const NV = N + 1;
const HALF = WORLD.size / 2;
const CELL = WORLD.cell;
export const GRID = { N, NV, HALF, CELL };
export const heights = new Float32Array(NV * NV);
for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) heights[j * NV + i] = heightRaw(i * CELL - HALF, j * CELL - HALF);

export function heightAt(x, z) {
  const gx = (x + HALF) / CELL, gz = (z + HALF) / CELL;
  let i = Math.floor(gx), j = Math.floor(gz);
  if (i < 0) i = 0; else if (i > N - 1) i = N - 1;
  if (j < 0) j = 0; else if (j > N - 1) j = N - 1;
  const fx = clamp(gx - i, 0, 1), fz = clamp(gz - j, 0, 1);
  const a = heights[j * NV + i], b = heights[j * NV + i + 1], c = heights[(j + 1) * NV + i], d = heights[(j + 1) * NV + i + 1];
  if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
  return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}
export function slopeAt(x, z) {
  const e = 0.8;
  const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
  const gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  return Math.hypot(gx, gz);
}

// ---- biomes ----------------------------------------------------------------
export const BIOMES = ['sand', 'marsh', 'meadow', 'pine', 'basalt'];
const PEAK = { x: 2, z: -8 };
export function biomeWeights(x, z, y, slope, out = [0, 0, 0, 0, 0]) {
  const dMarsh = Math.min(Math.hypot(x - 8, z - 64), Math.hypot(x + 30, z - 58) * 1.15);
  const marsh = smoothstep(42, 28, dMarsh) * smoothstep(5.6, 3.8, y);
  const dPine = Math.hypot(x + 46, z + 42);
  let basalt = Math.max(
    smoothstep(11.5, 15, y) * smoothstep(40, 24, Math.hypot(x - PEAK.x, z - PEAK.z)),
    smoothstep(26, 14, Math.hypot(x - 90, z + 40)) * smoothstep(2.5, 7, y),
    smoothstep(22, 10, Math.hypot(x + 96, z - 38)) * smoothstep(3, 8, y),
    smoothstep(0.8, 1.15, slope) * smoothstep(3, 6, y));
  const pine = smoothstep(52, 32, dPine) * smoothstep(3.6, 5.6, y) * (1 - basalt);
  const sand = smoothstep(5.0, 3.2, y) * (1 - marsh) * (1 - pine * 0.6);
  let meadow = Math.max(0, 1 - sand - marsh - pine - basalt);
  const t = sand + marsh + pine + basalt + meadow || 1;
  out[0] = sand / t; out[1] = marsh / t; out[2] = meadow / t; out[3] = pine / t; out[4] = basalt / t;
  return out;
}

// ---- colliders (circles with height) and platforms -------------------------
export const colliders = [];
export const platforms = [];       // oriented rectangles walkable on top
const HASH_CELL = 8;
const hash = new Map();
const hkey = (cx, cz) => (cx + 64) * 128 + (cz + 64);
function addCollider(c) {
  colliders.push(c);
  const x0 = Math.floor((c.x - c.r) / HASH_CELL), x1 = Math.floor((c.x + c.r) / HASH_CELL);
  const z0 = Math.floor((c.z - c.r) / HASH_CELL), z1 = Math.floor((c.z + c.r) / HASH_CELL);
  for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
    const k = hkey(cx, cz); let a = hash.get(k); if (!a) { a = []; hash.set(k, a); } a.push(c);
  }
  return c;
}
function near(x, z) { return hash.get(hkey(Math.floor(x / HASH_CELL), Math.floor(z / HASH_CELL))) || EMPTY; }
const EMPTY = [];

function platformTop(p, x, z) {
  const dx = x - p.x, dz = z - p.z, c = Math.cos(p.rot), s = Math.sin(p.rot);
  const lx = dx * c + dz * s, lz = -dx * s + dz * c;
  return Math.abs(lx) <= p.hl && Math.abs(lz) <= p.hw ? p.top : -Infinity;
}

// Highest walkable surface at (x,z) for something whose feet are at feetY.
export function surfaceAt(x, z, feetY = Infinity) {
  let h = heightAt(x, z);
  for (const c of near(x, z)) {
    const dx = x - c.x, dz = z - c.z;
    if (dx * dx + dz * dz < c.r * c.r) { const top = c.y0 + c.h; if (feetY >= top - PLAYER.step - 0.1 && top > h) h = top; }
  }
  for (const p of platforms) { const t = platformTop(p, x, z); if (t > h && feetY >= t - PLAYER.step - 0.1) h = t; }
  return h;
}

// Push a circle (x,z,radius) out of colliders it overlaps (only those taller than its feet).
export function resolveCollisions(pos, radius, feetY) {
  for (let it = 0; it < 2; it++) {
    for (const c of near(pos.x, pos.z)) {
      if (feetY >= c.y0 + c.h - PLAYER.step) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z, min = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 0.0001;
        pos.x = c.x + (dx / d) * min; pos.z = c.z + (dz / d) * min;
      }
    }
  }
  return pos;
}

// March a ray against terrain + colliders. Returns hit distance or -1.
export function raycast(ox, oy, oz, dx, dy, dz, maxT, step = 0.55) {
  for (let t = step; t <= maxT; t += step) {
    const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
    if (y < heightAt(x, z)) return t;
    for (const c of near(x, z)) {
      const ddx = x - c.x, ddz = z - c.z;
      if (ddx * ddx + ddz * ddz < c.r * c.r && y < c.y0 + c.h && y > c.y0) return t;
    }
    for (const p of platforms) if (y < p.top && y > p.top - 0.5 && platformTop(p, x, z) > -Infinity) return t;
  }
  return -1;
}

// ---- spot finding ----------------------------------------------------------
function findSpot(cx, cz, { yMin, yMax, maxSlope = 0.25, flatR = 0, avoid = [], minDist = 0 }) {
  let best = null, bd = Infinity;
  for (let j = 4; j < NV - 4; j++) for (let i = 4; i < NV - 4; i++) {
    const x = i * CELL - HALF, z = j * CELL - HALF, y = heights[j * NV + i];
    if (y < yMin || y > yMax) continue;
    const d = Math.hypot(x - cx, z - cz);
    if (d >= bd) continue;
    if (slopeAt(x, z) > maxSlope) continue;
    if (Math.hypot(x, z) > 100) continue;
    let ok = true;
    if (flatR) for (let a = 0; a < 6 && ok; a++) {
      const px = x + Math.cos(a * 1.047) * flatR, pz = z + Math.sin(a * 1.047) * flatR, py = heightAt(px, pz);
      if (Math.abs(py - y) > 0.9 || py < yMin - 0.9) ok = false;
    }
    for (const o of avoid) if (Math.hypot(x - o.x, z - o.z) < (o.r || 8) + minDist) ok = false;
    if (ok) { bd = d; best = { x, z, y }; }
  }
  if (!best) throw new Error(`no spot near ${cx},${cz}`);
  return best;
}

// ---- structures ------------------------------------------------------------
export const structures = { lighthouse: LIGHTHOUSE, bank: BANK, wrecks: [], huts: [], stones: [], piers: [] };
export const RELIC_SITES = [];
export const SPAWNS = [];
const reserved = [{ x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, r: 16 }];

addCollider({ x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, r: 4.3, y0: LIGHTHOUSE.plateauY - 1, h: 60, kind: 'lighthouse' });
for (let i = 0; i < 11; i++) { // standing stones around the beacon, open to the south
  const a = (i / 11) * Math.PI * 2 + 0.35;
  if (Math.sin(a) > 0.55) continue;
  const x = LIGHTHOUSE.x + Math.cos(a) * 11.5, z = LIGHTHOUSE.z + Math.sin(a) * 11.5;
  const y = heightAt(x, z);
  structures.stones.push({ x, y, z, h: 3 + (i % 3) * 0.7, rot: a });
  addCollider({ x, z, r: 0.75, y0: y - 0.5, h: 3.2, kind: 'stone' });
}
{ const y = heightAt(BANK.x, BANK.z); addCollider({ x: BANK.x, z: BANK.z, r: 0.7, y0: y, h: 1.1, kind: 'brazier' }); }

// Four wrecks lying in tidal basins, each holding two pearls.
const WRECK_DEFS = [
  { name: 'Mudlark',        cx: 10,  cz: 66,  rot: 0.5 },
  { name: 'Saltcrown',      cx: 62,  cz: 52,  rot: 2.2 },
  { name: 'The Long Haul',  cx: 28,  cz: -92, rot: 1.2 },
  { name: "Lantern's Rest", cx: -64, cz: 62,  rot: 2.9 },
];
for (const w of WRECK_DEFS) {
  const s = findSpot(w.cx, w.cz, { yMin: -0.3, yMax: 0.9, maxSlope: 0.2, flatR: 5, avoid: reserved });
  const wreck = { name: w.name, x: s.x, z: s.z, y: s.y, rot: w.rot, a: 6.4, b: 2.5, ribs: [] };
  const n = 14;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(t), Math.cos(t)) - Math.PI) < 0.5) continue; // broken stern
    const lx = Math.cos(t) * wreck.a, lz = Math.sin(t) * wreck.b;
    const x = s.x + lx * Math.cos(w.rot) - lz * Math.sin(w.rot), z = s.z + lx * Math.sin(w.rot) + lz * Math.cos(w.rot);
    const y = heightAt(x, z);
    wreck.ribs.push({ x, z, y, t });
    addCollider({ x, z, r: 0.95, y0: y - 0.3, h: 2.6, kind: 'hull' });
  }
  structures.wrecks.push(wreck);
  reserved.push({ x: s.x, z: s.z, r: 10 });
  for (const off of [-1.6, 1.4]) {
    const x = s.x + Math.cos(w.rot) * off, z = s.z + Math.sin(w.rot) * off;
    RELIC_SITES.push({ kind: 'pearl', value: 1, respawn: 30, x, z, y: heightAt(x, z), name: w.name });
  }
}
// Idols on sun-baked flats
for (const d of [{ cx: 8, cz: 90, n: 'Marsh Idol' }, { cx: 62, cz: 40, n: 'Shoal Idol' }, { cx: 40, cz: -88, n: 'Headland Idol' }]) {
  const s = findSpot(d.cx, d.cz, { yMin: 0.1, yMax: 1.2, maxSlope: 0.2, flatR: 2, avoid: reserved, minDist: 2 });
  RELIC_SITES.push({ kind: 'idol', value: 2, respawn: 45, x: s.x, z: s.z, y: s.y, name: d.n });
  reserved.push({ x: s.x, z: s.z, r: 5 });
}
// Deep-tide pearls: only exposed near the lowest tides
for (const d of [{ cx: -60, cz: 74, n: 'Deepwater Pearl' }, { cx: 72, cz: -70, n: 'Abyss Pearl' }]) {
  const s = findSpot(d.cx, d.cz, { yMin: -1.15, yMax: -0.45, maxSlope: 0.3, avoid: reserved, minDist: 2 });
  RELIC_SITES.push({ kind: 'deep', value: 3, respawn: 70, x: s.x, z: s.z, y: s.y, name: d.n });
  reserved.push({ x: s.x, z: s.z, r: 5 });
}
// Gull Rock crown
{
  const s = findSpot(-96, 38, { yMin: 8, yMax: 40, maxSlope: 0.6, avoid: [] });
  RELIC_SITES.push({ kind: 'crown', value: 4, respawn: 90, x: s.x, z: s.z, y: s.y, name: 'Gull Crown' });
  reserved.push({ x: s.x, z: s.z, r: 6 });
}
RELIC_SITES.forEach((r, i) => { r.id = i + 1; });

// Piers (walkable platforms above max tide)
for (const p of [{ cx: 78, cz: 40, ang: 0 }, { cx: -22, cz: 84, ang: 1.6 }, { cx: 30, cz: -64, ang: -1.55 }]) {
  // walk outward from the centre until we reach the shore (height ~3.9)
  const ang = Math.atan2(p.cz, p.cx) + 0;
  let x = p.cx, z = p.cz, found = false;
  for (let r = 40; r < 110 && !found; r += 1) {
    const px = Math.cos(ang) * r + (p.cx - Math.cos(ang) * Math.hypot(p.cx, p.cz)), pz = Math.sin(ang) * r + (p.cz - Math.sin(ang) * Math.hypot(p.cx, p.cz));
    const y = heightAt(px, pz);
    if (y < 3.9 && y > 3.0) { x = px; z = pz; found = true; }
  }
  if (!found) continue;
  const len = 16, width = 3.2, top = 4.15;
  const rot = ang;
  const cxp = x + Math.cos(rot) * (len / 2 - 2), czp = z + Math.sin(rot) * (len / 2 - 2);
  const pier = { x: cxp, z: czp, rot, hl: len / 2, hw: width / 2, top };
  platforms.push(pier);
  structures.piers.push(pier);
  reserved.push({ x: cxp, z: czp, r: 8 });
}

// Fishing huts (ring walls with a door gap)
for (const hdef of [{ cx: 60, cz: 20 }, { cx: -30, cz: 50 }, { cx: 20, cz: -60 }, { cx: -70, cz: -10 }]) {
  const s = findSpot(hdef.cx, hdef.cz, { yMin: 4.0, yMax: 7.5, maxSlope: 0.18, flatR: 3.2, avoid: reserved, minDist: 3 });
  const hut = { x: s.x, z: s.z, y: s.y, rot: Math.atan2(-s.z, -s.x) };
  structures.huts.push(hut);
  reserved.push({ x: s.x, z: s.z, r: 7 });
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = hut.rot + (i / n) * Math.PI * 2;
    if (i === 0 || i === 1 && false) continue; // door
    const x = s.x + Math.cos(a) * 2.8, z = s.z + Math.sin(a) * 2.8, y = heightAt(x, z);
    addCollider({ x, z, r: 0.85, y0: y - 0.5, h: 2.6, kind: 'hut' });
  }
}

// Spawns on shorelines safely above max tide
{
  const want = 18;
  for (let k = 0; k < want; k++) {
    const a = (k / want) * Math.PI * 2 + 0.2;
    let spot = null;
    for (let r = 108; r > 12; r -= 1) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r, y = heightAt(x, z);
      if (y >= 4.0 && y <= 6.2 && slopeAt(x, z) < 0.35 && !near(x, z).some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 1.5)) { spot = { x, z, y }; break; }
    }
    if (spot && !SPAWNS.some((s) => Math.hypot(s.x - spot.x, s.z - spot.z) < 14)) SPAWNS.push(spot);
  }
  if (SPAWNS.length < 4) SPAWNS.push({ x: BANK.x, z: BANK.z + 6, y: heightAt(BANK.x, BANK.z + 6) });
}

// ---- scattered props (deterministic) ---------------------------------------
export const props = { pines: [], palms: [], rocks: [], reeds: [], tufts: [], shells: [], driftwood: [] };
{
  const R = rng(1337);
  const occ = new Set();
  const okSpace = (x, z, cell) => !occ.has(Math.floor(x / cell) * 4096 + Math.floor(z / cell));
  const mark = (x, z, cell) => occ.add(Math.floor(x / cell) * 4096 + Math.floor(z / cell));
  const free = (x, z, extra = 0) => {
    for (const o of reserved) if (Math.hypot(x - o.x, z - o.z) < o.r + extra) return false;
    for (const s of SPAWNS) if (Math.hypot(x - s.x, z - s.z) < 4 + extra) return false;
    for (const p of platforms) if (Math.hypot(x - p.x, z - p.z) < p.hl + 3) return false;
    return Math.hypot(x, z) < 108;
  };
  const w = [0, 0, 0, 0, 0];
  const pick = (tries, fn) => { for (let i = 0; i < tries; i++) { const x = (R() - 0.5) * 220, z = (R() - 0.5) * 220; fn(x, z, heightAt(x, z), slopeAt(x, z)); } };

  pick(5000, (x, z, y, sl) => {
    if (props.pines.length >= 260 || y < 4 || y > 18 || sl > 0.7 || !free(x, z, 1)) return;
    biomeWeights(x, z, y, sl, w);
    if (w[3] < 0.3 + R() * 0.3 || !okSpace(x, z, 3)) return;
    mark(x, z, 3);
    const s = 0.8 + R() * 0.9;
    props.pines.push({ x, y, z, s, rot: R() * 6.28 });
    addCollider({ x, z, r: 0.5 * s, y0: y - 0.5, h: 14, kind: 'tree' });
  });
  pick(3000, (x, z, y, sl) => { // meadow trees: a few broadleaf-ish pines at lower density
    if (props.pines.length >= 300 || y < 5.5 || y > 12 || sl > 0.5 || !free(x, z, 1) || R() > 0.07) return;
    biomeWeights(x, z, y, sl, w);
    if (w[2] < 0.5 || !okSpace(x, z, 4)) return;
    mark(x, z, 4);
    const s = 0.7 + R() * 0.5;
    props.pines.push({ x, y, z, s, rot: R() * 6.28 });
    addCollider({ x, z, r: 0.5 * s, y0: y - 0.5, h: 14, kind: 'tree' });
  });
  pick(4000, (x, z, y, sl) => {
    if (props.palms.length >= 70 || y < 3.2 || y > 6.0 || sl > 0.4 || !free(x, z, 1)) return;
    biomeWeights(x, z, y, sl, w);
    if (w[0] < 0.4 || !okSpace(x, z, 4.5)) return;
    mark(x, z, 5);
    props.palms.push({ x, y, z, s: 0.85 + R() * 0.5, rot: R() * 6.28, lean: (R() - 0.5) * 0.5 });
    addCollider({ x, z, r: 0.38, y0: y - 0.5, h: 9, kind: 'tree' });
  });
  pick(7000, (x, z, y, sl) => {
    if (props.rocks.length >= 190 || y < 0.6 || !free(x, z, 0.5)) return;
    biomeWeights(x, z, y, sl, w);
    const chance = 0.1 + w[4] * 0.9 + sl * 0.5 + (y < 4.2 ? 0.06 : 0);
    if (R() > chance) return;
    const big = w[4] > 0.4 && R() < 0.3;
    const s = big ? 2 + R() * 2.2 : 0.5 + R() * 1.1;
    props.rocks.push({ x, y, z, s, rot: R() * 6.28, kind: w[4] > 0.4 ? 1 : w[1] > 0.4 ? 2 : 0, sq: 0.7 + R() * 0.6 });
    if (s > 1.3) addCollider({ x, z, r: s * 0.85, y0: y - 0.4, h: s * 1.2, kind: 'rock' });
  });
  pick(9000, (x, z, y, sl) => {
    if (props.reeds.length >= 900 || y < -4 || y > 9.0) return;
    biomeWeights(x, z, y, sl, w);
    if (w[2] + w[1] + w[0] * 0.5 < 0.35 || R() > 0.6 || !free(x, z, 0)) return;
    props.reeds.push({ x, y, z, s: 0.8 + R() * 0.9, rot: R() * 6.28 });
  });
  pick(9000, (x, z, y, sl) => {
    if (props.tufts.length >= 700 || y < 3.6 || sl > 0.7) return;
    biomeWeights(x, z, y, sl, w);
    if (w[2] + w[3] * 0.6 + w[0] * 0.15 < 0.45 || R() > 0.7 || !free(x, z, 0)) return;
    props.tufts.push({ x, y, z, s: 0.7 + R() * 0.7, rot: R() * 6.28 });
  });
  pick(6000, (x, z, y, sl) => {
    if (props.shells.length >= 110 || y < 0.9 || y > 4.2 || sl > 0.4) return;
    biomeWeights(x, z, y, sl, w);
    if (w[0] < 0.6 || !free(x, z, 0)) return;
    props.shells.push({ x, y, z, s: 0.5 + R() * 0.6, rot: R() * 6.28, kind: R() < 0.5 ? 0 : 1 });
  });
  pick(5000, (x, z, y, sl) => {
    if (props.driftwood.length >= 36 || y < 2.4 || y > 4.8 || sl > 0.3 || !free(x, z, 1)) return;
    biomeWeights(x, z, y, sl, w);
    if (w[0] < 0.6 || R() > 0.5) return;
    props.driftwood.push({ x, y, z, s: 1 + R() * 1.4, rot: R() * 6.28 });
  });
}

// ---- misc helpers ----------------------------------------------------------
export function relicExposed() { return true; } // everything is underwater: always collectable
export function depthAt(level, x, z) { return level - heightAt(x, z); }
export function inSea(x, z) { return Math.hypot(x, z) <= WORLD.seaLimit; }
export function clampToSea(pos) {
  const r = Math.hypot(pos.x, pos.z);
  if (r > WORLD.seaLimit) { pos.x *= WORLD.seaLimit / r; pos.z *= WORLD.seaLimit / r; }
  return pos;
}
