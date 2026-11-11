// In-game HUD: DOM overlay + minimap.
import * as W from '../shared/world.js';
import { WEAPONS, PLAYER, TIDE, clamp } from '../shared/constants.js';

const $ = (id) => document.getElementById(id);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export { fmt, esc };

export class Hud {
  constructor() {
    this.el = { hud: $('hud'), room: $('h-room'), code: $('h-code'), target: $('h-target'), time: $('h-time'), o2fill: $('o2-fill'), o2n: $('o2-n'), depth: $('depth-n'), o2box: $('o2'),
      hp: $('hp-fill'), hpn: $('hp-num'), carry: $('carry'), weapons: $('weapons'), feed: $('feed'), lb: $('lb'), sb: $('scoreboard'), hit: $('hitmarker'), vig: $('vignette'), dir: $('dmgdir'), toast: $('toast'), center: $('centermsg'), fps: $('fps'), banner: $('netbanner'), death: $('death') };
    this.slots = WEAPONS.map((w, i) => { const d = document.createElement('div'); d.className = 'wslot'; d.innerHTML = `<span class="k">${i + 1}</span><div class="n">${w.name}</div><div class="a"></div><div class="rl"></div>`; this.el.weapons.appendChild(d); return d; });
    this.dash = document.createElement('div'); this.dash.className = 'wslot'; this.dash.innerHTML = '<span class="k">Q</span><div class="n">Dash</div><div class="a">ready</div><div class="rl"></div>'; this.el.weapons.appendChild(this.dash);
    this.mm = $('minimap'); this.mctx = this.mm.getContext('2d'); this.base = document.createElement('canvas'); this.base.width = this.base.height = 168; this.baseLevel = 99; this.baseT = 0;
    this.toastT = 0; this.centerT = 0; this.hitT = 0; this.vigT = 0; this.lastHp = 100; this.cur = -1;
  }
  show(v) { this.el.hud.hidden = !v; }
  setRoom(name, code, target) { this.el.room.textContent = name; this.el.code.textContent = code; this.el.target.textContent = `First to ${target}`; }
  setTime(s) { this.el.time.textContent = fmt(s); this.el.time.style.color = s < 30 ? 'var(--bad)' : ''; }
  setDive(depth, o2) {
    const f = clamp(o2 / PLAYER.o2Max, 0, 1);
    this.el.o2fill.style.width = `${f * 100}%`;
    this.el.o2fill.style.background = f > 0.5 ? 'var(--teal)' : f > 0.25 ? 'var(--warn)' : 'var(--bad)';
    this.el.o2n.textContent = Math.round(o2);
    this.el.depth.textContent = `${Math.max(0, Math.round(depth))} m`;
    this.el.o2box.classList.toggle('low', f < 0.25);
  }
  setHp(hp) {
    const f = clamp(hp / PLAYER.maxHp, 0, 1);
    this.el.hp.style.width = `${f * 100}%`; this.el.hp.style.background = f > 0.5 ? 'var(--good)' : f > 0.25 ? 'var(--warn)' : 'var(--bad)';
    this.el.hpn.textContent = Math.max(0, Math.round(hp));
    this.el.vig.classList.toggle('low', f < 0.3 && hp > 0);
  }
  setCarry(kinds) {
    const col = { pearl: '#f0f4f8', idol: '#e8b838', deep: '#4a8ee0', crown: '#ffd24a' };
    this.el.carry.innerHTML = '';
    for (let i = 0; i < PLAYER.maxCarry; i++) { const d = document.createElement('i'); if (kinds[i]) { d.className = 'on'; d.style.background = col[kinds[i]]; } this.el.carry.appendChild(d); }
  }
  setWeapons(cur, ammo, reloadLeft, reloadTotal, dashCd) {
    WEAPONS.forEach((w, i) => {
      const s = this.slots[i]; s.classList.toggle('sel', i === cur);
      s.querySelector('.a').textContent = w.mag ? (reloadLeft[i] > 0 ? 'reloading' : `${ammo[i]} / ${w.mag}`) : 'infinite';
      s.querySelector('.rl').style.width = w.mag && reloadLeft[i] > 0 ? `${(1 - reloadLeft[i] / (w.reload * 1000)) * 100}%` : '0';
    });
    this.dash.querySelector('.a').textContent = dashCd > 0 ? `${dashCd.toFixed(1)}s` : 'ready';
    this.dash.querySelector('.rl').style.width = dashCd > 0 ? `${(1 - dashCd / (PLAYER.dash.cooldownMs / 1000)) * 100}%` : '0';
  }
  feed(html) { const d = document.createElement('div'); d.innerHTML = html; this.el.feed.appendChild(d); setTimeout(() => d.remove(), 6000); while (this.el.feed.children.length > 6) this.el.feed.firstChild.remove(); }
  leaderboard(rows, me) {
    this.el.lb.innerHTML = rows.slice(0, 5).map((r, i) => `<div class="r ${r.id === me ? 'me' : ''}"><span class="muted mono">${i + 1}</span><span>${esc(r.name)}</span><span class="mono">${r.score}</span></div>`).join('') || '<span class="muted">No players</span>';
  }
  scoreboard(rows, me, visible) {
    this.el.sb.hidden = !visible; if (!visible) return;
    this.el.sb.innerHTML = `<table class="tbl" style="margin:0"><thead><tr><th>#</th><th>Player</th><th class="num">Banked</th><th class="num">Kills</th><th class="num">Deaths</th><th class="num">Ping</th></tr></thead><tbody>${rows.map((r, i) => `<tr class="${r.id === me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}${r.carry ? ` <span class="muted">(carrying ${r.carry})</span>` : ''}</td><td class="num mono">${r.score}</td><td class="num mono">${r.kills}</td><td class="num mono">${r.deaths}</td><td class="num mono">${r.id === me ? r.ping : ''}</td></tr>`).join('')}</tbody></table>`;
  }
  hitmarker(kill) { const h = this.el.hit; h.classList.add('on'); h.style.filter = kill ? 'drop-shadow(0 0 2px #f44) sepia(1) saturate(8) hue-rotate(-30deg)' : ''; clearTimeout(this.hitT); this.hitT = setTimeout(() => h.classList.remove('on'), 90); }
  hurt(angle) {
    this.el.vig.classList.add('hurt'); clearTimeout(this.vigT); this.vigT = setTimeout(() => this.el.vig.classList.remove('hurt'), 120);
    if (angle !== null) { const i = document.createElement('i'); i.style.transform = `rotate(${angle}rad)`; this.el.dir.appendChild(i); setTimeout(() => { i.style.opacity = 0; }, 50); setTimeout(() => i.remove(), 700); }
  }
  toast(msg) { const t = this.el.toast; t.textContent = msg; t.classList.add('on'); clearTimeout(this.toastT); this.toastT = setTimeout(() => t.classList.remove('on'), 2200); }
  center(msg, ms = 1800) { const t = this.el.center; t.textContent = msg; t.classList.add('on'); clearTimeout(this.centerT); this.centerT = setTimeout(() => t.classList.remove('on'), ms); }
  banner(msg) { this.el.banner.hidden = !msg; if (msg) this.el.banner.textContent = msg; }
  death(show, by, secs) { this.el.death.hidden = !show; if (show) { $('death-by').textContent = by; $('death-timer').textContent = secs > 0 ? `Respawn in ${Math.ceil(secs)}` : 'Respawning...'; } }

