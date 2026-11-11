// Unit check: swimming state is accepted by the server and tears loot away.
import { Room } from '../server/room.js';
import * as W from '../public/shared/world.js';
import { tideLevel, PLAYER } from '../public/shared/constants.js';
const sent = [];
const conn = { ws: { readyState: 1, send: (s) => sent.push(JSON.parse(s)) }, name: 'S', skin: 0, token: 'x' };
const room = new Room('TEST', { name: 't', max: 4, target: 25 });
const p = room.addPlayer(conn);
p.protectUntil = 0;
// find a deep-water spot
let spot; for (let x = -110; x < 110 && !spot; x += 2) { const y = W.heightAt(x, 60); if (y < -3 && Math.hypot(x, 60) < 110) spot = { x, z: 60 }; }
const lvl = room.level;
p.x = spot.x - 1; p.z = spot.z; p.y = lvl - 1.1; p.lastState = Date.now() - 100; p.allow = 5;
room.onState(p, { x: spot.x, y: lvl - 1.1, z: spot.z, yaw: 0, pitch: 0, a: 4, e: p.epoch });
console.log('swim state accepted:', Math.abs(p.x - spot.x) < 0.01, 'level', lvl.toFixed(2), 'deep?', room.isDeep(p));
p.carried = [1]; room.relics[0].state = 'carried'; room.relics[0].carrier = p.id;
room.tickRelics(Date.now(), lvl);
console.log('loot dropped in deep water:', p.carried.length === 0, 'relic state', room.relics[0].state);
room.destroy(); process.exit(p.x === spot.x && p.carried.length === 0 ? 0 : 1);
