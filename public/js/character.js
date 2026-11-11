// Character models: six skins with different silhouettes and gear, procedural
// animation (walk, swim, dash, melee swing, firearm recoil, death) and the
// three held weapons. Built entirely from shared primitive geometry + textures.
import * as THREE from 'three';
import { T } from './textures.js';

const gcache = new Map();
const G = (key, make) => { let g = gcache.get(key); if (!g) { g = make(); gcache.set(key, g); } return g; };
const box = (w, h, d) => G(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (a, b, h, s = 8) => G(`c${a},${b},${h},${s}`, () => new THREE.CylinderGeometry(a, b, h, s));
const sph = (r, a = 12, b = 9) => G(`s${r},${a},${b}`, () => new THREE.SphereGeometry(r, a, b));
const cone = (r, h, s = 8) => G(`k${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s));
const tor = (r, t) => G(`t${r},${t}`, () => new THREE.TorusGeometry(r, t, 6, 16));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 1 - (1 - t) * (1 - t);

export const WEAPON_MUZZLE = [0, 0.95, 0.75];

export class Character {
  constructor(skinId, weaponId = 0) {
    this.skin = skinId;
    this.root = new THREE.Group();
    this.mats = []; this.flashMats = [];
    this.rig = new THREE.Group(); this.rig.position.y = 0.9; this.root.add(this.rig);
    this.body = new THREE.Group(); this.rig.add(this.body);
    this.t = Math.random() * 10; this.phase = 0; this.atk = null; this.flashT = 0; this.deadT = 0; this.dead = false; this.swing = 0;
    this.weaponId = -1; this.weapon = null;
    this.carry = new THREE.Group(); this.carry.position.set(0, 0.35, 0.3); this.body.add(this.carry);
    this.carryMats = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x888888, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.2 });
      this.mats.push(m); this.carryMats.push(m);
      const o = new THREE.Mesh(sph(0.1, 10, 8), m); o.position.set((i - 1) * 0.2, 0, 0); o.visible = false; o.castShadow = true; this.carry.add(o);
    }
    this.build(skinId);
    this.setWeapon(weaponId < 0 ? 0 : weaponId);
    this.root.traverse((o) => { if (o.isMesh && o.parent !== this.carry) { o.castShadow = true; } });
  }

  m(tex, opts = {}, flash = true) {
    const mat = new THREE.MeshStandardMaterial({ map: tex || null, roughness: 0.85, metalness: 0, ...opts });
    this.mats.push(mat); if (flash && !opts.emissive) this.flashMats.push(mat);
    return mat;
  }
  add(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); parent.add(mesh); return mesh;
  }

  // ---- skin builders -------------------------------------------------------
  build(id) {
    const o = [
      { skin: T.skin(), shirt: T.jersey(), pants: T.cloth(), pantsC: 0xbba98a, boots: 0x3b2a1e, torso: [1, 1, 1], leg: [1, 1], arm: 1, scale: 1 },
      { skin: T.skin(), shirt: T.leather(), pants: T.leather(), pantsC: 0xffffff, boots: 0x2b2e33, torso: [1.28, 1.02, 1.3], leg: [1.2, 1], arm: 1.2, scale: 1 },
      { skin: T.skin(), shirt: T.slicker(), pants: T.slicker(), pantsC: 0xd8c250, boots: 0x15171a, torso: [1.05, 1.04, 1.1], leg: [1, 1.06], arm: 1, scale: 1.04 },
      { skin: T.crab(), shirt: T.crab(), pants: T.crab(), pantsC: 0xffffff, boots: 0x7a2c1c, torso: [0.9, 0.85, 0.95], leg: [0.85, 0.8], arm: 0.85, scale: 0.94 },
      { skin: T.feather(), shirt: T.coat(), pants: T.cloth(), pantsC: 0x8a93a0, boots: 0xd89a2a, torso: [0.84, 1, 0.8], leg: [0.62, 1.04], arm: 0.8, scale: 1.02 },
      { skin: T.skin(), shirt: T.coat(), pants: T.cloth(), pantsC: 0x3a3a44, boots: 0x16141a, torso: [1.05, 1.08, 1.05], leg: [1, 1.08], arm: 1, scale: 1.05 },
    ][id];
    const rig = this.rig, body = this.body;
    const skinMat = this.m(o.skin, id === 4 ? { color: 0xffffff } : {});
    const shirtMat = this.m(o.shirt), pantsMat = this.m(o.pants, { color: o.pantsC });
    const bootMat = this.m(null, { color: o.boots, roughness: 0.7 });

    // legs
    this.legL = new THREE.Group(); this.legR = new THREE.Group();
    for (const [leg, x] of [[this.legL, -0.13], [this.legR, 0.13]]) {
      leg.position.set(x, 0, 0); rig.add(leg);
      this.add(leg, box(0.2 * o.leg[0], 0.62 * o.leg[1], 0.22 * o.leg[0]), pantsMat, 0, -0.33 * o.leg[1], 0);
      this.add(leg, box(0.22 * o.leg[0], 0.2, 0.3), bootMat, 0, -0.78, -0.03);
    }
    // torso
    this.add(body, box(0.5 * o.torso[0], 0.58 * o.torso[1], 0.3 * o.torso[2]), shirtMat, 0, 0.3, 0);
    // arms (pivot at shoulder)
    this.armL = new THREE.Group(); this.armR = new THREE.Group();
    this.armL.position.set(-0.3 * o.torso[0] - 0.08, 0.52, 0); this.armR.position.set(0.3 * o.torso[0] + 0.08, 0.52, 0);
    body.add(this.armL, this.armR);
    for (const arm of [this.armL, this.armR]) {
      this.add(arm, box(0.15 * o.arm, 0.56, 0.15 * o.arm), shirtMat, 0, -0.28, 0);
      this.add(arm, sph(0.075 * o.arm + 0.01), skinMat, 0, -0.6, 0);
    }
    this.hand = new THREE.Group(); this.hand.position.set(0, -0.6, 0); this.armR.add(this.hand);
    // head
    this.head = new THREE.Group(); this.head.position.set(0, 0.76, 0); body.add(this.head);
    if (id !== 1) this.add(this.head, sph(0.2), skinMat, 0, 0, 0);
    const eye = this.m(null, { color: 0x15130f }, false);
    if (id !== 1) for (const x of [-0.075, 0.075]) this.add(this.head, sph(id === 4 ? 0.034 : 0.027, 6, 5), id === 4 ? this.m(null, { color: 0xf2c030 }, false) : eye, x, 0.03, -0.185);
    this.root.scale.setScalar(o.scale);

    const brass = this.m(T.brass(), { metalness: 0.65, roughness: 0.4 }, false);
    const rust = this.m(T.rust());
    if (id === 0) { // Deckhand: flat cap + neckerchief
      this.add(this.head, cyl(0.21, 0.22, 0.09, 12), this.m(null, { color: 0x233a5e }), 0, 0.15, 0);
      this.add(this.head, box(0.3, 0.025, 0.14), this.m(null, { color: 0x233a5e }), 0, 0.12, -0.2, 0.1);
      this.add(body, box(0.32, 0.08, 0.34), this.m(null, { color: 0xb03a2a }), 0, 0.58, 0);
      this.add(this.armL, box(0.17, 0.1, 0.17), this.m(null, { color: 0xb03a2a }), 0, -0.42, 0);
    } else if (id === 1) { // Brass Diver: helmet, tank, hose
      this.add(this.head, sph(0.285, 16, 12), brass, 0, 0.02, 0);
      this.add(this.head, sph(0.17, 12, 10), this.m(null, { color: 0x9fd6d0, emissive: 0x2a6a6a, emissiveIntensity: 0.7, roughness: 0.1, transparent: true, opacity: 0.85 }, false), 0, 0.02, -0.2).scale.set(1, 1, 0.55);
      this.add(this.head, tor(0.27, 0.025), brass, 0, -0.18, 0, Math.PI / 2);
      this.add(body, cyl(0.15, 0.15, 0.6, 12), this.m(T.steel(), { metalness: 0.6, roughness: 0.4 }, false), 0, 0.28, 0.27);
      this.add(body, cyl(0.045, 0.045, 0.18, 8), brass, 0, 0.64, 0.27);
      this.add(body, tor(0.22, 0.03), this.m(null, { color: 0x222222 }), 0, 0.62, 0.1, 0.4, 0.6, 0);
      this.add(body, box(0.34, 0.26, 0.04), brass, 0, 0.35, -0.17);
      for (const x of [-0.13, 0.13]) this.add(this.rig, box(0.26, 0.22, 0.34), this.m(T.steel(), { metalness: 0.5 }), x, -0.79, -0.03);
    } else if (id === 2) { // Lamp Keeper: oilskin slicker, hood, beard, lantern
      this.add(rig, cyl(0.27, 0.43, 0.7, 12), shirtMat, 0, -0.22, 0).userData.skirt = true;
      this.add(this.head, sph(0.27, 12, 9), shirtMat, 0, 0.04, 0.03).scale.set(1, 0.95, 1.05);
      this.add(this.head, cone(0.28, 0.32, 10), shirtMat, 0, 0.27, 0.06, -0.3);
      this.add(this.head, cone(0.13, 0.36, 8), this.m(null, { color: 0xc9c6bc }), 0, -0.23, -0.15, Math.PI - 0.25);
      this.add(this.armL, cyl(0.012, 0.012, 0.2, 4), this.m(null, { color: 0x222222 }), 0, -0.7, 0);
      this.lantern = this.add(this.armL, sph(0.13, 10, 8), this.m(null, { color: 0xffd080, emissive: 0xffa030, emissiveIntensity: 2.2 }, false), 0, -0.9, 0);
      this.add(this.armL, cyl(0.15, 0.15, 0.03, 10), this.m(null, { color: 0x222222 }), 0, -1.04, 0);
      this.add(this.armL, cyl(0.15, 0.15, 0.03, 10), this.m(null, { color: 0x222222 }), 0, -0.76, 0);
    } else if (id === 3) { // Shellback: spiral shell, eye stalks, claw
      const shell = this.add(body, sph(0.4, 14, 10), this.m(T.shell()), 0, 0.34, 0.3); shell.scale.set(1, 0.95, 1.1);
      this.add(body, cone(0.28, 0.5, 10), this.m(T.shell()), 0, 0.62, 0.44, 0.9);
      this.add(body, tor(0.3, 0.06), this.m(T.shell()), 0, 0.3, 0.28, 0, 1.2, 0);
      for (const x of [-0.07, 0.07]) {
        this.add(this.head, cyl(0.014, 0.014, 0.2, 5), skinMat, x, 0.27, -0.04);
        this.add(this.head, sph(0.04, 8, 6), eye, x, 0.38, -0.05);
      }
      const claw = new THREE.Group(); claw.position.set(0, -0.62, 0); this.armL.add(claw);
      this.add(claw, sph(0.17, 10, 8), this.m(T.crab()), 0, -0.05, 0).scale.set(1, 1, 1.3);
      this.add(claw, cone(0.08, 0.34, 6), this.m(T.crab()), -0.07, -0.26, -0.05, 0.1, 0, 0.18);
      this.add(claw, cone(0.07, 0.3, 6), this.m(T.crab()), 0.07, -0.25, 0.0, 0, 0, -0.22);
      this.armL.scale.set(1.5, 1, 1.5);
    } else if (id === 4) { // Gull Wanderer: beaked mask, feather cloak, wings
      this.add(this.head, cone(0.065, 0.3, 6), this.m(null, { color: 0xe08a22 }), 0, -0.01, -0.3, -Math.PI / 2);
      this.add(this.head, sph(0.06, 6, 5), this.m(T.feather()), 0, 0.2, 0.0);
      this.add(body, box(0.62, 0.62, 0.07), this.m(T.feather(), { side: THREE.DoubleSide }), 0, 0.28, 0.2, 0.12);
      for (const s of [-1, 1]) {
        const w = this.add(body, box(0.05, 0.9, 0.5), this.m(T.feather(), { side: THREE.DoubleSide }), s * 0.42, 0.45, 0.26, 0.25, s * 0.5, s * 0.55);
        w.userData.wing = s;
      }
      this.add(body, box(0.2, 0.7, 0.04), this.m(T.feather()), 0, -0.2, 0.28, 0.3);
      for (const x of [-0.13, 0.13]) this.add(this.rig, box(0.24, 0.025, 0.28), this.m(null, { color: 0xe08a22 }), x, -0.88, -0.1);
    } else if (id === 5) { // Captain Marrow: tricorn, coat skirt, buttons, eyepatch, beard
      const gold = this.m(T.gold(), { metalness: 0.7, roughness: 0.35 }, false);
      this.add(rig, cyl(0.27, 0.45, 0.78, 12), shirtMat, 0, -0.28, 0.02);
      this.add(rig, box(0.5, 0.5, 0.05), this.m(null, { color: 0x7a1c1c }), 0, -0.3, 0.3, 0.1);
      const tri = this.add(this.head, cyl(0.37, 0.37, 0.07, 3), this.m(null, { color: 0x1c1c26 }), 0, 0.17, 0); tri.rotation.y = Math.PI / 2;
      this.add(this.head, cyl(0.18, 0.2, 0.14, 12), this.m(null, { color: 0x1c1c26 }), 0, 0.24, 0);
      this.add(this.head, cone(0.04, 0.3, 5), this.m(null, { color: 0xc23a2a }), 0.18, 0.34, 0.04, 0, 0, -0.7);
      for (let i = 0; i < 3; i++) this.add(body, sph(0.03, 6, 5), gold, 0, 0.1 + i * 0.16, -0.16);
      for (const x of [-0.27, 0.27]) this.add(body, box(0.18, 0.045, 0.2), gold, x, 0.57, 0);
      this.add(this.head, box(0.07, 0.07, 0.02), this.m(null, { color: 0x0a0a0a }, false), -0.07, 0.04, -0.2);
      this.add(this.head, box(0.4, 0.015, 0.02), this.m(null, { color: 0x0a0a0a }, false), 0, 0.09, -0.18, 0, 0, 0.14);
      this.add(this.head, box(0.22, 0.12, 0.08), this.m(null, { color: 0x24180f }), 0, -0.15, -0.14);
      for (const x of [-0.13, 0.13]) this.add(this.rig, cyl(0.12, 0.14, 0.36, 8), bootMat, x, -0.56, 0);
    }
  }

  // ---- weapons ----------------------------------------------------------------
  setWeapon(w) {
    if (this.weapon) { this.hand.remove(this.weapon); this.weapon.traverse((o) => { if (o.material && o.userData.own) o.material.dispose(); }); }
    this.weaponId = w;
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ map: T.steel(), metalness: 0.7, roughness: 0.35 });
    const brass = new THREE.MeshStandardMaterial({ map: T.brass(), metalness: 0.6, roughness: 0.4 });
    const wood = new THREE.MeshStandardMaterial({ map: T.planks(), roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.6, roughness: 0.5 });
    for (const m of [steel, brass, wood, dark]) m.userData.own = true;
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.userData.own = true; g.add(m); return m; };
    if (w === 0) { // cutlass
      add(cyl(0.022, 0.026, 0.16, 6).clone().rotateX(Math.PI / 2), wood, 0, 0, 0.0);
      add(sph(0.032, 8, 6), brass, 0, 0, 0.1);
      add(box(0.16, 0.025, 0.05), brass, 0, 0, -0.09);
      add(box(0.05, 0.012, 0.36), steel, 0, 0, -0.29);
      add(box(0.05, 0.012, 0.3), steel, 0.012, 0, -0.62, 0, 0.05, 0);
      add(box(0.045, 0.012, 0.18), steel, 0.04, 0, -0.84, 0, 0.2, 0);
      this.muzzle = new THREE.Vector3(0.04, 0, -0.9);
    } else if (w === 1) { // harpoon gun
      add(cyl(0.045, 0.05, 0.85, 10).clone().rotateX(Math.PI / 2), dark, 0, 0.04, -0.4);
      for (const z of [-0.15, -0.5, -0.78]) add(tor(0.052, 0.012).clone(), brass, 0, 0.04, z);
      add(cone(0.04, 0.24, 8).clone().rotateX(-Math.PI / 2), steel, 0, 0.04, -0.95);
      add(box(0.07, 0.14, 0.34), wood, 0, -0.03, 0.2, 0.1);
      add(cyl(0.07, 0.07, 0.06, 10).clone().rotateZ(Math.PI / 2), brass, 0.07, 0.04, -0.05);
      add(box(0.03, 0.08, 0.03), dark, 0, -0.1, 0.0);
      this.muzzle = new THREE.Vector3(0, 0.04, -1.05);
    } else { // blunderbuss
      add(cyl(0.04, 0.04, 0.34, 8).clone().rotateX(Math.PI / 2), dark, 0, 0.04, -0.15);
      add(cyl(0.035, 0.12, 0.34, 10).clone().rotateX(Math.PI / 2), brass, 0, 0.04, -0.5);
      add(tor(0.1, 0.014).clone(), brass, 0, 0.04, -0.66);
      add(box(0.07, 0.15, 0.42), wood, 0, -0.03, 0.22, 0.14);
      add(box(0.03, 0.08, 0.03), dark, 0, -0.1, 0.02);
      this.muzzle = new THREE.Vector3(0, 0.04, -0.7);
    }
    g.rotation.x = -Math.PI / 2;
    this.hand.add(g); this.weapon = g;
  }
  muzzleWorld(out) { this.root.updateWorldMatrix(true, true); return out.copy(this.muzzle).applyMatrix4(this.weapon.matrixWorld); }

  // ---- state hooks -----------------------------------------------------------
  attack(w) { this.atk = { w, t: 0 }; }
  flash() { this.flashT = 0.18; }
  setDead(d) { if (d !== this.dead) { this.dead = d; if (!d) this.deadT = 0; } }
  setCarry(n, kinds = []) {
    const cols = { pearl: [0xf4f6f8, 0x8aa0b8], idol: [0xe8b838, 0x9a6a10], deep: [0x4a8ee0, 0x1a4a9a], crown: [0xffd24a, 0xc08a10] };
    this.carryMats.forEach((m, i) => {
      this.carry.children[i].visible = i < n;
      const c = cols[kinds[i]] || cols.pearl; m.color.setHex(c[0]); m.emissive.setHex(c[1]);
    });
  }
  setOpacity(o) { for (const m of this.mats) { m.transparent = o < 1; m.opacity = o; } }

  // st: { speed, air, swim, dash, aiming }
  update(dt, st) {
    this.t += dt;
    const sp = Math.min(st.speed || 0, 12);
    const moving = sp > 0.4;
    if (moving && !st.air) this.phase += dt * (3.2 + sp * 0.75);
    const amp = moving ? Math.min(0.95, 0.25 + sp * 0.09) : 0;
    const ph = this.phase;
    let legL = Math.sin(ph) * amp, legR = -Math.sin(ph) * amp;
    let armL = -Math.sin(ph) * amp * 0.7, armR = 0.55 + Math.sin(ph) * amp * 0.15;
    const ranged = this.weaponId > 0;
    if (ranged) armR = 1.15 + Math.sin(ph) * amp * 0.05;
    let rigX = moving ? -0.1 - sp * 0.012 : 0, bodyY = 0, lift = 0;
    if (!moving) { lift = Math.sin(this.t * 2.2) * 0.012; armL += Math.sin(this.t * 1.7) * 0.05; }
    if (st.air) { legL = -0.5; legR = 0.35; armL = -0.5; }
    if (st.swim) { rigX = -1.15; legL = Math.sin(this.t * 9) * 0.5; legR = -Math.sin(this.t * 9) * 0.5; armL = Math.sin(this.t * 4.5) * 1.2 + 2.0; if (!ranged) armR = 2.4 - Math.sin(this.t * 4.5) * 1.0; }
    if (st.dash) { rigX = -0.55; legL = 0.9; legR = -0.7; armL = 0.4; }
    // attack animation
    let kick = 0;
    if (this.atk) {
      const w = this.atk.w, dur = w === 0 ? 0.36 : 0.28;
      this.atk.t += dt;
      const u = Math.min(1, this.atk.t / dur);
      if (w === 0) { const e = ease(u); armR = lerp(2.7, 0.15, e); bodyY = lerp(0.65, -0.5, e); }
      else { armR = 1.5 + (1 - u) * (1 - u) * 0.5; kick = (1 - u) * (1 - u) * 0.12; bodyY = 0.0; }
      if (u >= 1) this.atk = null;
    }
    const dead = this.dead;
    this.deadT = dead ? Math.min(1, this.deadT + dt * 2.2) : Math.max(0, this.deadT - dt * 4);
    const de = ease(this.deadT);
    this.rig.rotation.x = lerp(rigX, 1.5, de);
    this.rig.position.y = 0.9 + lift - de * 0.62;
    this.body.rotation.y = bodyY;
    this.legL.rotation.x = legL; this.legR.rotation.x = legR;
    this.armL.rotation.x = lerp(armL, 2.6, de); this.armR.rotation.x = lerp(armR, 2.2, de);
    this.armL.rotation.z = -0.08 - de * 0.4; this.armR.rotation.z = 0.08 + de * 0.4;
    this.head.rotation.x = st.swim ? 1.1 : 0;
    this.weapon.position.z = kick;
    if (this.lantern) { this.armL.rotation.x = lerp(0.25 + Math.sin(this.t * 1.5) * 0.04 + armL * 0.5, 2.6, de); }
    this.rig.traverse((o) => { if (o.userData.wing) o.rotation.z = o.userData.wing * (0.55 + Math.sin(this.t * 2 + (moving ? ph : 0)) * (moving ? 0.35 : 0.06)); });
    this.carry.position.y = 0.35 + Math.sin(this.t * 3) * 0.02;
    if (this.flashT > 0) {
      this.flashT -= dt; const f = Math.max(0, this.flashT / 0.18);
      for (const m of this.flashMats) m.emissive.setRGB(f * 0.8, f * 0.05, f * 0.05);
    }
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    if (this.weapon) this.weapon.traverse((o) => { if (o.material && o.userData.own) o.material.dispose(); });
    this.mats.length = 0;
  }
}
