// Game orchestration: renderer/scene, main loop, networking events, combat feedback.
import * as THREE from 'three';
import * as W from '../shared/world.js';
import { PLAYER, WEAPONS, SKINS, tideLevel, clamp } from '../shared/constants.js';
import { settings, addBanked } from './settings.js';
import { Net } from './net.js';
import { audio } from './audio.js';
import { setAnisotropy } from './textures.js';
import { bakeTerrainTexture, buildTerrainMesh, buildWater, buildSky, buildLights, updateSky, HORIZON, SUN_DIR } from './terrain.js';
import { buildProps, updateProps } from './props.js';
import { Character } from './character.js';
import { LocalPlayer, input, initInput, wasPressed } from './player.js';
import { Remotes } from './remote.js';
import { Relics } from './relics.js';
import { Fx } from './fx.js';
import { Hud, esc } from './hud.js';
import { UI } from './ui.js';

const $ = (id) => document.getElementById(id);
const r2 = (v) => Math.round(v * 100) / 100;
const WEAPON_SND = ['swing', 'harpoon', 'blunder'];
const ABYSS = new THREE.Color(0x03121c), DEEP_TMP = new THREE.Color(), UNDER_FOG = new THREE.Color(0x1d6f80), FOG = new THREE.Color(HORIZON);

export class Game {
  constructor() {
    this.mode = 'boot'; this.room = null; this.me = { id: 0 }; this.names = new Map(); this.board = []; this.alive = false; this.phase = 'play';
    this.w = 0; this.ammo = WEAPONS.map((w) => w.mag); this.reloadAt = WEAPONS.map(() => 0); this.nextFire = 0; this.dryT = 0;
    this.hp = 100; this.carryCount = 0; this.timeLeft = 0; this.timeAt = 0; this.sendAcc = 0; this.hudAcc = 0; this.epoch = 0; this.respawnAt = 0;
    this.sbShow = false; this.lastRising = null; this.menuT = 0; this.frames = 0; this.fpsT = 0; this.leaving = false; this.srvT = 0; this.protect = false;
  }

