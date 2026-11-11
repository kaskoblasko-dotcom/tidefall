// Headless smoke test: runs the real client (with a stubbed three.js) against the real server.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright';
import WebSocket from 'ws';

const PORT = 3998, URL = `http://localhost:${PORT}/`;
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT }, stdio: 'inherit' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const shots = process.env.SHOTS || '/tmp/claude-0/-home-claude/d2674a13-1df6-5281-a970-e1bc748d38ae/scratchpad';
const errors = [];
try {
  await sleep(800);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.route('**/vendor/three.module.js', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync('test/stub/three.module.js') }));
  const t0 = Date.now();
  await page.goto(URL);
  await page.waitForSelector('#scr-menu:not([hidden])', { timeout: 120000 });
  console.log('boot ms', Date.now() - t0);
  ok(true, 'client booted to main menu');
  await page.waitForFunction(() => document.getElementById('srv').classList.contains('ok'), null, { timeout: 15000 });
  ok(true, 'menu shows server online');
  await page.screenshot({ path: shots + '/s-menu.png' });

  await page.click('#b-char'); await sleep(300);
  ok(await page.locator('.skin-card').count() === 6, 'character screen lists 6 skins');
  await page.click('.skin-card[data-id="1"]'); await sleep(100);
  ok((await page.getAttribute('.skin-card[data-id="0"]', 'class')).includes('sel') && !(await page.getAttribute('.skin-card[data-id="1"]', 'class')).includes('sel'), 'locked skin cannot be equipped');
  await page.screenshot({ path: shots + '/s-char.png' });
  await page.click('#scr-char [data-close]');
  await page.click('#b-settings'); await sleep(150); await page.fill('#s-sens', '1.5'); await page.screenshot({ path: shots + '/s-settings.png' }); await page.click('#scr-settings [data-close]');
  await page.click('#b-help'); await sleep(100); await page.screenshot({ path: shots + '/s-help.png' }); await page.click('#scr-help [data-close]');
  await page.fill('#in-name', 'Tester');

  await page.click('#b-create'); await sleep(100); await page.fill('#c-name', 'Smoke Room'); await page.screenshot({ path: shots + '/s-create.png' });
  await page.click('#b-create-go');
  await page.waitForSelector('#hud:not([hidden])', { timeout: 10000 });
  ok(true, 'created room and entered game HUD');
  const code = await page.textContent('#h-code');
  ok(/^[A-Z0-9]{4}$/.test(code), 'room code in HUD: ' + code);
  ok((await page.textContent('#h-room')) === 'Smoke Room', 'room name in HUD');
  await sleep(1200);

  // second (bot) client joins the same room and attacks the page player
  const bot = { msgs: [], pos: null, epoch: 0 };
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`); bot.ws = ws;
  const send = (o) => ws.send(JSON.stringify(o));
  ws.on('message', (d) => { const m = JSON.parse(d); bot.msgs.push(m); if (m.t === 'joined') { bot.id = m.you; bot.pos = { ...m.spawn }; bot.epoch = m.spawn.e; } if (m.t === 'spawn') { bot.pos = { x: m.x, y: m.y, z: m.z }; bot.epoch = m.e; } });
  await new Promise((r) => ws.on('open', r));
  send({ t: 'hello', name: 'BotBob', skin: 2 }); await sleep(300); send({ t: 'join', code }); await sleep(500);
  ok(bot.id > 0, 'bot joined the room the page created');
  await page.waitForFunction(() => window.__tidefall.remotes.map.size === 1, null, { timeout: 5000 });
  ok(true, 'page sees the bot as a remote player');
  const me = await page.evaluate(() => ({ x: window.__tidefall.player.x, y: window.__tidefall.player.y, z: window.__tidefall.player.z }));
  // walk bot next to the page player and harpoon them
  const W = await import('./../public/shared/world.js');
  for (let i = 0; i < 1500; i++) {
    const dx = me.x + 8 - bot.pos.x, dz = me.z - bot.pos.z, d = Math.hypot(dx, dz); if (d < 0.4) break;
    const st = Math.min(d, 0.5); bot.pos.x += dx / d * st; bot.pos.z += dz / d * st; bot.pos.y = W.heightAt(bot.pos.x, bot.pos.z);
    send({ t: 's', x: bot.pos.x, y: bot.pos.y, z: bot.pos.z, yaw: 0, pitch: 0, a: 1, e: bot.epoch }); await sleep(50);
  }
  await sleep(3000); send({ t: 'swap', w: 1 }); await sleep(500);
  const dir = [me.x - bot.pos.x, me.y + 1 - (bot.pos.y + 1.55), me.z - bot.pos.z]; const L = Math.hypot(...dir);
  send({ t: 'fire', w: 1, d: dir.map((v) => v / L) });
  await page.waitForFunction(() => window.__tidefall.hp < 100, null, { timeout: 4000 }).catch(() => {});
  const hp = await page.evaluate(() => window.__tidefall.hp);
  ok(hp <= 45, 'page player took server-authoritative harpoon damage (hp ' + hp + ')');
  await sleep(300);
  await page.screenshot({ path: shots + '/s-hud.png' });
  await page.keyboard.down('Tab'); await sleep(150); ok(await page.locator('#scoreboard').isVisible(), 'Tab shows scoreboard'); await page.screenshot({ path: shots + '/s-score.png' }); await page.keyboard.up('Tab');
  ok((await page.locator('#weapons .wslot').count()) === 4, 'weapon + dash slots rendered');

  // pause menu / leave
  await page.evaluate(() => { document.exitPointerLock(); window.__tidefall.onLock(false); }); await sleep(250);
  ok(await page.locator('#scr-pause').isVisible(), 'pause menu opens when pointer lock is lost');
  await page.screenshot({ path: shots + '/s-pause.png' });
  await page.click('#p-leave'); await page.waitForSelector('#scr-menu:not([hidden])', { timeout: 5000 });
  ok(true, 'leave room returns to menu');
  await page.click('#b-browser'); await sleep(600);
  ok(await page.locator('#room-rows tr').count() >= 1, 'room browser lists the room');
  await page.screenshot({ path: shots + '/s-browser.png' });
  ok(errors.length === 0, 'no page/console errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  await browser.close();
} catch (e) { console.error(e); fails++; console.log(errors.slice(0, 8)); }
srv.kill(); console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
