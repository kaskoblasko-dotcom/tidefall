// One Room = one independent match. The server owns all gameplay-critical
// state: health, weapons/ammo, hits, relics, scores, respawns and the tide clock.
// Clients only upload their own movement (validated here) and *requests* to
// fire / dash / swap. Nothing a client sends can directly change health or score.
import { TICK_RATE, PLAYER, WEAPONS, MATCH, SKINS, tideLevel, clamp } from '../public/shared/constants.js';
import * as W from '../public/shared/world.js';

const now = () => Date.now();
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;
const fin = (...v) => v.every((n) => typeof n === 'number' && Number.isFinite(n));

export class Room {
  constructor(code, opts) {
    this.code = code;
    this.name = opts.name;
    this.max = opts.max;
    this.target = opts.target;
    this.priv = !!opts.priv;
    this.created = now();
    this.t0 = now();
    this.players = new Map();
    this.nextId = 1;
    this.phase = 'play';
    this.matchEnd = now() + MATCH.durationMs;
    this.overUntil = 0;
    this.winner = 0;
    this.emptySince = now();
    this.tickN = 0;
    this.boardDirty = true;
    this.relicsDirty = true;
    this.lastBoard = 0;
    this.relics = W.RELIC_SITES.map((s) => ({
      id: s.id, kind: s.kind, value: s.value, home: s, respawn: s.respawn,
      state: 'ground', x: s.x, y: s.y, z: s.z, carrier: 0, respawnAt: 0,
    }));
    this.timer = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  // ---- helpers -------------------------------------------------------------
  get rt() { return (now() - this.t0) / 1000; }
  get level() { return tideLevel(this.rt); }
  get count() { return this.players.size; }
  get connectedCount() { let n = 0; for (const p of this.players.values()) if (p.conn) n++; return n; }
  summary() {
    return { code: this.code, name: this.name, players: this.connectedCount, max: this.max, target: this.target,
      phase: this.phase, left: Math.max(0, Math.round((this.matchEnd - now()) / 1000)) };
  }
  send(p, obj) { if (p.conn && p.conn.ws.readyState === 1) p.conn.ws.send(JSON.stringify(obj)); }
  broadcast(obj, exceptId = 0) {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) if (p.conn && p.id !== exceptId && p.conn.ws.readyState === 1) p.conn.ws.send(s);
  }
  invuln(p) { return now() < p.protectUntil || now() < p.iframeUntil; }

  // ---- membership ----------------------------------------------------------
  addPlayer(conn) {
    if (this.connectedCount >= this.max) return null;
    let name = conn.name, n = 2;
    const names = new Set([...this.players.values()].map((q) => q.name));
    while (names.has(name)) name = `${conn.name.slice(0, 14)}${n++}`;
    const p = {
      id: this.nextId++, token: conn.token, conn, name, skin: conn.skin,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, anim: 0, epoch: 0,
      hp: PLAYER.maxHp, alive: false, respawnAt: 0, protectUntil: 0, iframeUntil: 0, dashUntil: 0, dashReadyAt: 0,
      w: 0, ammo: WEAPONS.map((w) => w.mag), reloadAt: WEAPONS.map(() => 0), nextFire: 0,
      carried: [], score: 0, kills: 0, deaths: 0, lastDmg: 0, allow: 5, lastState: now(), lastCorr: 0,
      connected: true, graceUntil: 0, joinedAt: now(),
    };
    this.players.set(p.id, p);
    this.respawn(p, true);
    conn.player = p; conn.room = this;
    this.send(p, this.joinedMsg(p));
    this.broadcast({ t: 'pjoin', p: { id: p.id, name: p.name, skin: p.skin } }, p.id);
    this.boardDirty = true; this.relicsDirty = true;
    return p;
  }
  joinedMsg(p) {
    return {
      t: 'joined', code: this.code, name: this.name, max: this.max, target: this.target, you: p.id, token: p.token,
      rt: r2(this.rt), phase: this.phase, tl: Math.max(0, Math.ceil((this.matchEnd - now()) / 1000)),
      players: [...this.players.values()].map((q) => ({ id: q.id, name: q.name, skin: q.skin, hp: q.hp, alive: q.alive, w: q.w, x: r2(q.x), y: r2(q.y), z: r2(q.z), yaw: r2(q.yaw) })),
      relics: this.relicRows(), spawn: { x: r2(p.x), y: r2(p.y), z: r2(p.z), e: p.epoch, yaw: r2(p.yaw) },
      ammo: this.ammoMsg(p),
    };
  }
  resume(conn, p) { // reconnect within grace period
    p.conn = conn; p.connected = true; p.graceUntil = 0; conn.player = p; conn.room = this;
    p.epoch++; p.allow = 5; p.lastState = now();
    this.send(p, this.joinedMsg(p));
    this.broadcast({ t: 'ev', e: 'back', id: p.id }, p.id);
  }
  disconnect(p) { // socket dropped: keep the player briefly so a reconnect resumes the run
    if (!p.conn) return;
    p.conn = null; p.connected = false; p.graceUntil = now() + 25000;
    this.broadcast({ t: 'ev', e: 'lost', id: p.id });
  }
  removePlayer(p) {
    if (!this.players.has(p.id)) return;
    this.dropAll(p, 'leave');
    this.players.delete(p.id);
    if (p.conn) { p.conn.player = null; p.conn.room = null; }
    this.broadcast({ t: 'pleave', id: p.id });
    this.boardDirty = true;
    if (this.players.size === 0) this.emptySince = now();
  }
  destroy() { clearInterval(this.timer); }