  // ---- boot ---------------------------------------------------------------------
  async boot(progress) {
    this.canvas = $('game');
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75)); r.setSize(innerWidth, innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    setAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(HORIZON); scene.fog = new THREE.Fog(HORIZON, 70, 430);
    this.camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.1, 2500);
    scene.add(this.camera);

    progress(0.02, 'Baking terrain textures...');
    const tex = await bakeTerrainTexture((p) => progress(0.02 + p * 0.6, 'Baking terrain textures...'));
    progress(0.64, 'Raising the island...');
    this.terrain = buildTerrainMesh(tex, r); scene.add(this.terrain);
    this.water = buildWater(); scene.add(this.water);
    this.sky = buildSky(); scene.add(this.sky);
    this.lights = buildLights(scene);
    await new Promise((res) => setTimeout(res, 0));
    progress(0.75, 'Placing wrecks, trees and stone...');
    this.props = buildProps(scene);
    await new Promise((res) => setTimeout(res, 0));
    progress(0.88, 'Preparing characters...');
    this.fx = new Fx(scene, $('ftext'));
    this.relics = new Relics(scene);
    this.remotes = new Remotes(scene);
    this.player = new LocalPlayer();
    this.localChar = new Character(settings.skin, 0); this.localChar.root.visible = false; scene.add(this.localChar.root);
    this.hud = new Hud();
    this.ui = new UI(this);
    this.hud.bakeMap(1.2);
    this.applySettings();

    initInput(this.canvas, {
      lockChange: (l) => this.onLock(l), lockError: () => { if (this.mode === 'game') $('clickprompt').hidden = false; },
      scoreboard: (v) => { this.sbShow = v && this.mode === 'game'; if (!this.sbShow) this.hud.scoreboard([], 0, false); },
    });
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden) input.fire = false; });
    // menu audio unlock on first gesture
    const unlock = () => { audio.init(); audio.startAmbient(); audio.startMusic(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);

    progress(0.95, 'Contacting server...');
    this.setupNet();
    this.net.start(() => ({ name: settings.name || 'Salvager', skin: settings.skin }));
    this.mode = 'menu';
    this.ui.show('scr-menu');
    progress(1, 'Ready');
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
  }
  applySettings() {
    this.camera.fov = settings.fov; this.camera.updateProjectionMatrix();
    const s = this.lights.sun;
    s.castShadow = settings.shadows !== 'off';
    const size = settings.shadows === 'low' ? 1024 : 2048;
    if (s.shadow.mapSize.x !== size) { s.shadow.mapSize.set(size, size); if (s.shadow.map) { s.shadow.map.dispose(); s.shadow.map = null; } }
    audio.applyVolumes();
  }

  // ---- networking ---------------------------------------------------------------
  setupNet() {
    const n = this.net = new Net();
    n.on('status', (s) => this.onStatus(s));
    n.on('rooms', (m) => this.ui.renderRooms(m.rooms));
    n.on('welcome', (m) => this.ui.renderRooms(m.rooms));
    n.on('joined', (m) => this.enterRoom(m));
    n.on('error', (m) => this.onError(m));
    n.on('resumeFailed', () => { if (this.mode === 'game') { this.toMenu(); this.ui.toast('Your seat in that room expired.', true); } });
    n.on('snap', (m) => this.onSnap(m));
    n.on('ev', (m) => this.onEv(m));
    n.on('spawn', (m) => this.onSpawn(m));
    n.on('corr', (m) => { if (m.e === this.epoch) this.player.teleport(m.x, m.y, m.z); });
    n.on('ammo', (m) => this.onAmmo(m));
    n.on('match', (m) => this.onMatch(m));
    n.on('pjoin', (m) => { this.names.set(m.p.id, m.p); this.remotes.add({ ...m.p, x: 0, y: -50, z: 0 }); this.hud.feed(`<span class="muted">${esc(m.p.name)} joined</span>`); });
    n.on('pleave', (m) => { const p = this.names.get(m.id); this.remotes.remove(m.id); if (p) this.hud.feed(`<span class="muted">${esc(p.name)} left</span>`); });
  }
  onStatus(s) {
    if (s.status === 'open') { this.ui.setServer('ok', 'Server online'); if (this.mode === 'game') this.hud.banner(null); }
    else if (s.status === 'connecting') this.ui.setServer('', 'Connecting... a sleeping server can take up to a minute');
    else if (s.status === 'reconnecting') {
      this.ui.setServer('bad', `Reconnecting (attempt ${s.attempt})...`);
      if (this.mode === 'game') this.hud.banner(`Connection lost - reconnecting (${s.attempt})...`);
    } else if (s.status === 'failed') {
      this.ui.setServer('bad', 'Server unreachable');
      if (this.mode === 'game') this.toMenu();
      this.ui.showError('Cannot reach the server', 'Check your connection or the server URL in Settings. Free Render instances may need a minute to wake.');
    }
  }
  onError(m) {
    this.ui.toast(m.m, true);
    if (this.ui.current === 'scr-join') { const e = $('join-err'); e.hidden = false; e.textContent = m.m; }
  }
  sendProfile() { this.net.send({ t: 'profile', name: settings.name || 'Salvager', skin: settings.skin }); }
  quickPlay() { this.sendProfile(); this.net.send({ t: 'quick' }); }
  createRoom(o) { this.sendProfile(); this.net.send({ t: 'create', ...o }); }
  joinCode(code) { this.sendProfile(); this.net.send({ t: 'join', code }); }
  listRooms() { this.net.send({ t: 'list' }); }
  retryConnect() { this.net.stop(); this.ui.show('scr-menu'); this.ui.setServer('', 'Connecting...'); this.net.start(() => ({ name: settings.name || 'Salvager', skin: settings.skin })); }

  // ---- entering / leaving rooms -----------------------------------------------------
  fade(fn) { const f = $('fade'); f.classList.add('on'); setTimeout(() => { fn(); setTimeout(() => f.classList.remove('on'), 80); }, 360); }

  enterRoom(m) {
    const resync = this.mode === 'game' && this.room && this.room.code === m.code;
    const apply = () => {
      this.room = { code: m.code, name: m.name, max: m.max, target: m.target }; this.mode = 'game'; this.leaving = false;
      this.me = { id: m.you }; this.names.clear(); this.remotes.clear(); this.relics.clear(); this.fx.clear();
      for (const p of m.players) {
        this.names.set(p.id, p);
        if (p.id === m.you) { this.w = p.w || 0; this.hp = p.hp; this.alive = p.alive; this.localChar.dispose(); this.scene.remove(this.localChar.root); this.localChar = new Character(p.skin, this.w); this.scene.add(this.localChar.root); }
        else this.remotes.add({ ...p });
      }
      this.relics.set(m.relics); this.refreshCarry();
      this.player.teleport(m.spawn.x, m.spawn.y, m.spawn.z, m.spawn.yaw); this.player.pitch = 0.1; this.player.alive = true; this.player.camDist = 4.4;
      this.epoch = m.spawn.e; this.alive = true; this.phase = m.phase === 'over' ? 'over' : 'play'; this.timeLeft = m.tl; this.timeAt = performance.now() / 1000;
      this.onAmmo(m.ammo); this.protect = true; this.board = m.players.map((p) => ({ id: p.id, score: 0, kills: 0, deaths: 0 }));
      this.hud.setRoom(m.name, m.code, m.target); this.hud.show(true); this.hud.death(false); this.hud.banner(null); this.localChar.root.visible = true;
      this.ui.hide(); audio.init(); audio.duck(false); this.lastRising = null;
      this.hud.leaderboard(this.sortedBoard(), this.me.id);
      this.requestLock();
      this.hud.center('Salvage the flats', 2200);
      this.hud.feed(`<span class="muted">Joined ${esc(m.name)} (${m.code})</span>`);
    };
    if (resync) apply(); else this.fade(apply);
  }
  toMenu() {
    this.leaving = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.focus = null; this.mode = "menu"; this.room = null; this.hud.show(false); this.hud.death(false); $('clickprompt').hidden = true;
    this.remotes.clear(); this.relics.clear(); this.fx.clear(); this.localChar.root.visible = false; this.hud.banner(null);
    this.ui.hideOver(); this.ui.show('scr-menu'); this.net.session = null;
  }
  leave() { this.net.send({ t: 'leave' }); this.fade(() => this.toMenu()); }

  // ---- pointer lock / pause -----------------------------------------------------------
  requestLock() { try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => { $('clickprompt').hidden = false; }); } catch { $('clickprompt').hidden = false; } }
  resume() { this.ui.hide(); $('clickprompt').hidden = true; this.requestLock(); }
  onLock(locked) {
    if (this.mode !== 'game') return;
    if (locked) { $('clickprompt').hidden = true; if (this.ui.current === 'scr-pause') this.ui.hide(); return; }
    if (this.leaving || this.ui.current === 'scr-over') return;
    $('clickprompt').hidden = true; this.ui.show('scr-pause');
  }

  // ---- snapshots & events ----------------------------------------------------------------
  sortedBoard() {
    return this.board.map((b) => ({ ...b, name: (this.names.get(b.id) || {}).name || '?' })).sort((a, b) => b.score - a.score || b.kills - a.kills);
  }
  onSnap(m) {
    if (this.mode !== 'game') return;
    const now = performance.now() / 1000;
    for (const row of m.p) {
      if (row[0] === this.me.id) { this.hp = row[7]; this.carryCount = row[9]; this.protect = !!(row[10] & 2); this.o2 = row[11] === undefined ? PLAYER.o2Max : row[11]; }
      else this.remotes.push(row, now);
    }
    this.timeLeft = m.tl; this.timeAt = now;
    if (m.r) { this.relics.set(m.r); this.refreshCarry(); }
    if (m.b) { this.board = m.b.map((r) => ({ id: r[0], score: r[1], kills: r[2], deaths: r[3] })); this.hud.leaderboard(this.sortedBoard(), this.me.id); }
  }
  refreshCarry() {
    const mine = this.relics.kindsFor(this.me.id);
    this.hud.setCarry(mine); this.localChar.setCarry(mine.length, mine);
    for (const p of this.remotes.map.values()) p.kinds = this.relics.kindsFor(p.id);
  }
  onAmmo(m) {
    const now = performance.now() / 1000;
    this.ammo = m.a.slice(); this.reloadAt = m.rl.map((ms) => (ms > 0 ? now + ms / 1000 : 0));
    if (m.dash > 0) this.player.dashCd = Math.max(this.player.dashCd, m.dash / 1000);
  }
  onSpawn(m) {
    this.player.teleport(m.x, m.y, m.z, m.yaw); this.epoch = m.e; this.alive = true; this.hp = PLAYER.maxHp;
    this.hud.death(false); this.localChar.setDead(false); this.nextFire = 0; this.carryCount = 0;
    audio.play('respawn'); this.hud.center('Back on the beach', 1200);
  }
  onMatch(m) {
    if (this.mode !== 'game') return;
    if (m.phase === 'over') {
      this.phase = 'over'; this.ui.showOver(m, this.me.id); audio.play(m.winner === this.me.id ? 'win' : 'matchEnd');
      if (document.pointerLockElement) { this.leaving = true; document.exitPointerLock(); setTimeout(() => { this.leaving = false; }, 100); }
    } else {
      this.phase = 'play'; this.ui.hideOver(); this.hud.center('New dive - surface for air', 2200); audio.play('bell'); this.requestLock();
      this.board = this.board.map((b) => ({ ...b, score: 0, kills: 0, deaths: 0 })); this.hud.leaderboard(this.sortedBoard(), this.me.id);
    }
  }

  charOf(id) { return id === this.me.id ? this.localChar : (this.remotes.map.get(id) || {}).char; }
  posOf(id) { if (id === this.me.id) return this.player; return this.remotes.map.get(id); }
  nameOf(id) { return id === this.me.id ? (this.names.get(id) || {}).name || 'You' : (this.names.get(id) || {}).name || '?'; }

  onEv(m) {
    if (this.mode !== 'game') return;
    const V = THREE.Vector3;
    switch (m.e) {
      case 'shot': {
        const mine = m.id === this.me.id, ch = this.charOf(m.id), pos = this.posOf(m.id);
        const w = WEAPONS[m.w], from = new V();
        if (ch && ch.weapon) ch.muzzleWorld(from); else from.set(m.o[0], m.o[1], m.o[2]);
        if (!mine && ch) ch.attack(m.w);
        if (!mine) audio.play(WEAPON_SND[m.w], pos ? { x: pos.x, z: pos.z } : null);
        this.fx.flash(from, w.type === 'ray' ? 0xcfe8ff : 0xffd890, w.type === 'spread' ? 2.4 : 1.4);
        this.fx.burst(from, 0xb8b4aa, w.type === 'spread' ? 6 : 3, 2, 0.8, -1, w.type === 'spread' ? 0.6 : 0.4);
        m.e1.forEach((e, i) => {
          const to = new V(e[0], e[1], e[2]);
          this.fx.tracer(from, to, w.type === 'ray' ? 0xdff0ff : 0xffe6a0, w.type === 'ray' ? 0.35 : 0.12, w.type === 'ray' ? 0.05 : 0.025);
          if (i < 3 || w.type === 'ray') { const wet = e[1] < tideLevel(this.net.roomTime()) + 0.1 && W.heightAt(e[0], e[2]) < e[1] + 0.5; wet ? this.fx.splash(e[0], tideLevel(this.net.roomTime()), e[2], 6) : this.fx.burst(to, 0xc8b88a, 4, 2.5, 0.4, 8, 0.18); }
        });
        break;
      }
      case 'swing': {
        if (m.id !== this.me.id) { const ch = this.charOf(m.id); if (ch) ch.attack(0); const p = this.posOf(m.id); audio.play('swing', p ? { x: p.x, z: p.z } : null); }
        break;
      }
      case 'hit': {
        const v = this.posOf(m.v), vc = this.charOf(m.v);
        if (vc) vc.flash();
        const vp = v ? new V(v.x, (v.y || 0) + 2.1, v.z) : null;
        if (m.v === this.me.id) {
          this.hp = m.hp; audio.play('hurt'); const a = this.posOf(m.a);
          let ang = null;
          if (a && m.a !== m.v) { const dx = a.x - this.player.x, dz = a.z - this.player.z, yaw = this.player.yaw; ang = Math.atan2(dx * Math.cos(yaw) - dz * Math.sin(yaw), -(dx * Math.sin(yaw) + dz * Math.cos(yaw))); }
          this.hud.hurt(ang);
          if (vp) this.fx.text(vp, `-${m.d}`, 'hurt');
        } else {
          const rp = this.remotes.map.get(m.v); if (rp) { rp.hp = m.hp; this.remotes.drawTag(rp); }
          if (m.a === this.me.id) { audio.play(m.c ? 'crit' : 'hitmark'); this.hud.hitmarker(m.hp <= 0); }
          audio.play(m.w === 0 ? 'slash' : 'hitmark', v ? { x: v.x, z: v.z } : null, 0.6);
          if (vp) this.fx.text(vp, `${m.d}${m.c ? '!' : ''}`, m.c ? 'crit' : '');
          if (v) this.fx.burst(new V(v.x, v.y + 1.3, v.z), 0xc2452f, 6, 3, 0.4, 9, 0.2);
        }
        break;
      }
      case 'kill': {
        const killer = this.nameOf(m.k), victim = this.nameOf(m.v), w = WEAPONS[m.w];
        this.hud.feed(`<b>${m.k ? esc(killer) : 'The sea'}</b> <span class="muted">${w ? w.name : ''}</span> <b>${esc(victim)}</b>`);
        const vc = this.charOf(m.v); if (vc) vc.setDead(true);
        const v = this.posOf(m.v); if (v) this.fx.burst(new V(m.x, m.y + 1, m.z), 0xcfd8d8, 14, 4, 0.8, 8, 0.3);
        if (m.v === this.me.id) {
          this.alive = false; input.fire = false; this.respawnAt = performance.now() / 1000 + PLAYER.respawnMs / 1000; this.deathBy = m.k && m.k !== m.v ? `Dragged under by ${killer}` : 'Out of air';
          audio.play('die'); this.player.dashT = 0; this.carryCount = 0;
        } else {
          audio.play('kill', v ? { x: v.x, z: v.z } : null, 0.7);
          if (m.k === this.me.id) { this.hud.center(`Eliminated ${victim}`, 1400); audio.play('kill'); }
        }
        break;
      }
      case 'spawn': { if (m.id !== this.me.id) { const p = this.remotes.map.get(m.id); if (p) { p.buf.length = 0; p.x = m.x; p.y = m.y; p.z = m.z; p.hp = 100; this.remotes.drawTag(p); p.char.setDead(false); } audio.play('respawn', { x: m.x, z: m.z }, 0.6); } break; }
      case 'swap': { if (m.id !== this.me.id) { const p = this.remotes.map.get(m.id); if (p) { p.w = m.w; p.char.setWeapon(m.w); audio.play('swap', { x: p.x, z: p.z }, 0.6); } } break; }
      case 'reload': { if (m.id !== this.me.id) { const p = this.remotes.map.get(m.id); if (p) audio.play('reload', { x: p.x, z: p.z }, 0.6); } break; }
      case 'dash': { if (m.id !== this.me.id) { const p = this.remotes.map.get(m.id); if (p) { audio.play('dash', { x: p.x, z: p.z }, 0.7); this.fx.burst(new V(p.x, p.y + 0.2, p.z), 0xc8b88a, 6, 3, 0.4, 6, 0.3); } } break; }
      case 'pickup': {
        const p = this.posOf(m.by); audio.play('pickup', m.by === this.me.id ? null : (p ? { x: p.x, z: p.z } : null), m.by === this.me.id ? 1 : 0.6);
        if (m.by === this.me.id) { this.hud.toast(`Picked up a ${m.kind === 'deep' ? 'deep pearl' : m.kind} (+${m.value}). Take it to the Beacon.`); if (p) this.fx.text(new V(p.x, p.y + 2.2, p.z), `+${m.value}`, 'gain'); }
        break;
      }
      case 'drop': {
        audio.play('drop', { x: m.x, z: m.z }, 0.7);
        this.fx.splash(m.x, Math.max(m.y, tideLevel(this.net.roomTime())), m.z, 6);
        if (m.by === this.me.id && m.why === 'hooked') this.hud.toast('A harpoon hooked your loot loose!');
        if (m.why === 'sunk') this.hud.feed('<span class="muted">A relic sank into the deep</span>');
        break;
      }
      case 'bank': {
        const p = this.posOf(m.id); audio.play('bank', m.id === this.me.id ? null : (p ? { x: p.x, z: p.z } : null), m.id === this.me.id ? 1 : 0.6);
        if (p) this.fx.burst(new V(W.BANK.x, W.BANK.y || W.heightAt(W.BANK.x, W.BANK.z) + 1.5, W.BANK.z), 0xffc060, 20, 5, 1.0, 4, 0.35);
        if (m.id === this.me.id) {
          this.hud.center(`Banked +${m.v}`, 1500); const unlock = addBanked(m.v);
          if (unlock) setTimeout(() => this.hud.toast(`Skin unlocked: ${unlock.name}`), 1600);
        } else this.hud.feed(`<b>${esc(this.nameOf(m.id))}</b> <span class="muted">banked ${m.v}</span>`);
        break;
      }
      case 'toast': this.hud.toast(m.m); break;
      case 'lost': { const p = this.remotes.map.get(m.id); if (p) { p.ghost = true; this.remotes.drawTag(p); } break; }
      case 'back': { const p = this.remotes.map.get(m.id); if (p) { p.ghost = false; this.remotes.drawTag(p); } break; }
      default: break;
    }
  }

  // ---- local combat input -------------------------------------------------------------------
  swap(w) {
    if (w === this.w || w < 0 || w >= WEAPONS.length) return;
    this.w = w; this.net.send({ t: 'swap', w }); this.localChar.setWeapon(w); audio.play('swap'); this.nextFire = Math.max(this.nextFire, performance.now() / 1000 + 0.38);
  }
  fireTick(now, level) {
    if (!input.fire) return;
    const w = WEAPONS[this.w];
    if (now < this.nextFire) return;
    if (w.mag && (this.ammo[w.id] <= 0 || this.reloadAt[w.id] > now)) { if (now > this.dryT) { audio.play('dry'); this.dryT = now + 0.4; } return; }
    this.nextFire = now + w.cooldown + 0.01;
    const d = this.player.aimDirection();
    this.net.send({ t: 'fire', w: w.id, d: [r2(d[0]), r2(d[1]), r2(d[2])] });
    this.localChar.attack(w.id); audio.play(WEAPON_SND[w.id]);
    if (w.mag) { this.ammo[w.id]--; if (this.ammo[w.id] <= 0) this.reloadAt[w.id] = now + w.reload; }
    if (w.type !== 'melee') this.player.pitch = clamp(this.player.pitch + (w.type === 'spread' ? 0.035 : 0.02), -1.15, 1.2);
  }

  surfaceSound(p, level) {
    if (level - p.y > PLAYER.wadeDepth) return 'stepWater';
    if (W.surfaceAt(p.x, p.z, p.y) > W.heightAt(p.x, p.z) + 0.1) return 'stepWood';
    const w = W.biomeWeights(p.x, p.z, p.y, W.slopeAt(p.x, p.z));
    let mi = 0; for (let i = 1; i < 5; i++) if (w[i] > w[mi]) mi = i;
    return ['stepSand', 'stepGrass', 'stepGrass', 'stepGrass', 'stepRock'][mi];
  }

  // ---- main loop ----------------------------------------------------------------------------
  loop(ms) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.05, (ms - this.last) / 1000); this.last = ms;
    const t = ms / 1000;
    try {
      if (this.mode === 'game') this.tickGame(dt, t); else this.tickMenu(dt, t);
    } catch (e) { console.error(e); }
    this.renderer.render(this.scene, this.camera);
    this.frames++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { $('fps').textContent = settings.fps ? `${Math.round(this.frames / this.fpsT)} fps  ${Math.round(this.net.rtt)} ms` : ''; this.frames = 0; this.fpsT = 0; }
  }

  tickMenu(dt, t) {
    const level = tideLevel(t * 1.4 + 20);
    const a = t * 0.045, R = 88;
    this.camera.position.set(Math.cos(a) * R + 4, 44 + Math.sin(t * 0.1) * 5, Math.sin(a) * R - 6);
    this.camera.lookAt(0, 8, -6); this.camera.rotation.z = 0;
    this.world(dt, t, level);
    if (t - this.srvT > 2 && this.net.status === 'open') { this.srvT = t; this.ui.setServer('ok', `Server online - ${Math.round(this.net.rtt)} ms`); }
  }

  world(dt, t, level) {
    const cam = this.camera.position;
    const tile = 1400 / 90;
    this.water.position.set(Math.round(cam.x / tile) * tile, level, Math.round(cam.z / tile) * tile);
    const nm = this.water.userData.nm; nm.offset.x = (t * 0.004) % 1; nm.offset.y = (t * 0.0027) % 1;
    updateSky(this.sky, cam, dt); updateProps(this.props, t);
    const depth = Math.max(0, level - cam.y);
    this.sky.visible = depth < 0.05;
    const sun = this.lights.sun, tp = this.focus || cam;
    sun.target.position.set(tp.x, tp.y, tp.z); sun.position.set(tp.x + SUN_DIR.x * 100, tp.y + SUN_DIR.y * 100, tp.z + SUN_DIR.z * 100);
    const under = depth > 0.05, dk = Math.min(1, depth / 38);
    DEEP_TMP.copy(UNDER_FOG).lerp(ABYSS, dk);
    const fc = under ? DEEP_TMP : FOG;
    this.scene.fog.color.copy(fc); this.scene.background.copy(fc);
    this.scene.fog.near = under ? 1 : 70; this.scene.fog.far = under ? 60 - dk * 34 : 430;
    this.lights.hemi.intensity = under ? 0.95 - dk * 0.6 : 0.95; sun.intensity = under ? 2.5 * (1 - dk * 0.85) : 2.5;
    audio.setTideAmbience(level);
    this.fx.update(dt, this.camera, innerWidth, innerHeight);
    this.relics.update(t, level);
  }

  tickGame(dt, t) {
    const P = this.player, now = t;
    const rtm = this.net.roomTime(), level = tideLevel(rtm);
    const playing = this.phase === 'play';
    const control = this.alive && input.locked && playing;
    if (input.locked) P.look(); else { input.dx = input.dy = 0; }
    if (control) {
      if (wasPressed('Digit1')) this.swap(0); if (wasPressed('Digit2')) this.swap(1); if (wasPressed('Digit3')) this.swap(2);
      if (input.wheel) { this.swap((this.w + (input.wheel > 0 ? 1 : WEAPONS.length - 1)) % WEAPONS.length); }
      if (wasPressed('KeyR') && WEAPONS[this.w].mag) this.net.send({ t: 'reload' });
      if (wasPressed('KeyQ')) { const d = P.tryDash(level); if (d) { this.net.send({ t: 'dash', dx: r2(d.dx), dz: r2(d.dz) }); audio.play('dash'); this.fx.burst(new THREE.Vector3(P.x, P.y + 0.2, P.z), 0xc8b88a, 8, 3, 0.4, 6, 0.3); } }
    }
    input.wheel = 0; input.pressed.clear();
    const evs = P.update(dt, level, this.carryCount, control);
    for (const e of evs) {
      if (e === 'jump') audio.play('jump'); else if (e === 'land') audio.play('land');
      else if (e === 'step') { const s = this.surfaceSound(P, level); audio.play(s); if (s === 'stepWater') this.fx.ripple(P.x, level, P.z, 1.4); }
      else if (e === 'swimstroke') { audio.play('bubble'); this.fx.burst(new THREE.Vector3(P.x, P.y + 1.3, P.z), 0xcfeeff, 3, 0.6, 1.4, -2.5, 0.12); }
    }
    if (control) this.fireTick(now, level);

    // upload state
    this.sendAcc += dt;
    if (this.alive && this.sendAcc >= 0.05) {
      this.sendAcc = 0;
      const a = P.dashT > 0 ? 5 : 4;
      this.net.send({ t: 's', x: r2(P.x), y: r2(P.y), z: r2(P.z), yaw: r2(P.bodyYaw), pitch: r2(P.pitch), a, e: this.epoch });
    }
    // local model
    const c = this.localChar;
    c.root.position.set(P.x, P.y, P.z); c.root.rotation.y = P.bodyYaw;
    c.setDead(!this.alive);
    c.update(dt, { speed: P.speedH, air: P.air, swim: P.swim, dash: P.dashT > 0 });
    this.focus = P;
    P.placeCamera(this.camera, dt);
    // other players, footsteps
    this.remotes.update(dt, now, level);
    for (const p of this.remotes.map.values()) {
      if (p.alive && p.speed > 1.5 && p.anim < 3) { p.stepAcc = (p.stepAcc || 0) + p.speed * dt; if (p.stepAcc > 2.2) { p.stepAcc = 0; const d = Math.hypot(p.x - P.x, p.z - P.z); if (d < 40) audio.play(this.surfaceSound(p, level), { x: p.x, z: p.z }, 0.7); } }
      if (p.alive && p.anim === 4 && level - p.y < 2.5 && Math.random() < dt * 1.5) this.fx.ripple(p.x, level, p.z, 1.6);
    }
    audio.setListener(this.camera.position.x, this.camera.position.z, P.yaw);
    this.world(dt, t, level);

    // HUD
    this.hudAcc += dt;
    if (this.hudAcc > 0.066) {
      this.hudAcc = 0;
      const left = Math.max(0, this.timeLeft - (now - this.timeAt));
      this.hud.setTime(left); this.hud.setHp(this.hp);
      const o2 = this.o2 === undefined ? PLAYER.o2Max : this.o2;
      this.hud.setDive(level - P.y, o2);
      if (o2 < 25 && this.alive && now - (this.lastWarn || 0) > 3) { this.lastWarn = now; audio.play('bell'); this.hud.toast('Low oxygen - head for the surface or the beacon'); }
      const rl = this.reloadAt.map((x) => Math.max(0, (x - now) * 1000));
      this.hud.setWeapons(this.w, this.ammo, rl, null, Math.max(0, P.dashCd));
      if (!this.alive) this.hud.death(true, this.deathBy || 'Eliminated', this.respawnAt - now);
      if (this.sbShow) {
        const ping = Math.round(this.net.rtt);
        this.hud.scoreboard(this.sortedBoard().map((r) => ({ ...r, ping, carry: r.id === this.me.id ? this.carryCount : (this.remotes.map.get(r.id) || {}).carry })), this.me.id, true);
      }
      this.hud.minimap(level, { x: P.x, z: P.z, yaw: P.yaw }, [...this.remotes.map.values()], this.relics.list(), now);
    }
    audio.duck(!this.alive);
  }
}
