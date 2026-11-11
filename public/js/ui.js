// Menus: main menu, room browser, create/join, character, settings, help, pause, results.
import * as THREE from 'three';
import { Character } from './character.js';
import { SKINS, WEAPONS } from '../shared/constants.js';
import { settings, set, unlocked } from './settings.js';
import { audio } from './audio.js';
import { esc, fmt } from './hud.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(app) {
    this.app = app; this.stack = []; this.current = null; this.toastT = 0; this.browserTimer = 0; this.previewOn = false;
    this.screens = [...document.querySelectorAll('.screen')];
    this.bind();
  }

  // ---- navigation ----------------------------------------------------------
  show(id, push = false) {
    if (push && this.current) this.stack.push(this.current);
    this.current = id;
    for (const s of this.screens) s.hidden = s.id !== id;
    this.onShow(id);
  }
  hide() { this.current = null; this.stack = []; for (const s of this.screens) s.hidden = true; this.onShow(null); }
  back() { audio.play('back'); const prev = this.stack.pop() || 'scr-menu'; this.show(prev); }
  onShow(id) {
    clearInterval(this.browserTimer);
    if (id === 'scr-browser') { this.app.listRooms(); this.browserTimer = setInterval(() => this.app.listRooms(), 4000); }
    this.previewOn = id === 'scr-char';
    if (this.previewOn) this.startPreview();
    if (id === 'scr-settings') this.syncSettings();
    if (id === 'scr-join') { $('join-err').hidden = true; setTimeout(() => $('in-code').focus(), 50); }
  }
  toast(msg, bad = false) {
    const t = $('menu-toast'); t.textContent = msg; t.classList.toggle('bad', bad); t.classList.add('on');
    clearTimeout(this.toastT); this.toastT = setTimeout(() => t.classList.remove('on'), 2600);
    if (bad) audio.play('error');
  }
  setServer(kind, text) { const s = $('srv'); s.className = 'srv ' + kind; $('srv-text').textContent = text; ['b-quick', 'b-browser', 'b-create', 'b-join', 'b-join-go', 'b-create-go', 'b-join-b'].forEach((id) => { $(id).disabled = kind !== 'ok'; }); }
  showError(title, text, retry = true) { $('err-title').textContent = title; $('err-text').textContent = text; $('err-retry').hidden = !retry; this.show('scr-error'); }

  // ---- wiring ---------------------------------------------------------------
  bind() {
    const name = $('in-name'); name.value = settings.name;
    name.addEventListener('input', () => set('name', name.value.trim().slice(0, 16)));
    document.querySelectorAll('button').forEach((b) => b.addEventListener('mouseenter', () => audio.play('hover')));
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.back()));
    const click = (id, fn) => $(id).addEventListener('click', () => { audio.init(); audio.play('click'); fn(); });
    click('b-quick', () => this.app.quickPlay());
    click('b-browser', () => this.show('scr-browser', true));
    click('b-create', () => this.show('scr-create', true));
    click('b-join', () => this.show('scr-join', true));
    click('b-char', () => this.show('scr-char', true));
    click('b-settings', () => this.show('scr-settings', true));
    click('b-help', () => this.show('scr-help', true));
    click('b-refresh', () => this.app.listRooms());
    click('b-join-b', () => this.joinCode($('in-code-b').value));
    click('b-join-go', () => this.joinCode($('in-code').value));
    $('in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.joinCode($('in-code').value); });
    $('in-code-b').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.joinCode($('in-code-b').value); });
    $('c-max').addEventListener('input', () => { $('c-max-v').textContent = $('c-max').value; });
    click('b-create-go', () => this.app.createRoom({ name: $('c-name').value, max: +$('c-max').value, target: +$('c-target').value, priv: $('c-priv').checked }));
    click('p-resume', () => this.app.resume());
    click('p-settings', () => this.show('scr-settings', true));
    click('p-help', () => this.show('scr-help', true));
    click('p-leave', () => this.app.leave());
    click('err-retry', () => this.app.retryConnect());
    click('err-menu', () => this.app.toMenu());
    $('clickprompt').addEventListener('click', () => this.app.resume());
    // settings
    const bindRange = (id, key, fmtFn, after) => { const el = $(id); el.addEventListener('input', () => { set(key, +el.value); const v = $(id + '-v'); if (v) v.textContent = fmtFn(+el.value); after && after(); }); };
    bindRange('s-master', 'master', (v) => v, () => audio.applyVolumes());
    bindRange('s-music', 'music', (v) => v, () => audio.applyVolumes());
    bindRange('s-sfx', 'sfx', (v) => v, () => audio.applyVolumes());
    bindRange('s-sens', 'sens', (v) => v.toFixed(2));
    bindRange('s-fov', 'fov', (v) => v + '°', () => this.app.applySettings());
    $('s-shadows').addEventListener('change', (e) => { set('shadows', e.target.value); this.app.applySettings(); });
    $('s-invert').addEventListener('change', (e) => set('invertY', e.target.checked));
    $('s-fps').addEventListener('change', (e) => set('fps', e.target.checked));
    click('s-apply', () => {
      const v = $('s-server').value.trim();
      try { if (v) localStorage.setItem('tidefall.server', v); else localStorage.removeItem('tidefall.server'); } catch { /* ignore */ }
      $('s-note').textContent = 'Reconnecting...'; this.app.retryConnect();
    });
    this.buildSkinList();
  }

  syncSettings() {
    $('s-master').value = settings.master; $('s-music').value = settings.music; $('s-sfx').value = settings.sfx;
    $('s-sens').value = settings.sens; $('s-sens-v').textContent = settings.sens.toFixed(2);
    $('s-fov').value = settings.fov; $('s-fov-v').textContent = settings.fov + '°';
    $('s-shadows').value = settings.shadows; $('s-invert').checked = settings.invertY; $('s-fps').checked = settings.fps;
    let saved = ''; try { saved = localStorage.getItem('tidefall.server') || ''; } catch { /* ignore */ }
    $('s-server').value = saved; $('s-note').textContent = '';
  }

  joinCode(raw) {
    const code = String(raw || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) { const e = $('join-err'); e.hidden = false; e.textContent = 'Room codes are 4 letters/numbers.'; audio.play('error'); return; }
    this.app.joinCode(code);
  }

  // ---- room browser -------------------------------------------------------------
  renderRooms(rooms) {
    const body = $('room-rows'); body.innerHTML = '';
    $('room-empty').hidden = rooms.length > 0;
    for (const r of rooms) {
      const tr = document.createElement('tr'); const full = r.players >= r.max;
      tr.innerHTML = `<td>${esc(r.name)}</td><td class="mono">${r.code}</td><td class="mono">${r.players}/${r.max}</td><td class="mono">${r.target}</td><td class="mono">${r.phase === 'over' ? 'ending' : fmt(r.left)}</td><td class="num"><button ${full ? 'disabled' : ''}>${full ? 'Full' : 'Join'}</button></td>`;
      tr.querySelector('button').addEventListener('click', () => { audio.play('click'); this.app.joinCode(r.code); });
      body.appendChild(tr);
    }
  }

  // ---- results ---------------------------------------------------------------
  showOver(m, me) {
    $('over-title').textContent = m.winner === me ? 'Victory' : m.winner ? 'Match Over' : 'Match Over - no winner';
    $('over-rows').innerHTML = m.standings.map((r, i) => `<tr class="${r.id === me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}${r.id === m.winner ? ' &#9733;' : ''}</td><td class="mono">${r.score}</td><td class="mono">${r.kills}</td><td class="mono">${r.deaths}</td></tr>`).join('');
    let n = m.next; $('over-next').textContent = `Next match in ${n}s`;
    clearInterval(this.overT); this.overT = setInterval(() => { n--; $('over-next').textContent = n > 0 ? `Next match in ${n}s` : 'Starting...'; if (n <= -2) clearInterval(this.overT); }, 1000);
    this.stack = []; this.show('scr-over');
  }
  hideOver() { clearInterval(this.overT); if (this.current === 'scr-over') this.hide(); }

  // ---- character screen + 3D preview ---------------------------------------------
  buildSkinList() {
    const list = $('skin-list'); list.innerHTML = '';
    this.previewSkin = settings.skin; this.previewWeapon = 0;
    SKINS.forEach((s) => {
      const d = document.createElement('div'); d.className = 'skin-card'; d.dataset.id = s.id;
      d.addEventListener('click', () => this.pickSkin(s.id));
      list.appendChild(d);
    });
    const wrap = $('preview-weapons');
    WEAPONS.forEach((w) => { const b = document.createElement('button'); b.textContent = w.name; b.addEventListener('click', () => { audio.play('click'); this.previewWeapon = w.id; if (this.pchar) this.pchar.setWeapon(w.id); }); wrap.appendChild(b); });
    this.refreshSkinList();
  }
  refreshSkinList() {
    document.querySelectorAll('.skin-card').forEach((d) => {
      const s = SKINS[+d.dataset.id], open = unlocked(s.id);
      d.className = 'skin-card' + (settings.skin === s.id ? ' sel' : '') + (open ? '' : ' locked');
      d.innerHTML = `<div class="sw" style="background:${['#b7a77e', '#b4873a', '#d8b52c', '#c8553a', '#e7e8e4', '#2a3358'][s.id]}"></div><div><b>${s.name}</b><span class="st">${open ? (settings.skin === s.id ? 'Equipped' : 'Unlocked') : `Locked - bank ${s.unlock - settings.banked} more relic value`}</span></div>`;
    });
    const s = SKINS[this.previewSkin], open = unlocked(s.id);
    $('skin-name').textContent = s.name; $('skin-blurb').textContent = s.blurb;
    $('skin-req').textContent = open ? 'Select a skin to equip it. Your relics banked so far: ' + settings.banked : `Unlocks at ${s.unlock} lifetime relic value banked (you have ${settings.banked}).`;
  }
  pickSkin(id) {
    audio.play('click'); this.previewSkin = id; this.rebuildPreview();
    if (unlocked(id)) { set('skin', id); } else audio.play('error');
    this.refreshSkinList();
  }
  startPreview() {
    if (!this.pr) {
      const canvas = $('preview');
      this.pr = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      this.pr.outputColorSpace = THREE.SRGBColorSpace; this.pr.shadowMap.enabled = true;
      this.pscene = new THREE.Scene();
      this.pscene.add(new THREE.HemisphereLight(0xcfe3ec, 0x7c6a4c, 1.1));
      const sun = new THREE.DirectionalLight(0xffe0b0, 2.4); sun.position.set(-3, 5, 4); sun.castShadow = true; this.pscene.add(sun);
      const rim = new THREE.DirectionalLight(0x88b8c8, 0.8); rim.position.set(3, 2, -4); this.pscene.add(rim);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.14, 32), new THREE.MeshStandardMaterial({ color: 0x2b363c, roughness: 0.9 })); base.position.y = -0.07; base.receiveShadow = true; this.pscene.add(base);
      this.pcam = new THREE.PerspectiveCamera(32, 1, 0.1, 50); this.pcam.position.set(0, 1.35, 5.2); this.pcam.lookAt(0, 0.95, 0);
      this.pyaw = 0.5; this.drag = null;
      canvas.addEventListener('pointerdown', (e) => { this.drag = e.clientX; canvas.setPointerCapture(e.pointerId); });
      canvas.addEventListener('pointermove', (e) => { if (this.drag !== null) { this.pyaw += (e.clientX - this.drag) * 0.01; this.drag = e.clientX; } });
      canvas.addEventListener('pointerup', () => { this.drag = null; });
    }
    this.previewSkin = settings.skin; this.rebuildPreview(); this.refreshSkinList();
    let last = performance.now();
    const loop = (t) => {
      if (!this.previewOn) return;
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      const c = $('preview'), w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * devicePixelRatio || c.height !== h * devicePixelRatio) { this.pr.setPixelRatio(devicePixelRatio); this.pr.setSize(w, h, false); this.pcam.aspect = w / h; this.pcam.updateProjectionMatrix(); this.pcam.position.x = -w * 0.00045 * 0; }
      if (this.drag === null) this.pyaw += dt * 0.5;
      if (this.pchar) { this.pchar.root.rotation.y = this.pyaw; this.pchar.update(dt, { speed: 0 }); }
      this.pr.render(this.pscene, this.pcam);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  rebuildPreview() {
    if (this.pchar) { this.pscene.remove(this.pchar.root); this.pchar.dispose(); }
    this.pchar = new Character(this.previewSkin, this.previewWeapon);
    this.pchar.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.pscene.add(this.pchar.root);
    this.refreshSkinList();
  }
}
