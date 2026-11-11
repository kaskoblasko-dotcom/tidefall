// Remote players: snapshot interpolation (100ms buffer), animation state, name tags.
import * as THREE from 'three';
import { Character } from './character.js';
import { A } from './textures.js';
import { SKINS } from '../shared/constants.js';

const DELAY = 0.11;
const angLerp = (a, b, t) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * t; };

export class Remotes {
  constructor(scene) { this.scene = scene; this.map = new Map(); }

  add(info) {
    if (this.map.has(info.id)) this.remove(info.id);
    const char = new Character(info.skin, info.w || 0);
    char.root.position.set(info.x || 0, info.y || 0, info.z || 0);
    this.scene.add(char.root);
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    tag.scale.set(2.6, 0.65, 1); tag.renderOrder = 5; this.scene.add(tag);
    const p = { id: info.id, name: info.name, skin: info.skin, char, canvas, tex, tag, buf: [], hp: info.hp ?? 100, alive: info.alive !== false, carry: 0, w: info.w || 0, ghost: false,
      x: info.x || 0, y: info.y || 0, z: info.z || 0, yaw: info.yaw || 0, speed: 0, anim: 0, lastDrawn: -1 };
    this.map.set(info.id, p); this.drawTag(p);
    return p;
  }
  remove(id) {
    const p = this.map.get(id); if (!p) return;
    this.scene.remove(p.char.root); this.scene.remove(p.tag); p.char.dispose(); p.tag.material.dispose(); p.tex.dispose();
    this.map.delete(id);
  }
  clear() { for (const id of [...this.map.keys()]) this.remove(id); }

  drawTag(p) {
    const ctx = p.canvas.getContext('2d'), w = 256, h = 64;
    ctx.clearRect(0, 0, w, h);
    ctx.font = '600 26px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(10,16,20,0.85)'; ctx.fillStyle = p.ghost ? '#9aa4a8' : '#f2ead6';
    const label = p.ghost ? p.name + ' (lost link)' : p.name;
    ctx.strokeText(label, w / 2, 30); ctx.fillText(label, w / 2, 30);
    ctx.fillStyle = 'rgba(10,16,20,0.8)'; ctx.fillRect(48, 40, 160, 10);
    const f = Math.max(0, Math.min(1, p.hp / 100));
    ctx.fillStyle = f > 0.5 ? '#78b66a' : f > 0.25 ? '#d6a43a' : '#c2452f'; ctx.fillRect(49, 41, 158 * f, 8);
    p.tex.needsUpdate = true; p.lastDrawn = p.hp;
  }

  push(row, now) {
    const p = this.map.get(row[0]); if (!p) return;
    const [, x, y, z, yaw, pitch, anim, hp, w, carry, flags] = row;
    p.buf.push({ t: now, x, y, z, yaw, pitch, anim });
    if (p.buf.length > 24) p.buf.shift();
    p.anim = anim; p.carry = carry; p.alive = !!(flags & 1); p.protect = !!(flags & 2);
    const ghost = !!(flags & 4);
    if (hp !== p.hp || ghost !== p.ghost) { p.hp = hp; p.ghost = ghost; this.drawTag(p); }
    if (w !== p.w) { p.w = w; p.char.setWeapon(w); }
  }

  update(dt, now, level) {
    const rt = now - DELAY;
    for (const p of this.map.values()) {
      const b = p.buf; let nx = p.x, ny = p.y, nz = p.z, nyaw = p.yaw;
      if (b.length) {
        let i = b.length - 1; while (i > 0 && b[i - 1].t > rt) i--;
        const a = b[Math.max(0, i - 1)], c = b[i];
        if (rt >= c.t || a === c) { nx = c.x; ny = c.y; nz = c.z; nyaw = c.yaw; }
        else { const k = (rt - a.t) / (c.t - a.t); nx = a.x + (c.x - a.x) * k; ny = a.y + (c.y - a.y) * k; nz = a.z + (c.z - a.z) * k; nyaw = angLerp(a.yaw, c.yaw, k); }
      }
      const moved = Math.hypot(nx - p.x, nz - p.z), jump = moved > 6 * Math.max(dt, 0.001) * 12; // teleport (respawn) guard
      if (moved > 8) p.speed = 0; else p.speed += ((moved / Math.max(dt, 0.001)) - p.speed) * Math.min(1, dt * 10);
      p.x = nx; p.y = ny; p.z = nz; p.yaw = nyaw;
      const c = p.char;
      c.root.position.set(nx, ny, nz); c.root.rotation.y = nyaw;
      c.setDead(!p.alive);
      c.setCarry(p.carry, p.kinds);
      c.update(dt, { speed: p.speed, air: p.anim === 3, swim: p.anim === 4, dash: p.anim === 5 });
      c.root.visible = true;
      p.tag.position.set(nx, ny + 2.45, nz);
      p.tag.visible = p.alive;
      const swimmingDepth = level - ny;
      c.root.children[0].visible = true;
    }
  }
}
