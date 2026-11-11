// Combat/world effects: tracers, muzzle flashes, particles, water ripples, floating damage text.
import * as THREE from 'three';
import { A } from './textures.js';

export class Fx {
  constructor(scene, textLayer) {
    this.scene = scene; this.layer = textLayer;
    this.tracers = []; this.parts = []; this.ripples = []; this.texts = []; this.flashes = [];
    const tm = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: false });
    const bg = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(bg, tm()); m.visible = false; m.frustumCulled = false; scene.add(m); this.tracers.push({ m, life: 0, max: 1 }); }
    const sm = (blend) => new THREE.SpriteMaterial({ map: A.glow(), transparent: true, depthWrite: false, blending: blend, fog: true });
    for (let i = 0; i < 160; i++) { const s = new THREE.Sprite(sm(THREE.NormalBlending)); s.visible = false; scene.add(s); this.parts.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, g: 0, size: 1 }); }
    for (let i = 0; i < 10; i++) { const s = new THREE.Sprite(sm(THREE.AdditiveBlending)); s.visible = false; scene.add(s); this.flashes.push({ s, life: 0 }); }
    const rg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < 20; i++) { const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ map: A.ring(), transparent: true, depthWrite: false, opacity: 0.6 })); m.visible = false; scene.add(m); this.ripples.push({ m, life: 0, max: 1, size: 1 }); }
    this.pi = 0; this.ti = 0; this.ri = 0; this.fi = 0;
  }
  tracer(a, b, color = 0xfff0c0, life = 0.12, width = 0.05) {
    const t = this.tracers[this.ti++ % this.tracers.length], m = t.m;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz) || 0.01;
    m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    m.lookAt(b.x, b.y, b.z); m.scale.set(width, width, len);
    m.material.color.setHex(color); m.material.opacity = 0.9; m.visible = true; t.life = t.max = life; t.w = width;
  }
  flash(pos, color = 0xffd890, size = 1.4) {
    const f = this.flashes[this.fi++ % this.flashes.length];
    f.s.position.copy(pos); f.s.material.color.setHex(color); f.s.scale.setScalar(size); f.s.visible = true; f.life = 0.07; f.size = size;
  }
  burst(pos, color, n = 8, speed = 4, life = 0.5, g = 9, size = 0.25) {
    for (let i = 0; i < n; i++) {
      const p = this.parts[this.pi++ % this.parts.length];
      p.s.position.copy(pos); p.s.material.color.setHex(color); p.s.material.opacity = 1; p.s.visible = true;
      const a = Math.random() * 6.283, u = Math.random() * 2 - 0.3, sp = speed * (0.4 + Math.random() * 0.8);
      p.vx = Math.cos(a) * sp * (1 - Math.abs(u) * 0.3); p.vz = Math.sin(a) * sp * (1 - Math.abs(u) * 0.3); p.vy = Math.abs(u) * sp + speed * 0.3;
      p.g = g; p.life = p.max = life * (0.6 + Math.random() * 0.7); p.size = size * (0.6 + Math.random() * 0.8); p.s.scale.setScalar(p.size);
    }
  }
  splash(x, y, z, n = 10) { this.burst(new THREE.Vector3(x, y, z), 0xcfeeee, n, 3.2, 0.6, 9, 0.22); this.ripple(x, y, z, 2.2); }
  ripple(x, y, z, size = 1.5) {
    const r = this.ripples[this.ri++ % this.ripples.length];
    r.m.position.set(x, y + 0.04, z); r.m.visible = true; r.life = r.max = 0.9; r.size = size; r.m.scale.setScalar(0.3);
  }
  text(worldPos, str, cls = '') {
    const el = document.createElement('div'); el.className = 'ftext ' + cls; el.textContent = str; this.layer.appendChild(el);
    this.texts.push({ el, pos: worldPos.clone(), life: 0.9, max: 0.9 });
    if (this.texts.length > 24) this.texts.shift().el.remove();
  }
  update(dt, camera, w, h) {
    for (const t of this.tracers) if (t.life > 0) { t.life -= dt; const k = Math.max(0, t.life / t.max); t.m.material.opacity = k * 0.9; t.m.scale.x = t.m.scale.y = t.w * (0.4 + k * 0.6); if (t.life <= 0) t.m.visible = false; }
    for (const f of this.flashes) if (f.life > 0) { f.life -= dt; if (f.life <= 0) f.s.visible = false; }
    for (const p of this.parts) if (p.life > 0) {
      p.life -= dt; p.vy -= p.g * dt; p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      const k = Math.max(0, p.life / p.max); p.s.material.opacity = k; p.s.scale.setScalar(p.size * (0.5 + k * 0.5));
      if (p.life <= 0) p.s.visible = false;
    }
    for (const r of this.ripples) if (r.life > 0) { r.life -= dt; const k = 1 - r.life / r.max; r.m.scale.setScalar(r.size * (0.3 + k)); r.m.material.opacity = (1 - k) * 0.6; if (r.life <= 0) r.m.visible = false; }
    const v = new THREE.Vector3();
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]; t.life -= dt;
      if (t.life <= 0) { t.el.remove(); this.texts.splice(i, 1); continue; }
      t.pos.y += dt * 1.1; v.copy(t.pos).project(camera);
      if (v.z > 1) { t.el.style.display = 'none'; continue; }
      t.el.style.display = ''; t.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%,-50%)`; t.el.style.opacity = Math.min(1, t.life / 0.4);
    }
  }
  clear() {
    for (const t of this.tracers) t.m.visible = false; for (const p of this.parts) p.s.visible = false; for (const r of this.ripples) r.m.visible = false;
    for (const t of this.texts) t.el.remove(); this.texts.length = 0;
  }
}
