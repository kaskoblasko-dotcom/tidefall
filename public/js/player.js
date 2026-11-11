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
    this.yaw = 0; this.pitch = 0; this.bodyYaw = 0; this.grounded = true; this.swim = false; this.wade = false;
    this.dashT = 0; this.dashCd = 0; this.dashDx = 0; this.dashDz = 0; this.stepAcc = 0; this.camDist = 4.3;
    this.speedH = 0; this.alive = false; this.epoch = 0; this.air = false;
  }
  teleport(x, y, z, yaw) { this.x = x; this.y = y; this.z = z; this.vx = this.vy = this.vz = 0; this.grounded = true; if (yaw !== undefined) { this.yaw = yaw; this.bodyYaw = yaw; } this.dashT = 0; }

  look() {
    const k = 0.0022 * settings.sens;
    this.yaw -= input.dx * k;
    this.pitch = clamp(this.pitch - input.dy * k * (settings.invertY ? -1 : 1), -1.15, 1.2);
    input.dx = input.dy = 0;
  }

  forward() { return [-Math.sin(this.yaw), -Math.cos(this.yaw)]; }

  tryDash(level) {
    if (this.dashCd > 0 || this.dashT > 0 || this.swim) return null;
    let mx = 0, mz = 0;
    const f = this.forward(), r = [Math.cos(this.yaw), -Math.sin(this.yaw)];
    if (input.keys.has('KeyW')) { mx += f[0]; mz += f[1]; } if (input.keys.has('KeyS')) { mx -= f[0]; mz -= f[1]; }
    if (input.keys.has('KeyD')) { mx += r[0]; mz += r[1]; } if (input.keys.has('KeyA')) { mx -= r[0]; mz -= r[1]; }
    const l = Math.hypot(mx, mz); if (l < 0.01) { mx = f[0]; mz = f[1]; } else { mx /= l; mz /= l; }
    this.dashDx = mx; this.dashDz = mz; this.dashT = P.dash.ms / 1000; this.dashCd = P.dash.cooldownMs / 1000;
    return { dx: mx, dz: mz };
  }

  update(dt, level, carry, control) {
    const ev = [];
    if (this.dashCd > 0) this.dashCd -= dt;
    const gTerrain = W.heightAt(this.x, this.z);
    const surf = W.surfaceAt(this.x, this.z, this.y);
    const depthG = level - gTerrain;
    this.swim = depthG > P.deepDepth && surf <= gTerrain + 0.05;
    this.wade = level - this.y > P.wadeDepth;
    let mx = 0, mz = 0, sprint = false, jump = false;
    if (control) {
      const f = this.forward(), r = [Math.cos(this.yaw), -Math.sin(this.yaw)];
      if (input.keys.has('KeyW')) { mx += f[0]; mz += f[1]; } if (input.keys.has('KeyS')) { mx -= f[0]; mz -= f[1]; }
      if (input.keys.has('KeyD')) { mx += r[0]; mz += r[1]; } if (input.keys.has('KeyA')) { mx -= r[0]; mz -= r[1]; }
      const l = Math.hypot(mx, mz); if (l > 0) { mx /= l; mz /= l; }
      sprint = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
      jump = input.keys.has('Space');
    }
    let speed = (sprint && !this.swim ? P.sprint : P.walk) * (1 - Math.min(carry, P.maxCarry) * P.carryMul);
    if (this.swim) speed *= P.swimMul; else if (this.wade) speed *= P.wadeMul;
    const accel = this.grounded || this.swim ? 48 : 14;
    if (this.dashT > 0) {
      this.dashT -= dt; this.vx = this.dashDx * P.dash.speed; this.vz = this.dashDz * P.dash.speed;
    } else {
      const tx = mx * speed, tz = mz * speed, dx = tx - this.vx, dz = tz - this.vz, dl = Math.hypot(dx, dz), step = accel * dt;
      if (dl <= step) { this.vx = tx; this.vz = tz; } else { this.vx += (dx / dl) * step; this.vz += (dz / dl) * step; }
    }
    // vertical
    if (this.swim) {
      this.grounded = false;
      this.vy = (level - 1.1 - this.y) * 5;
    } else {
      if (this.grounded && jump && this.dashT <= 0) { this.vy = P.jump * (this.wade ? 0.85 : 1); this.grounded = false; ev.push('jump'); }
      if (!this.grounded) this.vy -= P.gravity * (this.dashT > 0 ? 0.3 : 1) * dt;
    }
    // horizontal with slope + collider handling
    const tryMove = (nx, nz) => {
      v3.x = nx; v3.z = nz; W.resolveCollisions(v3, P.radius, this.y);
      const run = Math.hypot(v3.x - this.x, v3.z - this.z);
      const gs = W.surfaceAt(v3.x, v3.z, this.y);
      if (this.grounded && !this.swim && gs - this.y > Math.max(0.12, run * P.maxSlope)) return false;
      this.x = v3.x; this.z = v3.z; return true;
    };
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt, ox = this.x, oz = this.z;
    if (!tryMove(nx, nz)) {
      if (!tryMove(nx, this.z)) this.vx = 0;
      if (!tryMove(this.x, nz)) this.vz = 0;
    }
    W.clampToSea(this);
    const moved = Math.hypot(this.x - ox, this.z - oz);
    this.speedH = dt > 0 ? moved / dt : 0;
    // ground follow
    const yPrev = this.y;
    this.y += this.vy * dt;
    const g = W.surfaceAt(this.x, this.z, Math.max(yPrev, this.y));
    if (this.swim) { this.air = false; }
    else if (this.grounded) {
      if (yPrev - g < 0.55) { this.y = g; this.vy = 0; } else { this.grounded = false; }
    } else if (this.y <= g && this.vy <= 0) {
      if (this.vy < -9) ev.push('land');
      this.y = g; this.vy = 0; this.grounded = true;
    }
    this.air = !this.grounded && !this.swim;
    // footsteps
    if (this.grounded && !this.swim && this.speedH > 1) {
      this.stepAcc += moved;
      if (this.stepAcc > (sprint ? 2.5 : 1.9)) { this.stepAcc = 0; ev.push('step'); }
    } else if (this.swim && this.speedH > 0.8) { this.stepAcc += moved; if (this.stepAcc > 2.2) { this.stepAcc = 0; ev.push('swimstroke'); } }
    // body yaw follows the camera
    let d = this.yaw - this.bodyYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.bodyYaw += d * Math.min(1, dt * 16);
    return ev;
  }

  // third-person camera pose with collision
  placeCamera(camera, dt) {
    const cy = Math.cos(this.pitch), f = [-Math.sin(this.yaw) * cy, Math.sin(this.pitch), -Math.cos(this.yaw) * cy];
    const r = [Math.cos(this.yaw), -Math.sin(this.yaw)];
    const tx = this.x + r[0] * 0.8, ty = this.y + 1.55, tz = this.z + r[1] * 0.8;
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
