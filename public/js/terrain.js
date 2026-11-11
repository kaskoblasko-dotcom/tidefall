// Terrain mesh, baked biome albedo texture, tidal water, sky, clouds and lights.
import * as THREE from 'three';
import * as W from '../shared/world.js';
import { A, waterNormal } from './textures.js';
import { smoothstep, clamp } from '../shared/constants.js';

export const HORIZON = 0xe2d6b6;
export const SUN_DIR = new THREE.Vector3(-0.5, 0.62, 0.42).normalize();

const TEX = 1536;                       // baked terrain texture: 6 texels per metre
const sleep = () => new Promise((r) => setTimeout(r, 0));

// Colour tables (kept to one consistent, slightly desaturated palette).
const C = {
  sandA: [208, 186, 134], sandB: [226, 206, 156], seabed: [36, 84, 92], wetSand: [150, 128, 92],
  mudA: [96, 88, 64], mudB: [78, 104, 66], pool: [54, 72, 68],
  grassA: [102, 134, 72], grassB: [128, 150, 82], flower: [240, 218, 120],
  needleA: [100, 80, 56], needleB: [66, 90, 58],
  basalt: [58, 60, 67], basaltHi: [86, 88, 94], rust: [116, 74, 52],
  cliff: [120, 110, 98],
};

export async function bakeTerrainTexture(onProgress) {
  const { N, NV, HALF, CELL } = W.GRID;
  const H = W.heights;
  // per-vertex biome weights + slope
  const wts = new Float32Array(NV * NV * 5), slp = new Float32Array(NV * NV), w5 = [0, 0, 0, 0, 0];
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
    const x = i * CELL - HALF, z = j * CELL - HALF, k = j * NV + i;
    const gx = (H[j * NV + Math.min(i + 1, N)] - H[j * NV + Math.max(i - 1, 0)]) / (CELL * (i === 0 || i === N ? 1 : 2));
    const gz = (H[Math.min(j + 1, N) * NV + i] - H[Math.max(j - 1, 0) * NV + i]) / (CELL * (j === 0 || j === N ? 1 : 2));
    slp[k] = Math.hypot(gx, gz);
    W.biomeWeights(x, z, H[k], slp[k], w5);
    for (let b = 0; b < 5; b++) wts[k * 5 + b] = w5[b];
  }
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = TEX;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(TEX, TEX), d = img.data;
  const rowsPerSlice = 96;
  for (let py0 = 0; py0 < TEX; py0 += rowsPerSlice) {
    for (let py = py0; py < Math.min(TEX, py0 + rowsPerSlice); py++) {
      const z = ((py + 0.5) / TEX) * W.GRID.N * CELL - HALF;
      for (let px = 0; px < TEX; px++) {
        const x = ((px + 0.5) / TEX) * W.GRID.N * CELL - HALF;
        const gx = (x + HALF) / CELL, gz = (z + HALF) / CELL;
        const i = Math.min(N - 1, gx | 0), j = Math.min(N - 1, gz | 0), fx = gx - i, fz = gz - j;
        const k00 = j * NV + i, k10 = k00 + 1, k01 = k00 + NV, k11 = k01 + 1;
        const w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz), w01 = (1 - fx) * fz, w11 = fx * fz;
        const y = H[k00] * w00 + H[k10] * w10 + H[k01] * w01 + H[k11] * w11;
        const sl = slp[k00] * w00 + slp[k10] * w10 + slp[k01] * w01 + slp[k11] * w11;
        const n1 = W.vnoise(x * 1.3, z * 1.3, 5), n2 = W.vnoise(x * 0.16, z * 0.16, 6);
        const grain = (((px * 73856093) ^ (py * 19349663)) >>> 0) % 1000 / 1000;
        let r = 0, g = 0, b = 0;
        for (let bi = 0; bi < 5; bi++) {
          const wt = wts[k00 * 5 + bi] * w00 + wts[k10 * 5 + bi] * w10 + wts[k01 * 5 + bi] * w01 + wts[k11 * 5 + bi] * w11;
          if (wt < 0.01) continue;
          let c;
          if (bi === 0) { // sand with wind ripples
            const rip = Math.sin((x * 0.9 + z * 0.4) * 3.1 + n2 * 9) * 0.045;
            const t = clamp(n2 + rip * 3, 0, 1);
            c = [C.sandA[0] + (C.sandB[0] - C.sandA[0]) * t, C.sandA[1] + (C.sandB[1] - C.sandA[1]) * t, C.sandA[2] + (C.sandB[2] - C.sandA[2]) * t];
            const k = 1 + rip + (grain - 0.5) * 0.07; c = [c[0] * k, c[1] * k, c[2] * k];
          } else if (bi === 1) { // marsh mud and moss
            const moss = smoothstep(0.45, 0.65, n2 + (n1 - 0.5) * 0.3), poolT = smoothstep(1.0, 0.1, y);
            c = [C.mudA[0] + (C.mudB[0] - C.mudA[0]) * moss, C.mudA[1] + (C.mudB[1] - C.mudA[1]) * moss, C.mudA[2] + (C.mudB[2] - C.mudA[2]) * moss];
            c = [c[0] + (C.pool[0] - c[0]) * poolT, c[1] + (C.pool[1] - c[1]) * poolT, c[2] + (C.pool[2] - c[2]) * poolT];
            const k = 0.92 + n1 * 0.16; c = [c[0] * k, c[1] * k, c[2] * k];
          } else if (bi === 2) { // meadow with flecks of flowers
            const t = clamp(n2 * 0.8 + n1 * 0.4, 0, 1);
            c = [C.grassA[0] + (C.grassB[0] - C.grassA[0]) * t, C.grassA[1] + (C.grassB[1] - C.grassA[1]) * t, C.grassA[2] + (C.grassB[2] - C.grassA[2]) * t];
            const k = 0.92 + grain * 0.16; c = [c[0] * k, c[1] * k, c[2] * k];
            if (grain > 0.992) c = C.flower;
          } else if (bi === 3) { // pine litter
            const t = smoothstep(0.35, 0.7, n2);
            c = [C.needleA[0] + (C.needleB[0] - C.needleA[0]) * t, C.needleA[1] + (C.needleB[1] - C.needleA[1]) * t, C.needleA[2] + (C.needleB[2] - C.needleA[2]) * t];
            const k = 0.82 + n1 * 0.3 + (grain > 0.97 ? 0.25 : 0); c = [c[0] * k, c[1] * k, c[2] * k];
          } else { // basalt with cracks and rust stains
            const crack = Math.abs(W.vnoise(x * 0.55, z * 0.55, 8) - 0.5) < 0.035 ? 0.55 : 1;
            const t = n1;
            c = [C.basalt[0] + (C.basaltHi[0] - C.basalt[0]) * t, C.basalt[1] + (C.basaltHi[1] - C.basalt[1]) * t, C.basalt[2] + (C.basaltHi[2] - C.basalt[2]) * t];
            const rs = smoothstep(0.68, 0.85, n2) * 0.6; c = [c[0] + (C.rust[0] - c[0]) * rs, c[1] + (C.rust[1] - c[1]) * rs, c[2] + (C.rust[2] - c[2]) * rs];
            const k = crack * (0.9 + grain * 0.14); c = [c[0] * k, c[1] * k, c[2] * k];
          }
          r += c[0] * wt; g += c[1] * wt; b += c[2] * wt;
        }
        // steep faces show stratified cliff rock
        const rock = smoothstep(0.75, 1.15, sl) * smoothstep(1.5, 4, y);
        if (rock > 0) {
          const st = 1 + Math.sin(y * 3.6 + n1 * 3) * 0.09;
          r += (C.cliff[0] * st - r) * rock; g += (C.cliff[1] * st - g) * rock; b += (C.cliff[2] * st - b) * rock;
        }
        // wet sand band and sea-bed darkening so tidal flats read correctly
        const wet = smoothstep(2.0, 0.5, y) * smoothstep(-0.4, 0.6, y);
        const k = 1 - wet * 0.25; r *= k; g *= k * 0.99; b *= k * 1.02;
        const deep = smoothstep(0.2, -3.8, y);
        r += (C.seabed[0] - r) * deep * 0.88; g += (C.seabed[1] - g) * deep * 0.88; b += (C.seabed[2] - b) * deep * 0.88;
        const o = (py * TEX + px) * 4;
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
      }
    }
    if (onProgress) onProgress(Math.min(1, (py0 + rowsPerSlice) / TEX));
    await sleep();
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function buildTerrainMesh(canvas, renderer) {
  const { N, NV, HALF, CELL } = W.GRID;
  const pos = new Float32Array(NV * NV * 3), uv = new Float32Array(NV * NV * 2);
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
    const k = j * NV + i;
    pos[k * 3] = i * CELL - HALF; pos[k * 3 + 1] = W.heights[k]; pos[k * 3 + 2] = j * CELL - HALF;
    uv[k * 2] = i / N; uv[k * 2 + 1] = 1 - j / N;
  }
  const idx = new Uint32Array(N * N * 6);
  let p = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * NV + i, b = a + 1, c = a + NV, d = c + 1;   // same diagonal as W.heightAt
    idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.96, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

