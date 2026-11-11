# TIDEFALL

A tidal salvage brawl for 2-12 players, in the browser. Three.js client, Node + Express + WebSocket (`ws`) authoritative server.

**The hook:** the tide is a shared, server-clocked cycle (~2.5 min). Low tide exposes wrecks, pearls and causeways. High tide floods the flats, slows you, makes deep water tear carried loot away, and soaks blunderbuss powder. Grab relics, climb to the lighthouse Beacon, bank them. First to the score target wins.

## Run locally

```bash
npm install        # installs express, ws, three; postinstall copies three.module.js to public/vendor
npm start          # http://localhost:3000
```
Open two browser tabs, create a room in one, join by code in the other. `npm test` runs the server integration tests (bots over WebSocket).

## Deploy to Render (Web Service)

1. Push this folder to a GitHub repo.
2. Render dashboard -> **New + -> Web Service** (or **Blueprint** to use `render.yaml`).
3. Settings: Runtime **Node**, Build Command `npm install`, Start Command `npm start`, Health Check Path `/health`. (Server binds to `process.env.PORT`.)
4. Deploy. Your game is at `https://<service>.onrender.com`. That one service serves the client *and* the WebSocket (`/ws`), so the client connects to the deployed server automatically (same origin, `wss://`).

Free instances sleep when idle; the first connection can take ~30-60 s. The client shows "Connecting..." and retries automatically.

### Hosting the frontend separately (optional)
Serve `public/` from any static host (run `npm install` first so `public/vendor/three.module.js` exists), then point it at your Render service by either:
- editing `DEPLOYED_SERVER_URL` in `public/js/config.js` (e.g. `'https://tidefall.onrender.com'`), or
- opening the page with `?server=https://tidefall.onrender.com`, or
- Settings -> **Server URL** in the game (stored in localStorage).

## Controls
| | |
|---|---|
| W A S D / Mouse | Move / aim |
| Shift / Space | Sprint / jump |
| Left click | Attack |
| 1 2 3 / wheel | Cutlass / Harpoon Gun / Blunderbuss |
| R | Reload (blunderbuss) |
| Q | Dash (brief invulnerability, 2.8 s cooldown) |
| Tab / Esc | Scoreboard / pause menu |

## Gameplay
- **Relics** (pearls 1, idols 2, deep pearls 3, Gull Crown 4) sit at wrecks and flats; only *exposed* relics can be picked up. Carry up to 3 (each slows you 7%). Walk into the Beacon ring on the lighthouse plateau to bank.
- **Death** drops your loot where you fall. **Harpoon** hits hook a relic loose from a carrier. **Deep water** (swimming) tears loot away; sunk relics return to their wreck.
- **Weapons:** Cutlass 30 dmg cleave, backstab x1.5, works in water. Harpoon 55 dmg (headshot x1.5), 85 m, 1 shot then 1.6 s reload. Blunderbuss 8x9 dmg pellets, 26 m with falloff, 2 shells, 2.3 s reload, **disabled when wet**.
- **Skins** (6 distinct models) unlock by lifetime relic value banked (stored in localStorage; cosmetic only).
- Match: 9 minutes or first to 15 / 25 / 40; results screen, then auto-restart.

## Architecture
```
server.js            Express (static, /health, /api/rooms) + WebSocket /ws, heartbeat, rate limiting
server/rooms.js      room registry, 4-char codes, cleanup of empty rooms, sanitising
server/room.js       authoritative match: tide clock, movement validation, combat, relics, scoring, respawn
public/shared/       constants + deterministic world (terrain, colliders, relic sites) used by BOTH sides
public/js/           client: game loop, terrain bake, props, characters, HUD, UI, audio, net
```
**Netcode:** clients upload position at 20 Hz; the server validates speed (token bucket), height, bounds and corrects cheaters (`corr`). Health, ammo, cooldowns, hit detection (ray/cone vs. server positions + terrain/collider line of sight), damage, relics, scores, tide and respawns are all server-side. Snapshots at 20 Hz; remote players interpolated 110 ms behind. Dropped sockets keep their slot for 25 s and resume with a token. Everything is validated and rate-limited (4 KB messages, 120 msg/s).

Known simplifications: no lag-compensated hit rewind (shots use current server positions); movement is client-simulated with server validation rather than full server simulation; skin unlocks are client-side.

## Tests
`npm test` - integration (rooms, join/full/leave, movement validation, harpoon/cutlass/blunderbuss, respawn, reconnect, relic pickup + banking, room cleanup) and swim/loot logic. `test/ui-smoke.mjs` drives the real client in headless Chromium against the server (needs Playwright; uses `test/stub/` in place of Three.js).
"# tidefall" 
