// Integration test: boots the real server and drives it with bot clients over WebSocket.
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import * as W from '../public/shared/world.js';
import { WEAPONS, tideLevel } from '../public/shared/constants.js';

const PORT = 3999;
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, ROOM_EMPTY_TTL_MS: '2000' }, stdio: 'inherit' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

class Bot {
  constructor(name, skin = 0) { this.name = name; this.skin = skin; this.msgs = []; this.pos = { x: 0, y: 0, z: 0 }; this.epoch = 0; this.hp = 100; }
  async connect(resume) {
    this.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    this.ws.on('message', (d) => this.onMsg(JSON.parse(d.toString())));
    await new Promise((r) => this.ws.on('open', r));
    this.send({ t: 'hello', name: this.name, skin: this.skin, resume });
  }
  onMsg(m) {
    this.msgs.push(m);
    if (m.t === 'joined') { this.id = m.you; this.token = m.token; this.code = m.code; this.pos = { x: m.spawn.x, y: m.spawn.y, z: m.spawn.z }; this.epoch = m.spawn.e; this.joined = m; }
    if (m.t === 'spawn') { this.pos = { x: m.x, y: m.y, z: m.z }; this.epoch = m.e; }
    if (m.t === 'corr') { this.pos = { x: m.x, y: m.y, z: m.z }; this.corrs = (this.corrs || 0) + 1; }
    if (m.t === 'snap') { this.snap = m; this.rt = m.rt; }
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async wait(pred, ms = 3000) { const t = Date.now(); while (Date.now() - t < ms) { const f = this.msgs.find(pred); if (f) return f; await sleep(20); } return null; }
  clear() { this.msgs = []; }
  state() { this.send({ t: 's', x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: 0, pitch: 0, a: 1, e: this.epoch }); }
  async walkTo(x, z, speed = 8) {
    for (;;) {
      const dx = x - this.pos.x, dz = z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.3) break;
      const step = Math.min(d, speed * 0.05);
      this.pos.x += (dx / d) * step; this.pos.z += (dz / d) * step; this.pos.y = W.heightAt(this.pos.x, this.pos.z);
      this.state(); await sleep(50);
    }
  }
}