  // ---- spawning ------------------------------------------------------------
  pickSpawn() {
    const alive = [...this.players.values()].filter((q) => q.alive);
    let best = null, bs = -1;
    for (const s of W.SPAWNS) {
      let d = 1e9; for (const q of alive) d = Math.min(d, Math.hypot(q.x - s.x, q.z - s.z));
      const score = d + Math.random() * 12;
      if (score > bs) { bs = score; best = s; }
    }
    return best;
  }
  respawn(p, first = false) {
    const s = this.pickSpawn();
    p.x = s.x + (Math.random() - 0.5) * 2; p.z = s.z + (Math.random() - 0.5) * 2; p.y = W.heightAt(p.x, p.z);
    p.yaw = Math.atan2(p.x, p.z); p.pitch = 0;
    p.epoch++; p.hp = PLAYER.maxHp; p.alive = true; p.allow = 5; p.lastState = now();
    p.protectUntil = now() + PLAYER.protectMs; p.iframeUntil = 0; p.dashUntil = 0;
    p.ammo = WEAPONS.map((w) => w.mag); p.reloadAt = WEAPONS.map(() => 0);
    p.nextFire = now() + 300;
    if (!first) {
      this.send(p, { t: 'spawn', x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw), e: p.epoch });
      this.send(p, this.ammoMsg(p));
      this.broadcast({ t: 'ev', e: 'spawn', id: p.id, x: r2(p.x), y: r2(p.y), z: r2(p.z) });
    }
  }

  // ---- message handling ----------------------------------------------------
  handle(p, m) {
    switch (m.t) {
      case 's': return this.onState(p, m);
      case 'fire': return this.onFire(p, m);
      case 'swap': return this.onSwap(p, m);
      case 'reload': return this.onReload(p);
      case 'dash': return this.onDash(p, m);
      case 'ping': return this.send(p, { t: 'pong', c: m.c, rt: r2(this.rt) });
      default: return undefined;
    }
  }

  onState(p, m) {
    if (!p.alive || m.e !== p.epoch || !fin(m.x, m.y, m.z, m.yaw, m.pitch)) return;
    const t = now();
    const dt = clamp((t - p.lastState) / 1000, 0, 0.5);
    p.lastState = t;
    const dashing = t < p.dashUntil + 120;
    p.allow = Math.min(p.allow + dt * (dashing ? 26 : 11.5), dashing ? 9 : 5);
    const dist = Math.hypot(m.x - p.x, m.z - p.z);
    const r = Math.hypot(m.x, m.z);
    const surf = W.surfaceAt(m.x, m.z, m.y);
    const bad = dist > p.allow + 0.6 || r > 130 || m.y > Math.max(surf + 2.6, this.level - 0.5) || m.y < W.heightAt(m.x, m.z) - 0.8;
    if (bad) {
      if (t - p.lastCorr > 250) { p.lastCorr = t; p.allow = 0; this.send(p, { t: 'corr', x: r2(p.x), y: r2(p.y), z: r2(p.z), e: p.epoch }); }
      return;
    }
    p.allow -= dist;
    p.x = m.x; p.y = m.y; p.z = m.z;
    p.yaw = m.yaw; p.pitch = clamp(m.pitch, -1.5, 1.5);
    p.anim = (m.a | 0) & 7;
  }

  onSwap(p, m) {
    const w = m.w | 0;
    if (!p.alive || w < 0 || w >= WEAPONS.length || w === p.w || this.phase !== 'play') return;
    p.w = w; p.nextFire = Math.max(p.nextFire, now() + 380);
    this.broadcast({ t: 'ev', e: 'swap', id: p.id, w });
    this.send(p, this.ammoMsg(p));
  }

  onReload(p) {
    const w = WEAPONS[p.w];
    if (!p.alive || !w.mag || p.ammo[p.w] >= w.mag || p.reloadAt[p.w]) return;
    p.reloadAt[p.w] = now() + w.reload * 1000;
    this.send(p, this.ammoMsg(p));
    this.broadcast({ t: 'ev', e: 'reload', id: p.id, w: p.w });
  }

  ammoMsg(p) {
    const t = now();
    return { t: 'ammo', w: p.w, a: p.ammo, rl: p.reloadAt.map((x) => (x ? Math.max(0, x - t) : 0)), dash: Math.max(0, p.dashReadyAt - t) };
  }

  onDash(p, m) {
    const t = now();
    if (!p.alive || this.phase !== 'play' || t < p.dashReadyAt || !fin(m.dx, m.dz)) return;
    if (this.level - p.y > PLAYER.deepDepth) return; // can't dash while swimming
    p.dashReadyAt = t + PLAYER.dash.cooldownMs;
    p.dashUntil = t + PLAYER.dash.ms;
    p.iframeUntil = t + PLAYER.dash.iframeMs;
    p.allow = Math.max(p.allow, 7);
    this.broadcast({ t: 'ev', e: 'dash', id: p.id, dx: r2(m.dx), dz: r2(m.dz) });
  }

  isWet(p) { return this.level - p.y > PLAYER.wetDepth; }
  isDeep(p) { return this.level - p.y > PLAYER.deepDepth; }

  // ---- combat --------------------------------------------------------------
  onFire(p, m) {
    const t = now();
    if (!p.alive || this.phase !== 'play' || m.w !== p.w || t < p.nextFire || !Array.isArray(m.d)) return;
    const w = WEAPONS[p.w];
    if (p.reloadAt[p.w]) return;
    let [dx, dy, dz] = m.d;
    if (!fin(dx, dy, dz)) return;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.1) return;
    dx /= len; dy /= len; dz /= len;
    if (w.wet && this.isWet(p)) { p.nextFire = t + 350; this.send(p, { t: 'ev', e: 'wet' }); return; }
    if (w.mag) {
      if (p.ammo[p.w] <= 0) { this.onReload(p); return; }
      p.ammo[p.w]--;
    }
    p.nextFire = t + w.cooldown * 1000;
    p.protectUntil = Math.min(p.protectUntil, t); // firing ends spawn protection
    const ox = p.x, oy = p.y + PLAYER.eye, oz = p.z;
    if (w.type === 'melee') this.melee(p, w, ox, oy, oz, dx, dz);
    else if (w.type === 'ray') this.shootRay(p, w, ox, oy, oz, dx, dy, dz);
    else this.shootSpread(p, w, ox, oy, oz, dx, dy, dz);
    if (w.mag && p.ammo[p.w] <= 0) p.reloadAt[p.w] = t + w.reload * 1000;
    this.send(p, this.ammoMsg(p));
  }

  worldT(ox, oy, oz, dx, dy, dz, maxT) {
    const h = W.raycast(ox, oy, oz, dx, dy, dz, maxT);
    return h < 0 ? maxT : h;
  }

  rayPlayers(shooter, ox, oy, oz, dx, dy, dz, maxT, tol = 0.14) {
    let best = null;
    const R = PLAYER.radius + tol;
    for (const v of this.players.values()) {
      if (v === shooter || !v.alive || !v.connected || this.invuln(v)) continue;
      const fx = ox - v.x, fz = oz - v.z;
      const a = dx * dx + dz * dz;
      if (a < 1e-6) continue;
      const b = fx * dx + fz * dz, c = fx * fx + fz * fz - R * R;
      const disc = b * b - a * c;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      let tt = (-b - sq) / a;
      if (tt < 0) { if (c < 0) tt = 0; else continue; }
      if (tt > maxT) continue;
      const y = oy + dy * tt;
      if (y < v.y - 0.05 || y > v.y + PLAYER.height + 0.1) continue;
      if (!best || tt < best.t) best = { v, t: tt, head: y > v.y + 1.42 };
    }
    return best;
  }

  shootRay(p, w, ox, oy, oz, dx, dy, dz) {
    const bt = this.worldT(ox, oy, oz, dx, dy, dz, w.range);
    const hit = this.rayPlayers(p, ox, oy, oz, dx, dy, dz, bt);
    const end = hit ? hit.t : bt;
    this.broadcast({ t: 'ev', e: 'shot', id: p.id, w: w.id, o: [r2(ox), r2(oy), r2(oz)], e1: [[r1(ox + dx * end), r1(oy + dy * end), r1(oz + dz * end)]], hit: hit ? 1 : 0 });
    if (hit) {
      this.damage(hit.v, w.dmg * (hit.head ? w.head : 1), p, w.id, hit.head);
      if (hit.v.carried.length && hit.v.alive) { // the harpoon hooks a relic loose and drags it toward the shooter
        const rid = hit.v.carried[hit.v.carried.length - 1];
        const tx = hit.v.x + (p.x - hit.v.x) * 0.25, tz = hit.v.z + (p.z - hit.v.z) * 0.25;
        this.dropRelic(rid, tx, tz, 'hooked');
      }
    }
  }

  shootSpread(p, w, ox, oy, oz, dx, dy, dz) {
    // orthonormal basis around the aim direction
    let ux = -dz, uy = 0, uz = dx;
    const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
    const dmgBy = new Map(); const ends = [];
    for (let i = 0; i < w.pellets; i++) {
      const ang = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * w.spread;
      let px = dx + (ux * Math.cos(ang) + vx * Math.sin(ang)) * rad;
      let py = dy + (uy * Math.cos(ang) + vy * Math.sin(ang)) * rad;
      let pz = dz + (uz * Math.cos(ang) + vz * Math.sin(ang)) * rad;
      const pl = Math.hypot(px, py, pz); px /= pl; py /= pl; pz /= pl;
      const bt = this.worldT(ox, oy, oz, px, py, pz, w.range);
      const hit = this.rayPlayers(p, ox, oy, oz, px, py, pz, bt, 0.2);
      const end = hit ? hit.t : bt;
      ends.push([r1(ox + px * end), r1(oy + py * end), r1(oz + pz * end)]);
      if (hit) {
        const mul = hit.t <= w.falloffStart ? 1 : 1 + (w.minMul - 1) * clamp((hit.t - w.falloffStart) / (w.range - w.falloffStart), 0, 1);
        dmgBy.set(hit.v, (dmgBy.get(hit.v) || 0) + w.dmg * mul);
      }
    }
    this.broadcast({ t: 'ev', e: 'shot', id: p.id, w: w.id, o: [r2(ox), r2(oy), r2(oz)], e1: ends, hit: dmgBy.size ? 1 : 0 });
    for (const [v, d] of dmgBy) this.damage(v, d, p, w.id, false);
  }

  melee(p, w, ox, oy, oz, dx, dz) {
    let hl = Math.hypot(dx, dz);
    if (hl < 0.05) { dx = -Math.sin(p.yaw); dz = -Math.cos(p.yaw); hl = 1; }
    dx /= hl; dz /= hl;
    this.broadcast({ t: 'ev', e: 'swing', id: p.id, w: w.id, dx: r2(dx), dz: r2(dz) });
    const victims = [];
    for (const v of this.players.values()) {
      if (v === p || !v.alive || !v.connected || this.invuln(v)) continue;
      const vx = v.x - p.x, vz = v.z - p.z, d = Math.hypot(vx, vz);
      if (d > w.range + PLAYER.radius || Math.abs(v.y - p.y) > 1.9) continue;
      const dot = d < 0.5 ? 1 : (vx * dx + vz * dz) / d;
      if (dot < w.arcDot) continue;
      const tx = v.x - ox, ty = v.y + 1.0 - oy, tz = v.z - oz, tl = Math.hypot(tx, ty, tz) || 1;
      if (W.raycast(ox, oy, oz, tx / tl, ty / tl, tz / tl, tl - 0.4) >= 0) continue;
      victims.push({ v, d });
    }
    victims.sort((a, b) => a.d - b.d);
    for (const { v } of victims.slice(0, 3)) {
      const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
      const back = fx * dx + fz * dz > 0.35; // attacker is behind the victim
      this.damage(v, w.dmg * (back ? w.backstab : 1), p, w.id, back);
    }
  }

  damage(v, dmg, k, wid, crit) {
    if (!v.alive || !v.connected || this.invuln(v) || this.phase !== 'play') return;
    dmg = Math.max(1, Math.round(dmg));
    v.hp -= dmg; v.lastDmg = now();
    this.broadcast({ t: 'ev', e: 'hit', a: k.id, v: v.id, d: dmg, c: crit ? 1 : 0, w: wid, hp: Math.max(0, v.hp) });
    if (v.hp <= 0) this.kill(v, k, wid);
  }

  kill(v, k, wid) {
    v.alive = false; v.hp = 0; v.deaths++; v.respawnAt = now() + PLAYER.respawnMs;
    if (k && k !== v) k.kills++;
    this.dropAll(v, 'death');
    this.broadcast({ t: 'ev', e: 'kill', k: k ? k.id : 0, v: v.id, w: wid, x: r2(v.x), y: r2(v.y), z: r2(v.z) });
    this.boardDirty = true;
  }

  // ---- relics --------------------------------------------------------------
  relicRows() { return this.relics.map((r) => [r.id, r.state === 'ground' ? 0 : r.state === 'carried' ? 1 : 2, r2(r.x), r2(r.y), r2(r.z), r.carrier, r.value, r.kind]); }
  dropAll(p, why) { for (const id of [...p.carried]) this.dropRelic(id, p.x + (Math.random() - 0.5) * 2.4, p.z + (Math.random() - 0.5) * 2.4, why); }
  dropRelic(id, x, z, why) {
    const r = this.relics.find((q) => q.id === id);
    if (!r) return;
    const holder = this.players.get(r.carrier);
    if (holder) holder.carried = holder.carried.filter((q) => q !== id);
    r.carrier = 0;
    const c = { x, z };
    W.clampToSea(c); W.resolveCollisions(c, 0.3, -99);
    r.x = c.x; r.z = c.z; r.y = W.heightAt(c.x, c.z);
    if (r.y < -0.8) { // sank into the deep: the sea returns it to its wreck later
      r.state = 'wait'; r.respawnAt = now() + 8000; r.x = r.home.x; r.y = r.home.y; r.z = r.home.z; why = 'sunk';
    } else r.state = 'ground';
    this.relicsDirty = true;
    this.broadcast({ t: 'ev', e: 'drop', id, by: holder ? holder.id : 0, why, x: r2(c.x), y: r2(r.y), z: r2(c.z) });
  }

  tickRelics(t, level) {
    for (const r of this.relics) {
      if (r.state === 'wait' && t >= r.respawnAt) { r.state = 'ground'; r.x = r.home.x; r.y = r.home.y; r.z = r.home.z; this.relicsDirty = true; }
    }
    for (const p of this.players.values()) {
      if (!p.alive || !p.connected) continue;
      if (p.carried.length && this.isDeep(p)) { this.dropAll(p, 'swim'); this.send(p, { t: 'ev', e: 'toast', m: 'The current tears your loot away.' }); }
      // pick up
      if (p.carried.length < PLAYER.maxCarry) {
        for (const r of this.relics) {
          if (r.state !== 'ground' || !W.relicExposed(level, r.y)) continue;
          if (Math.hypot(r.x - p.x, r.z - p.z) > 1.7 || Math.abs(r.y - p.y) > 2.5) continue;
          r.state = 'carried'; r.carrier = p.id; p.carried.push(r.id); this.relicsDirty = true;
          this.broadcast({ t: 'ev', e: 'pickup', id: r.id, by: p.id, kind: r.kind, value: r.value });
          if (p.carried.length >= PLAYER.maxCarry) break;
        }
      }
      // bank
      if (p.carried.length && Math.hypot(p.x - W.BANK.x, p.z - W.BANK.z) < W.BANK.r && Math.abs(p.y - W.heightAt(W.BANK.x, W.BANK.z)) < 3) {
        let total = 0;
        for (const id of p.carried) {
          const r = this.relics.find((q) => q.id === id);
          total += r.value; r.state = 'wait'; r.carrier = 0; r.respawnAt = t + r.respawn * 1000;
          r.x = r.home.x; r.y = r.home.y; r.z = r.home.z;
        }
        const n = p.carried.length; p.carried = [];
        p.score += total; this.boardDirty = true; this.relicsDirty = true;
        this.broadcast({ t: 'ev', e: 'bank', id: p.id, n, v: total, score: p.score });
      }
    }
    // carried relics follow their carrier (server position)
    for (const r of this.relics) if (r.state === 'carried') { const c = this.players.get(r.carrier); if (c) { r.x = c.x; r.y = c.y; r.z = c.z; } }
  }

  // ---- match flow ----------------------------------------------------------
  standings() {
    return [...this.players.values()].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths)
      .map((p) => ({ id: p.id, name: p.name, skin: p.skin, score: p.score, kills: p.kills, deaths: p.deaths }));
  }
  endMatch() {
    this.phase = 'over'; this.overUntil = now() + MATCH.overMs;
    const st = this.standings();
    this.winner = st.length && st[0].score > 0 ? st[0].id : 0;
    this.broadcast({ t: 'match', phase: 'over', winner: this.winner, standings: st, next: Math.round(MATCH.overMs / 1000) });
  }
  restartMatch() {
    this.phase = 'play'; this.matchEnd = now() + MATCH.durationMs; this.winner = 0;
    for (const r of this.relics) { r.state = 'ground'; r.carrier = 0; r.x = r.home.x; r.y = r.home.y; r.z = r.home.z; }
    for (const p of this.players.values()) { p.score = 0; p.kills = 0; p.deaths = 0; p.carried = []; p.dashReadyAt = 0; this.respawn(p); }
    this.relicsDirty = true; this.boardDirty = true;
    this.broadcast({ t: 'match', phase: 'play', tl: Math.round(MATCH.durationMs / 1000), target: this.target });
  }

  // ---- tick ----------------------------------------------------------------
  tick() {
    const t = now(); this.tickN++;
    const level = this.level;
    if (this.phase === 'play') {
      let top = 0; for (const p of this.players.values()) top = Math.max(top, p.score);
      if (t >= this.matchEnd || (this.players.size && top >= this.target)) this.endMatch();
    } else if (t >= this.overUntil) this.restartMatch();

    for (const p of this.players.values()) {
      if (!p.connected && t >= p.graceUntil) { this.removePlayer(p); continue; }
      if (!p.alive && this.phase === 'play' && t >= p.respawnAt) this.respawn(p);
      for (let i = 0; i < WEAPONS.length; i++) {
        if (p.reloadAt[i] && t >= p.reloadAt[i]) { p.reloadAt[i] = 0; p.ammo[i] = WEAPONS[i].mag; if (i === p.w) this.send(p, this.ammoMsg(p)); }
      }
      if (p.alive && p.hp < PLAYER.maxHp && t - p.lastDmg > PLAYER.regenDelayMs) p.hp = Math.min(PLAYER.maxHp, p.hp + PLAYER.regenPerSec / TICK_RATE);
    }
    if (this.phase === 'play') this.tickRelics(t, level);

    {
      const snap = { t: 'snap', n: this.tickN, rt: r2(this.rt), tl: Math.max(0, Math.ceil((this.matchEnd - t) / 1000)), ph: this.phase === 'play' ? 0 : 1,
        p: [...this.players.values()].map((p) => [p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), r2(p.pitch), p.anim, Math.round(p.hp), p.w, p.carried.length,
          (p.alive ? 1 : 0) | (this.invuln(p) ? 2 : 0) | (p.connected ? 0 : 4)]) };
      if (this.relicsDirty) { snap.r = this.relicRows(); this.relicsDirty = false; }
      if (this.boardDirty || t - this.lastBoard > 2000) {
        snap.b = [...this.players.values()].map((p) => [p.id, p.score, p.kills, p.deaths]); this.boardDirty = false; this.lastBoard = t;
      }
      this.broadcast(snap);
    }
  }
}
