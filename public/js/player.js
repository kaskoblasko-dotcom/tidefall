// Local player: input, movement physics (terrain slopes, colliders, water), dash,
// and the third-person camera with collision. Server validates the resulting positions.
import * as W from '../shared/world.js';
import { PLAYER as P, clamp } from '../shared/constants.js';
import { settings } from './settings.js';

export const input = { keys: new Set(), dx: 0, dy: 0, fire: false, locked: false, wheel: 0, pressed: new Set() };

export function initInput(canvas, handlers) {
  addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (!e.repeat) input.pressed.add(e.code);
    input.keys.add(e.code);
    if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code) && input.locked) e.preventDefault();
    if (e.code === 'Tab') { e.preventDefault(); handlers.scoreboard(true); }
  });
  addEventListener('keyup', (e) => { input.keys.delete(e.code); if (e.code === 'Tab') handlers.scoreboard(false); });
  addEventListener('blur', () => { input.keys.clear(); input.fire = false; });
  document.addEventListener('mousemove', (e) => { if (input.locked) { input.dx += e.movementX; input.dy += e.movementY; } });
  canvas.addEventListener('mousedown', (e) => { if (input.locked && e.button === 0) input.fire = true; });
  addEventListener('mouseup', (e) => { if (e.button === 0) input.fire = false; });
  addEventListener('wheel', (e) => { if (input.locked) input.wheel += Math.sign(e.deltaY); }, { passive: true });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) { input.fire = false; input.keys.clear(); }
    handlers.lockChange(input.locked);
  });
  document.addEventListener('pointerlockerror', () => handlers.lockError());
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}
export const wasPressed = (code) => input.pressed.has(code);

const v3 = { x: 0, y: 0, z: 0 };

export class LocalPlayer {
  constructor() {
    this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0; this.bodyYaw = 0; this.grounded = false; this.swim = true; this.wade = false;
    this.dashT = 0; this.dashCd = 0; this.dashDx = 0; this.dashDy = 0; this.dashDz = 0; this.stepAcc = 0; this.camDist = 4.3;
    this.speedH = 0; this.alive = false; this.epoch = 0; this.air = false;
  }
  teleport(x, y, z, yaw) { this.x = x; this.y = y; this.z = z; this.vx = this.vy = this.vz = 0; if (yaw !== undefined) { this.yaw = yaw; this.bodyYaw = yaw; } this.dashT = 0; }

  look() {
    const k = 0.0022 * settings.sens;
    this.yaw -= input.dx * k;
    this.pitch = clamp(this.pitch - input.dy * k * (settings.invertY ? -1 : 1), -1.4, 1.4);
    input.dx = input.dy = 0;
  }

  forward() { return [-Math.sin(this.yaw), -Math.cos(this.yaw)]; }