try {
  await sleep(800);
  const health = await (await fetch(`http://localhost:${PORT}/health`)).json();
  ok(health.ok === true, 'health endpoint responds');

  const A = new Bot('Alice', 1), B = new Bot('Bob', 3);
  await A.connect(); await A.wait((m) => m.t === 'welcome');
  A.send({ t: 'create', name: 'Test Crew', max: 3, target: 15, priv: false });
  const ja = await A.wait((m) => m.t === 'joined');
  ok(ja && /^[A-Z2-9]{4}$/.test(ja.code), 'room created with 4-char code ' + ja?.code);
  ok(ja.relics.length === W.RELIC_SITES.length, 'relics replicated on join (' + ja.relics.length + ')');

  const list = await (await fetch(`http://localhost:${PORT}/api/rooms`)).json();
  ok(list.rooms.length === 1 && list.rooms[0].players === 1, 'room appears in browser list');

  await B.connect(); await B.wait((m) => m.t === 'welcome');
  B.send({ t: 'join', code: 'ZZZZ' });
  ok(!!(await B.wait((m) => m.t === 'error' && m.code === 'notfound')), 'bad code rejected');
  B.send({ t: 'join', code: ja.code.toLowerCase() });
  const jb = await B.wait((m) => m.t === 'joined');
  ok(jb && jb.players.length === 2 && jb.players.find((p) => p.skin === 1), 'B joined by code (case-insensitive); sees A with skin');
  ok(!!(await A.wait((m) => m.t === 'pjoin' && m.p.name === 'Bob')), 'A notified of B joining');

  // third + fourth: capacity 3
  const C = new Bot('Cy'); await C.connect(); await C.wait((m) => m.t === 'welcome'); C.send({ t: 'join', code: ja.code });
  ok(!!(await C.wait((m) => m.t === 'joined')), 'third player fits (max 3)');
  const D = new Bot('Di'); await D.connect(); await D.wait((m) => m.t === 'welcome'); D.send({ t: 'join', code: ja.code });
  ok(!!(await D.wait((m) => m.t === 'error' && m.code === 'full')), 'fourth player rejected: room full');
  C.send({ t: 'leave' }); await C.wait((m) => m.t === 'left');
  ok(!!(await A.wait((m) => m.t === 'pleave')), 'leave broadcast');

  // movement validation: teleport must be rejected and corrected
  A.clear(); const before = { ...A.pos };
  A.pos.x += 60; A.state();
  ok(!!(await A.wait((m) => m.t === 'corr')), 'teleport cheat rejected with correction');
  ok(Math.hypot(A.pos.x - before.x, A.pos.z - before.z) < 1, 'authoritative position restored');

  // snapshot sync
  const snap = await B.wait((m) => m.t === 'snap');
  ok(snap && snap.p.length === 2 && typeof snap.rt === 'number', 'snapshots carry both players + room clock');

  // bring B next to A: walk B to A (they spawn apart)
  B.clear(); A.clear();
  console.log('walking B to A...');
  const target = { x: A.pos.x + 6, z: A.pos.z };
  await B.walkTo(target.x, target.z, 9.5);
  await sleep(200);
  ok((B.corrs || 0) === 0, 'legit walking never corrected (' + (B.corrs || 0) + ' corrections)');

  // harpoon A -> B
  A.send({ t: 'swap', w: 1 }); await sleep(450);
  const bEye = { x: B.pos.x, y: B.pos.y + 1.0, z: B.pos.z };
  const ay = A.pos.y + 1.55;
  let dir = [bEye.x - A.pos.x, bEye.y - ay, bEye.z - A.pos.z]; const L = Math.hypot(...dir); dir = dir.map((v) => v / L);
  // wait until spawn protection expires (fire ends own protection but B's still protected)
  await sleep(Math.max(0, 2700 - (Date.now() - A.joinedAt || 0)));
  await sleep(2600);
  A.clear(); B.clear();
  A.send({ t: 'fire', w: 1, d: dir });
  const hit1 = await B.wait((m) => m.t === 'ev' && m.e === 'hit');
  ok(hit1 && hit1.d >= 55 && hit1.a === A.id && hit1.v === B.id, 'harpoon hit registered by server: dmg ' + hit1?.d);
  A.send({ t: 'fire', w: 1, d: dir }); await sleep(300);
  ok(!A.msgs.some((m) => m.e === 'shot' && m.id === A.id && A.msgs.filter((x) => x.e === 'shot').length > 1), 'harpoon cannot fire again while reloading');

  // client claims wrong weapon -> ignored
  A.clear(); A.send({ t: 'fire', w: 2, d: dir }); await sleep(200);
  ok(!A.msgs.some((m) => m.e === 'shot'), 'fire with unequipped weapon ignored');

  // cutlass kill
  A.send({ t: 'swap', w: 0 }); await sleep(450);
  B.clear();
  let kill = null;
  for (let i = 0; i < 6 && !kill; i++) {
    // step adjacent to B to be in range
    await A.walkTo(B.pos.x - 1.6, B.pos.z, 6);
    const d2 = [B.pos.x - A.pos.x, 0, B.pos.z - A.pos.z];
    A.send({ t: 'fire', w: 0, d: d2 });
    await sleep(600);
    kill = B.msgs.find((m) => m.e === 'kill');
  }
  ok(!!kill && kill.k === A.id && kill.v === B.id, 'B killed by A via cutlass, kill event broadcast');
  const resp = await B.wait((m) => m.t === 'spawn', 6000);
  ok(!!resp, 'B respawned by server after delay');
  const board = (await A.wait((m) => m.t === 'snap' && m.b && m.b.find((r) => r[0] === A.id && r[2] >= 1), 3000));
  ok(!!board, 'scoreboard shows kill + death');

  // wet powder: can't fire blunderbuss while submerged. (teleport-free: just check dry fire works on land)
  A.send({ t: 'swap', w: 2 }); await sleep(450); A.clear();
  A.send({ t: 'fire', w: 2, d: [1, 0, 0] });
  const shot = await A.wait((m) => m.e === 'shot' || m.e === 'wet');
  ok(shot && shot.e === 'shot' && shot.e1.length === 8, 'blunderbuss fires 8 pellets on dry land');

  // reconnect resume
  const tok = B.token, code = B.code, bid = B.id;
  B.ws.close(); await sleep(300);
  const B2 = new Bot('Bob', 3); await B2.connect({ code, token: tok });
  const rj = await B2.wait((m) => m.t === 'joined');
  ok(rj && rj.you === bid, 'reconnect resumes same player id within grace window');

  // relic pickup & bank: walk to nearest pearl at low tide, then to bank
  const site = [...W.RELIC_SITES].filter((s) => s.kind === 'pearl').sort((a, b) => Math.hypot(a.x - W.BANK.x, a.z - W.BANK.z) - Math.hypot(b.x - W.BANK.x, b.z - W.BANK.z))[0];
  const E = new Bot('Eve'); await E.connect(); await E.wait((m) => m.t === 'welcome');
  E.send({ t: 'create', name: 'Relic Run', max: 4, target: 40 }); await E.wait((m) => m.t === 'joined');
  console.log('relic run to', site.name, 'dist to bank', Math.hypot(site.x - W.BANK.x, site.z - W.BANK.z).toFixed(0));
  await E.walkTo(site.x, site.z, 10);
  const pk = await E.wait((m) => m.e === 'pickup', 1500);
  ok(!!pk && pk.by === E.id, 'relic picked up at exposed site (level ' + tideLevel(E.rt || 0).toFixed(2) + ')');
  await E.walkTo(W.BANK.x, W.BANK.z + 2, 10);
  const bank = await E.wait((m) => m.e === 'bank', 2500);
  ok(!!bank && bank.v >= 1, 'relic banked at the beacon, score ' + bank?.score);

  // cleanup of empty rooms
  for (const b of [A, B2, E]) { b.send({ t: 'leave' }); }
  await sleep(7500);
  const list2 = await (await fetch(`http://localhost:${PORT}/health`)).json();
  ok(list2.rooms === 0, 'empty rooms cleaned up automatically');
} catch (e) { console.error(e); fails++; }
srv.kill();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
