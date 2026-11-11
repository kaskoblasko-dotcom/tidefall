// DEEPFALL game server: Express (static files + health + room list) and a
// WebSocket endpoint (/ws) for all realtime gameplay. Deploy as a Render Web Service.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager, cleanText } from './server/rooms.js';
import { SKINS, VERSION } from './public/shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const manager = new RoomManager();
const started = Date.now();

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); next(); }); // lets a separately hosted frontend poll /api/rooms
app.get('/health', (req, res) => res.json({ ok: true, version: VERSION, uptime: Math.round((Date.now() - started) / 1000), ...manager.stats() }));
app.get('/api/rooms', (req, res) => res.json({ rooms: manager.list() }));
app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: '5m' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
let nextConn = 1;

function send(conn, obj) { if (conn.ws.readyState === 1) conn.ws.send(JSON.stringify(obj)); }
function err(conn, message, code = 'error') { send(conn, { t: 'error', code, m: message }); }

function leave(conn) {
  if (conn.player && conn.room) conn.room.removePlayer(conn.player);
  conn.player = null; conn.room = null;
}

function enter(conn, room) {
  if (!room) return err(conn, 'The server is at capacity. Try again shortly.', 'full');
  leave(conn);
  if (!room.addPlayer(conn)) err(conn, 'That room is full.', 'full');
}

function onMessage(conn, m) {
  switch (m.t) {
    case 'hello': {
      conn.name = cleanText(m.name, 16, 'Salvager');
      conn.skin = Number.isInteger(m.skin) && m.skin >= 0 && m.skin < SKINS.length ? m.skin : 0;
      send(conn, { t: 'welcome', id: conn.id, v: VERSION, rooms: manager.list() });
      if (m.resume && typeof m.resume.token === 'string') {
        const room = manager.get(m.resume.code);
        const p = room && [...room.players.values()].find((q) => q.token === m.resume.token && !q.connected);
        if (p) { conn.token = p.token; room.resume(conn, p); } else send(conn, { t: 'resumeFailed' });
      }
      return;
    }
    case 'list': return send(conn, { t: 'rooms', rooms: manager.list() });
    case 'create': return enter(conn, manager.create({ name: m.name, max: m.max, target: m.target, priv: m.priv }));
    case 'join': {
      const room = manager.get(m.code);
      if (!room) return err(conn, `No room with code ${String(m.code || '').toUpperCase().slice(0, 6)}.`, 'notfound');
      return enter(conn, room);
    }
    case 'quick': return enter(conn, manager.quick());
    case 'leave': leave(conn); return send(conn, { t: 'left' });
    case 'profile':
      conn.name = cleanText(m.name, 16, conn.name);
      if (Number.isInteger(m.skin) && m.skin >= 0 && m.skin < SKINS.length) conn.skin = m.skin;
      return undefined;
    default:
      if (conn.player && conn.room) conn.room.handle(conn.player, m);
  }
}

wss.on('connection', (ws) => {
  const conn = { id: nextConn++, ws, name: 'Salvager', skin: 0, token: crypto.randomBytes(12).toString('hex'), player: null, room: null, alive: true, count: 0, windowAt: Date.now() };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    const now = Date.now();
    if (now - conn.windowAt > 1000) { conn.windowAt = now; conn.count = 0; }
    if (++conn.count > 400) return ws.close(1008, 'rate limit');
    if (conn.count > 120) return; // drop excess silently
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    try { onMessage(conn, m); } catch (e) { console.error('message error', e); }
  });
  ws.on('close', () => {
    if (conn.player && conn.room) conn.room.disconnect(conn.player); // keep slot for reconnect
    conn.player = null; conn.room = null;
  });
  ws.on('error', () => {});
});

// Heartbeat: terminates dead sockets and keeps Render's proxy from idling connections out.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 25000);

server.listen(PORT, '0.0.0.0', () => console.log(`DEEPFALL server v${VERSION} listening on :${PORT}`));

function shutdown() {
  console.log('shutting down');
  clearInterval(heartbeat); manager.shutdown();
  wss.close(); server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
