// Relic visuals: floating treasures with beacon columns when exposed by the tide.
import * as THREE from 'three';
import { T, A } from './textures.js';

const KIND = {
  pearl: { color: 0xf0f4f8, glow: 0xbcd4ee },
  idol: { color: 0xe8b838, glow: 0xffc850 },
  deep: { color: 0x4a8ee0, glow: 0x5aa0ff },
  crown: { color: 0xffd24a, glow: 0xffe080 },
};

function model(kind) {
  const g = new THREE.Group();
  const k = KIND[kind];
  if (kind === 'idol') {
    const m = new THREE.MeshStandardMaterial({ map: T.gold(), metalness: 0.7, roughness: 0.35, emissive: 0x6a4a08, emissiveIntensity: 0.6 });
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 6), m); b.position.y = -0.05; g.add(b);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), m); h.position.y = 0.32; g.add(h);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), m); e.position.set(s * 0.11, 0.5, 0); g.add(e); }
  } else if (kind === 'crown') {
    const m = new THREE.MeshStandardMaterial({ map: T.gold(), metalness: 0.8, roughness: 0.3, emissive: 0x8a6008, emissiveIntensity: 0.8 });
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 8, 16), m); r.rotation.x = Math.PI / 2; g.add(r);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const c = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 5), m); c.position.set(Math.cos(a) * 0.28, 0.18, Math.sin(a) * 0.28); g.add(c); }
    g.scale.setScalar(1.3);
  } else {
    const m = new THREE.MeshStandardMaterial({ map: kind === 'deep' ? null : T.pearl(), color: kind === 'deep' ? 0x4a8ee0 : 0xffffff, metalness: 0.2, roughness: 0.18, emissive: k.glow, emissiveIntensity: kind === 'deep' ? 0.9 : 0.35 });
    g.add(new THREE.Mesh(new THREE.SphereGeometry(kind === 'deep' ? 0.3 : 0.22, 16, 12), m));
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: A.glow(), color: k.glow, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.6, fog: false }));
  glow.scale.setScalar(1.6); g.add(glow);
  return g;
}

export class Relics {
  constructor(scene) { this.scene = scene; this.map = new Map(); }
  clear() { for (const r of this.map.values()) this.scene.remove(r.group); this.map.clear(); }
  set(rows) {
    for (const [id, st, x, y, z, carrier, value, kind] of rows) {
      let r = this.map.get(id);
      if (!r) {
        const group = new THREE.Group(); group.add(model(kind));
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 18, 8, 1, true), new THREE.MeshBasicMaterial({ color: KIND[kind].glow, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
        col.position.y = 9; group.add(col);
        this.scene.add(group); r = { group, col, id, kind, value }; this.map.set(id, r);
      }
      Object.assign(r, { st, x, y, z, carrier, value });
    }
  }
  kindsFor(pid) { const k = []; for (const r of this.map.values()) if (r.st === 1 && r.carrier === pid) k.push(r.kind); return k; }
  update(t, level) {
    for (const r of this.map.values()) {
      const show = r.st === 0;
      r.group.visible = show;
      if (!show) continue;
      const exposed = level < r.y + 0.1;
      r.group.position.set(r.x, r.y + 0.55 + Math.sin(t * 2 + r.id) * 0.08, r.z);
      r.group.rotation.y = t * 0.9 + r.id;
      r.col.visible = exposed; r.col.rotation.y = -r.group.rotation.y;
      r.group.children[0].scale.setScalar(exposed ? 1 : 0.8);
    }
  }
  list() { return [...this.map.values()]; }
}