  // full 3D swim direction from the keys (W/S along the view, A/D strafe, Space up, C down)
  wishDir() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const f = [-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp], r = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    let x = 0, y = 0, z = 0;
    const k = input.keys;
    if (k.has('KeyW')) { x += f[0]; y += f[1]; z += f[2]; } if (k.has('KeyS')) { x -= f[0]; y -= f[1]; z -= f[2]; }
    if (k.has('KeyD')) { x += r[0]; z += r[2]; } if (k.has('KeyA')) { x -= r[0]; z -= r[2]; }
    if (k.has('Space')) y += 1; if (k.has('KeyC')) y -= 1;
    const l = Math.hypot(x, y, z);
    return l > 0.001 ? [x / l, y / l, z / l, f] : [0, 0, 0, f];
  }

  tryDash() {
    if (this.dashCd > 0 || this.dashT > 0) return null;
    const w = this.wishDir(); let d = [w[0], w[1], w[2]];
    if (!(d[0] || d[1] || d[2])) d = w[3];
    this.dashDx = d[0]; this.dashDy = d[1]; this.dashDz = d[2]; this.dashT = P.dash.ms / 1000; this.dashCd = P.dash.cooldownMs / 1000;
    return { dx: d[0], dz: d[2] };
  }

  update(dt, level, carry, control) {
    const ev = [];
    if (this.dashCd > 0) this.dashCd -= dt;
    let w = [0, 0, 0], boost = false;
    if (control) { w = this.wishDir(); boost = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight'); }
    const speed = (boost ? P.sprint : P.walk) * (1 - Math.min(carry, P.maxCarry) * P.carryMul);
    if (this.dashT > 0) {
      this.dashT -= dt; this.vx = this.dashDx * P.dash.speed; this.vy = this.dashDy * P.dash.speed; this.vz = this.dashDz * P.dash.speed;
    } else {
      const k = Math.min(1, dt * 3.2); // water inertia: gentle acceleration and glide
      this.vx += (w[0] * speed - this.vx) * k; this.vy += (w[1] * speed - this.vy) * k; this.vz += (w[2] * speed - this.vz) * k;
    }
    const ox = this.x, oy = this.y, oz = this.z;
    v3.x = this.x + this.vx * dt; v3.z = this.z + this.vz * dt;
    W.resolveCollisions(v3, P.radius, this.y);   // rocks, hulls, the lighthouse: swim over them or around them
    this.x = v3.x; this.z = v3.z;
    this.y += this.vy * dt;
    const g = W.surfaceAt(this.x, this.z, this.y);
    if (this.y < g) { this.y = g; if (this.vy < 0) this.vy = 0; }
    const ceil = level - 1.1;                     // head just breaks the surface
    if (this.y > ceil) { this.y = ceil; if (this.vy > 0) this.vy = 0; }
    W.clampToSea(this);
    const moved = Math.hypot(this.x - ox, this.y - oy, this.z - oz);
    this.speedH = dt > 0 ? moved / dt : 0;
    this.swim = true; this.grounded = false; this.air = false; this.wade = false;
    if (moved > 0.001) { this.stepAcc += moved; if (this.stepAcc > 2.6) { this.stepAcc = 0; ev.push('swimstroke'); } }
    let d = this.yaw - this.bodyYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.bodyYaw += d * Math.min(1, dt * 12);
    return ev;
  }

  // third-person camera pose with collision
  placeCamera(camera, dt) {
    const cy = Math.cos(this.pitch), f = [-Math.sin(this.yaw) * cy, Math.sin(this.pitch), -Math.cos(this.yaw) * cy];
    const r = [Math.cos(this.yaw), -Math.sin(this.yaw)];
    const tx = this.x + r[0] * 0.8, ty = this.y + 1.0, tz = this.z + r[1] * 0.8;
    let want = 4.4 + Math.max(0, -this.pitch) * 1.2;
    const hit = W.raycast(tx, ty, tz, -f[0], -f[1], -f[2], want + 0.4, 0.3);
    if (hit > 0) want = Math.max(0.7, hit - 0.35);
    this.camDist = want < this.camDist ? want : this.camDist + (want - this.camDist) * Math.min(1, dt * 4);
    const d = this.camDist;
    let cx = tx - f[0] * d, cyy = ty - f[1] * d, cz = tz - f[2] * d;
    cyy = Math.max(cyy, W.heightAt(cx, cz) + 0.25);
    camera.position.set(cx, cyy, cz);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, 0);
    this.camForward = f; this.lastCam = { x: cx, y: cyy, z: cz };
  }

  // world point under the crosshair (for shot direction)
  aimDirection() {
    const f = this.camForward || [0, 0, -1];
    const cam = this.lastCam;
    const eye = [this.x, this.y + P.eye, this.z];
    if (!cam) return f;
    const t = W.raycast(cam.x, cam.y, cam.z, f[0], f[1], f[2], 120, 0.5);
    const dist = t > 0 ? t : 120;
    const px = cam.x + f[0] * dist, py = cam.y + f[1] * dist, pz = cam.z + f[2] * dist;
    let dx = px - eye[0], dy = py - eye[1], dz = pz - eye[2];
    const l = Math.hypot(dx, dy, dz);
    if (dist < 3 || l < 1) return f;
    return [dx / l, dy / l, dz / l];
  }
}
