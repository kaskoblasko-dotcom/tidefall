// Handcrafted props and structures: instanced pines/palms/rocks/reeds, the
// lighthouse and beacon, standing stones, huts, shipwrecks, piers and clutter.
import * as THREE from 'three';
import * as W from '../shared/world.js';
import { T, A, repeated } from './textures.js';

const V3 = THREE.Vector3, Q = THREE.Quaternion, M4 = THREE.Matrix4, E = THREE.Euler;
const tmpM = new M4();
const mat4 = (px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new M4().compose(new V3(px, py, pz), new Q().setFromEuler(new E(rx, ry, rz)), new V3(sx, sy, sz));

// Merge geometries into one, baking per-part vertex colour multipliers.
function merge(parts) {
  const pos = [], nor = [], uv = [], col = [];
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    if (p.m) g.applyMatrix4(p.m);
    const pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv;
    for (let i = 0; i < pa.count; i++) {
      pos.push(pa.getX(i), pa.getY(i), pa.getZ(i)); nor.push(na.getX(i), na.getY(i), na.getZ(i));
      uv.push(ua ? ua.getX(i) : 0, ua ? ua.getY(i) : 0); col.push(p.color[0], p.color[1], p.color[2]);
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

function instanced(geo, mat, items, place, { cast = true, receive = true, tint = null } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  m.count = items.length;
  const o = new THREE.Object3D(), c = new THREE.Color();
  items.forEach((it, i) => {
    place(o, it, i); o.updateMatrix(); m.setMatrixAt(i, o.matrix);
    if (tint) { tint(c, it, i); m.setColorAt(i, c); }
  });
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.castShadow = cast; m.receiveShadow = receive; m.frustumCulled = false;
  return m;
}

const std = (map, extra = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, ...extra });
const hr = (a, b, s) => { const x = Math.sin(a * 127.1 + b * 311.7 + s * 74.7) * 43758.5453; return x - Math.floor(x); };

export function buildProps(scene) {
  const group = new THREE.Group();
  const animated = { flames: [], beam: null, light: null, glows: [] };
  const P = W.props;

  // ---- pines ---------------------------------------------------------------
  {
    const trunk = merge([{ geo: new THREE.CylinderGeometry(0.2, 0.34, 3.6, 6).translate(0, 1.8, 0), color: [1, 1, 1] }]);
    const tiers = [[2.5, 3.3, 3.0, 0.82], [2.0, 2.9, 5.0, 0.92], [1.5, 2.6, 6.8, 1.02], [0.95, 2.3, 8.4, 1.14]];
    const canopy = merge(tiers.map(([r, h, y, k]) => ({ geo: new THREE.ConeGeometry(r, h, 8, 1).translate(0, y + h / 2 - 0.4, 0), color: [k, k, k] })));
    const place = (o, p) => { o.position.set(p.x, p.y - 0.15, p.z); o.rotation.set(0, p.rot, 0); o.scale.set(p.s, p.s * (0.9 + hr(p.x, p.z, 1) * 0.3), p.s); };
    const tint = (c, p) => c.setScalar(0.85 + hr(p.x, p.z, 2) * 0.3);
    group.add(instanced(trunk, std(T.bark(), { vertexColors: true }), P.pines, place, { tint }));
    group.add(instanced(canopy, std(T.needles(), { vertexColors: true }), P.pines, place, { tint }));
  }

  // ---- palms ---------------------------------------------------------------
  {
    const parts = [], leaf = [];
    let px = 0, py = 0, ang = 0;
    for (let i = 0; i < 7; i++) {
      const h = 1.0, r0 = 0.24 - i * 0.012;
      parts.push({ geo: new THREE.CylinderGeometry(r0 - 0.012, r0, h, 6).translate(0, h / 2, 0), m: mat4(px, py, 0, 0, 0, -ang), color: [1, 1, 1] });
      px += Math.sin(ang) * h; py += Math.cos(ang) * h; ang += 0.07;
    }
    for (let k = 0; k < 9; k++) {
      const yaw = (k / 9) * Math.PI * 2 + hr(k, 1, 3) * 0.3, len = 1 + hr(k, 2, 5) * 0.25;
      const base = mat4(px, py, 0, 0, yaw, 0).multiply(mat4(0, 0, 0, -0.45, 0, 0));
      leaf.push({ geo: new THREE.BoxGeometry(0.62, 0.035, 1.5 * len).translate(0, 0, 0.75 * len), m: base, color: [1, 1, 1] });
      const seg2 = base.clone().multiply(mat4(0, 0, 1.5 * len, 0.95, 0, 0));
      leaf.push({ geo: new THREE.BoxGeometry(0.44, 0.03, 1.2 * len).translate(0, 0, 0.6 * len), m: seg2, color: [0.9, 0.95, 0.9] });
    }
    const place = (o, p) => { o.position.set(p.x, p.y - 0.1, p.z); o.rotation.set(0, p.rot, p.lean); o.scale.setScalar(p.s); };
    group.add(instanced(merge(parts), std(T.bark(), { vertexColors: true }), P.palms, place));
    const lm = std(T.palm(), { vertexColors: true, side: THREE.DoubleSide });
    group.add(instanced(merge(leaf), lm, P.palms, place));
  }

  // ---- rocks (three geology kinds) ----------------------------------------
  {
    const base = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
    const p = base.attributes.position;
    const map = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!map.has(key)) map.set(key, 0.78 + hr(p.getX(i) * 9, p.getZ(i) * 9, p.getY(i) * 9) * 0.42);
      const k = map.get(key); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.85, p.getZ(i) * k);
    }
    base.computeVertexNormals();
    const mats = [std(T.sandstone(), { flatShading: true }), std(T.basalt(), { flatShading: true }), std(T.mossrock(), { flatShading: true })];
    // kind: 0 sandstone (shore), 1 basalt, 2 mossrock (marsh)
    for (let kind = 0; kind < 3; kind++) {
      const list = P.rocks.filter((r) => r.kind === kind);
      if (!list.length) continue;
      group.add(instanced(base, mats[kind], list, (o, r) => { o.position.set(r.x, r.y + r.s * 0.2, r.z); o.rotation.set(0, r.rot, 0); o.scale.set(r.s, r.s * r.sq, r.s * (1.1 - r.sq * 0.2)); },
        { tint: (c, r) => c.setScalar(0.85 + hr(r.x, r.z, 4) * 0.3) }));
    }
  }

  // ---- grass tufts / reeds (cross-quads with alpha cut) ---------------------
  {
    const cross = (w, h) => merge([
      { geo: new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0), color: [1, 1, 1] },
      { geo: new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0), m: mat4(0, 0, 0, 0, Math.PI / 2, 0), color: [1, 1, 1] },
      { geo: new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0), m: mat4(0, 0, 0, 0, Math.PI / 4, 0), color: [1, 1, 1] },
    ]);
    const place = (o, p) => { o.position.set(p.x, p.y - 0.02, p.z); o.rotation.set(0, p.rot, 0); o.scale.setScalar(p.s); };
    group.add(instanced(cross(1.3, 0.9), new THREE.MeshStandardMaterial({ map: A.tuft(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 }), P.tufts, place, { cast: false }));
    group.add(instanced(cross(1.5, 2.2), new THREE.MeshStandardMaterial({ map: A.reed(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 }), P.reeds, place, { cast: false }));
  }

  // ---- shells + driftwood ---------------------------------------------------
  {
    const shell = new THREE.SphereGeometry(0.22, 8, 6).scale(1, 0.55, 1);
    group.add(instanced(shell, std(T.shell()), P.shells, (o, s) => { o.position.set(s.x, s.y + 0.05, s.z); o.rotation.set(0.2, s.rot, 0); o.scale.setScalar(s.s * (s.kind ? 1.5 : 1)); }, { cast: false }));
    const log = merge([
      { geo: new THREE.CylinderGeometry(0.13, 0.18, 3, 6).rotateZ(Math.PI / 2), color: [1, 1, 1] },
      { geo: new THREE.CylinderGeometry(0.05, 0.09, 1.1, 5).rotateZ(Math.PI / 2).translate(0.2, 0.2, 0.1).rotateY(0.6), color: [0.9, 0.9, 0.9] },
    ]);
    group.add(instanced(log, std(T.hull(), { vertexColors: true }), P.driftwood, (o, s) => { o.position.set(s.x, s.y + 0.15, s.z); o.rotation.set(0, s.rot, 0.05); o.scale.setScalar(s.s); }));
  }

  // ---- lighthouse + beacon --------------------------------------------------
  {
    const L = W.LIGHTHOUSE, y0 = W.heightAt(L.x, L.z);
    const g = new THREE.Group(); g.position.set(L.x, y0, L.z);
    const mk = (geo, mat, y, cast = true) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = cast; m.receiveShadow = true; g.add(m); return m; };
    mk(new THREE.CylinderGeometry(4.3, 4.7, 2.2, 20), std(repeated(T.basalt(), 4, 1)), 0.8);
    mk(new THREE.CylinderGeometry(2.4, 3.5, 24, 24), std(repeated(T.lighthouse(), 2, 1)), 13);
    mk(new THREE.CylinderGeometry(3.5, 3.0, 0.7, 24), std(T.rust()), 25.4);
    const rail = mk(new THREE.TorusGeometry(3.4, 0.07, 6, 28), std(T.rust()), 26.4); rail.rotation.x = Math.PI / 2;
    const glass = mk(new THREE.CylinderGeometry(1.8, 1.8, 2.6, 14), new THREE.MeshStandardMaterial({ color: 0xffd48a, emissive: 0xffb454, emissiveIntensity: 1.8, transparent: true, opacity: 0.9 }), 27.5, false);
    mk(new THREE.ConeGeometry(2.5, 2.2, 14), std(repeated(T.rust(), 2, 1)), 30.0);
    const door = mk(new THREE.BoxGeometry(1.2, 2.2, 0.4), std(T.planks()), 2.0); door.position.z = 3.55;
    for (let i = 0; i < 4; i++) { const w = mk(new THREE.BoxGeometry(0.5, 0.9, 0.3), new THREE.MeshStandardMaterial({ color: 0x1e2a33, emissive: 0x3a2a14, emissiveIntensity: 0.6 }), 7 + i * 4.5, false); const a = i * 1.7; w.position.set(Math.sin(a) * 2.9, w.position.y, Math.cos(a) * 2.9); w.rotation.y = a; }
    const beam = new THREE.Group(); beam.position.y = 27.5;
    const bm = new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (let k = 0; k < 2; k++) { const geo = new THREE.CylinderGeometry(0.6, 8, 90, 10, 1, true).translate(0, -45, 0).rotateZ(Math.PI / 2); if (k) geo.rotateY(Math.PI); beam.add(new THREE.Mesh(geo, bm)); }
    g.add(beam); animated.beam = beam;
    group.add(g);

    // beacon brazier + bank ring
    const B = W.BANK, by = W.heightAt(B.x, B.z);
    const bg = new THREE.Group(); bg.position.set(B.x, by, B.z);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.45, 0.55, 10), std(T.rust())); bowl.position.y = 0.85; bowl.castShadow = true; bg.add(bowl);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.6, 6), std(T.rust())); leg.position.y = 0.3; bg.add(leg);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.28 - i * 0.03, 0.9 + i * 0.1, 6), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffc060 : 0xff8a30, transparent: true, opacity: 0.92 }));
      f.position.set((i - 1.5) * 0.18, 1.45, ((i % 2) - 0.5) * 0.3); bg.add(f); animated.flames.push(f);
    }
    const lt = new THREE.PointLight(0xffa860, 18, 26, 1.6); lt.position.set(0, 2.2, 0); bg.add(lt); animated.light = lt;
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(B.r * 2.3, B.r * 2.3), new THREE.MeshBasicMaterial({ map: A.rune(), transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.1; bg.add(ring); animated.ring = ring;
    group.add(bg);
  }

  // ---- standing stones ------------------------------------------------------
  {
    const geo = new THREE.CylinderGeometry(0.55, 0.85, 1, 5).translate(0, 0.5, 0);
    group.add(instanced(geo, std(T.stone(), { flatShading: true }), W.structures.stones, (o, s) => { o.position.set(s.x, s.y - 0.5, s.z); o.rotation.set(0.04, s.rot * 3, -0.03); o.scale.set(1, s.h + 0.5, 1); }));
  }

  // ---- huts -----------------------------------------------------------------
  for (const h of W.structures.huts) {
    const g = new THREE.Group(); g.position.set(h.x, h.y, h.z);
    const gap = 0.7, doorTheta = Math.PI / 2 - h.rot;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 2.6, 18, 1, true, doorTheta + gap / 2, Math.PI * 2 - gap), std(repeated(T.planks(), 5, 1), { side: THREE.DoubleSide }));
    wall.position.y = 1.2; wall.castShadow = wall.receiveShadow = true; g.add(wall);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.5, 2.4, 14), std(repeated(T.thatch(), 3, 1))); roof.position.y = 3.8; roof.castShadow = true; g.add(roof);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.8, 16), std(T.planks())); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.06; g.add(floor);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc070 })); lamp.position.set(0, 2.4, 0); g.add(lamp);
    group.add(g);
  }

  // ---- shipwrecks -----------------------------------------------------------
  for (const w of W.structures.wrecks) {
    const ribs = w.ribs;
    const plank = new THREE.BoxGeometry(1.7, 1, 0.24).translate(0, 0.5, 0);
    const mesh = instanced(plank, std(T.hull()), ribs, (o, r, i) => {
      const phi = Math.atan2(w.b * Math.cos(r.t), -w.a * Math.sin(r.t)) + w.rot;
      o.position.set(r.x, r.y - 0.4, r.z); o.rotation.set(0, -phi, (hr(i, 3, 9) - 0.5) * 0.18);
      const bow = Math.abs(Math.cos(r.t));
      o.scale.set(1, 1.7 + bow * 1.3 + hr(i, 1, 2) * 0.9, 1);
    });
    group.add(mesh);
    const g = new THREE.Group(); g.position.set(w.x, w.y, w.z); g.rotation.y = -w.rot;
    const deck = new THREE.Mesh(new THREE.CircleGeometry(1, 24), std(T.hull())); deck.scale.set(w.a * 0.95, w.b * 0.95, 1); deck.rotation.x = -Math.PI / 2; deck.position.y = 0.12; deck.receiveShadow = true; g.add(deck);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 7, 7), std(T.bark())); mast.position.set(-0.8, 3.1, 0); mast.rotation.z = 0.3; mast.castShadow = true; g.add(mast);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4.2, 6), std(T.bark())); boom.position.set(0.4, 4.6, 0); boom.rotation.set(0, 0.2, 1.2); boom.castShadow = true; g.add(boom);
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.4, 3, 3), std(T.cloth(), { side: THREE.DoubleSide, roughness: 1 }));
    const sp = sail.geometry.attributes.position; for (let i = 0; i < sp.count; i++) sp.setZ(i, Math.sin(sp.getX(i) * 1.6 + sp.getY(i)) * 0.25);
    sail.geometry.computeVertexNormals(); sail.position.set(0.6, 3.2, 0.1); sail.rotation.set(0, 1.4, -0.25); sail.castShadow = true; g.add(sail);
    group.add(g);
  }

  // ---- piers ----------------------------------------------------------------
  for (const p of W.structures.piers) {
    const len = p.hl * 2, wd = p.hw * 2;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.24, wd), std(repeated(T.planks(), len / 2.5, wd / 2.5)));
    deck.position.set(p.x, p.top - 0.12, p.z); deck.rotation.y = -p.rot; deck.castShadow = deck.receiveShadow = true; group.add(deck);
    const posts = [];
    for (let s = -p.hl + 0.6; s <= p.hl; s += 2.6) for (const side of [-1, 1]) posts.push({ s, side });
    const geo = new THREE.CylinderGeometry(0.17, 0.2, 9, 6).translate(0, -4.5, 0);
    group.add(instanced(geo, std(T.bark()), posts, (o, q) => {
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      o.position.set(p.x + c * q.s - s * q.side * (p.hw - 0.15), p.top - 0.2, p.z + s * q.s + c * q.side * (p.hw - 0.15));
      o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1);
    }));
  }

  // ---- crates and barrels around huts and wrecks ----------------------------
  {
    const spots = [];
    for (const h of W.structures.huts) for (let i = 0; i < 4; i++) { const a = h.rot + Math.PI + (i - 1.5) * 0.5 + hr(h.x, i, 1), r = 3.6 + hr(h.z, i, 2); spots.push({ x: h.x + Math.cos(a) * r, z: h.z + Math.sin(a) * r, k: i % 2, s: 0.8 + hr(i, h.x, 3) * 0.4, rot: hr(i, h.z, 4) * 6 }); }
    for (const w of W.structures.wrecks) for (let i = 0; i < 3; i++) { const a = hr(w.x, i, 5) * 6.28, r = 9 + hr(w.z, i, 6) * 2; const x = w.x + Math.cos(a) * r, z = w.z + Math.sin(a) * r; if (W.heightAt(x, z) > -0.3) spots.push({ x, z, k: i % 2, s: 0.9, rot: a }); }
    for (const s of spots) s.y = W.heightAt(s.x, s.z);
    const crate = new THREE.BoxGeometry(0.9, 0.9, 0.9).translate(0, 0.45, 0), barrel = new THREE.CylinderGeometry(0.4, 0.45, 1, 10).translate(0, 0.5, 0);
    const crates = spots.filter((s) => !s.k), barrels = spots.filter((s) => s.k);
    group.add(instanced(crate, std(T.planks()), crates, (o, s) => { o.position.set(s.x, s.y - 0.05, s.z); o.rotation.set(0, s.rot, 0); o.scale.setScalar(s.s); }));
    group.add(instanced(barrel, std(T.leather()), barrels, (o, s) => { o.position.set(s.x, s.y - 0.05, s.z); o.rotation.set(0, s.rot, 0); o.scale.setScalar(s.s); }));
  }

  scene.add(group);
  group.userData.animated = animated;
  return group;
}

export function updateProps(group, t) {
  const a = group.userData.animated;
  if (a.beam) a.beam.rotation.y = t * 0.45;
  a.flames.forEach((f, i) => { const k = 0.8 + Math.sin(t * 9 + i * 1.7) * 0.18 + Math.sin(t * 17 + i) * 0.08; f.scale.set(k, 0.8 + k * 0.5, k); });
  if (a.light) a.light.intensity = 16 + Math.sin(t * 11) * 2 + Math.sin(t * 23) * 1.2;
  if (a.ring) a.ring.rotation.z = t * 0.12;
}