  // ---- minimap ----------------------------------------------------------------
  bakeMap(level) {
    const ctx = this.base.getContext('2d'), img = ctx.createImageData(168, 168), d = img.data, S = W.GRID.N * W.GRID.CELL;
    for (let j = 0; j < 168; j++) for (let i = 0; i < 168; i++) {
      const x = (i / 168) * 232 - 116, z = (j / 168) * 232 - 116, y = W.heightAt(x, z);
      let c;
      if (y < level) { const k = clamp((level - y) / 30, 0, 1); c = [60 - 50 * k, 140 - 100 * k, 150 - 80 * k]; }
      else if (y < 1.6) c = [150, 132, 98]; else if (y < 4.3) c = [206, 186, 138]; else if (y < 9) c = [104, 134, 76]; else if (y < 14) c = [92, 98, 86]; else c = [62, 64, 70];
      const o = (j * 168 + i) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0); this.baseLevel = level;
  }
  minimap(level, me, others, relics, now) {
    if (Math.abs(level - this.baseLevel) > 0.08 && now - this.baseT > 0.5) { this.bakeMap(level); this.baseT = now; }
    const c = this.mctx, m = (x) => ((x + 116) / 232) * 168;
    c.drawImage(this.base, 0, 0);
    c.fillStyle = '#ffc060'; c.fillRect(m(W.BANK.x) - 4, m(W.BANK.z) - 4, 8, 8); c.strokeStyle = '#000'; c.strokeRect(m(W.BANK.x) - 4, m(W.BANK.z) - 4, 8, 8);
    for (const r of relics) if (r.st === 0) { const exp = true; c.beginPath(); c.arc(m(r.x), m(r.z), exp ? 3 : 2.5, 0, 7); if (exp) { c.fillStyle = '#fff'; c.fill(); } c.strokeStyle = exp ? '#000' : '#fff9'; c.stroke(); }
    c.fillStyle = '#e5533a';
    for (const o of others) if (o.alive && Math.hypot(o.x - me.x, o.z - me.z) < 45) { c.beginPath(); c.arc(m(o.x), m(o.z), 3, 0, 7); c.fill(); }
    c.save(); c.translate(m(me.x), m(me.z)); c.rotate(-me.yaw); c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.beginPath(); c.moveTo(0, -6); c.lineTo(4.5, 5); c.lineTo(0, 2.5); c.lineTo(-4.5, 5); c.closePath(); c.fill(); c.stroke(); c.restore();
  }
}