export function buildWater() {
  const nm = waterNormal();
  nm.repeat.set(90, 90);
  const geo = new THREE.PlaneGeometry(1400, 1400, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhongMaterial({
    color: 0x2f8088, specular: 0xffe6b8, shininess: 70, transparent: true, opacity: 0.8,
    normalMap: nm, normalScale: new THREE.Vector2(0.45, 0.45), depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  mesh.userData.nm = nm;
  return mesh;
}

export function buildSky() {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(900, 24, 16);
  const col = [], p = geo.attributes.position;
  const top = new THREE.Color(0x5f93b0), mid = new THREE.Color(0xa9cbd0), hor = new THREE.Color(HORIZON), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 900;
    if (y > 0) c.copy(hor).lerp(mid, smoothstep(0, 0.22, y)).lerp(top, smoothstep(0.2, 0.9, y));
    else c.copy(hor);
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  group.add(sky);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: A.glow(), color: 0xfff0c8, blending: THREE.AdditiveBlending, fog: false, depthWrite: false, transparent: true }));
  sun.scale.set(260, 260, 1); sun.position.copy(SUN_DIR).multiplyScalar(800); sun.renderOrder = -9;
  group.add(sun);
  const clouds = [];
  const cm = A.cloud();
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cm, color: 0xfff4e2, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
    const a = (i / 16) * Math.PI * 2 + (i % 3) * 0.3, r = 350 + (i % 5) * 70;
    s.position.set(Math.cos(a) * r, 130 + (i % 4) * 28, Math.sin(a) * r);
    s.scale.set(280 + (i % 3) * 60, 120, 1); s.renderOrder = -8;
    clouds.push(s); group.add(s);
  }
  group.userData.clouds = clouds;
  return group;
}

export function buildLights(scene) {
  const hemi = new THREE.HemisphereLight(0xcfe3ec, 0x7c6a4c, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0b0, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 1; sc.far = 220;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  return { hemi, sun };
}

export function updateSky(sky, camPos, dt) {
  sky.position.copy(camPos);
  for (const c of sky.userData.clouds) {
    c.position.x += dt * 1.6;
    if (c.position.x > 700) c.position.x = -700;
  }
}
