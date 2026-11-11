// Room registry: create / find / list / sweep empty rooms.
import { MATCH, clamp } from '../public/shared/constants.js';
import { Room } from './room.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_ROOMS = 60;
const EMPTY_TTL_MS = Number(process.env.ROOM_EMPTY_TTL_MS) || 20000;

export function cleanText(s, max, fallback) {
  const v = String(s ?? '').replace(/[^\p{L}\p{N} _\-'.!]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return v || fallback;
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.sweeper = setInterval(() => this.sweep(), 5000);
  }
  makeCode() {
    for (let tries = 0; tries < 50; tries++) {
      let c = ''; for (let i = 0; i < 4; i++) c += ALPHABET[(Math.random() * ALPHABET.length) | 0];
      if (!this.rooms.has(c)) return c;
    }
    throw new Error('code space exhausted');
  }
  create(opts = {}) {
    if (this.rooms.size >= MAX_ROOMS) return null;
    const target = MATCH.targets.includes(opts.target | 0) ? opts.target | 0 : MATCH.defaultTarget;
    const room = new Room(this.makeCode(), {
      name: cleanText(opts.name, 24, 'Salvage Crew'),
      max: clamp(opts.max | 0 || MATCH.defaultMax, MATCH.minPlayersLimit, MATCH.maxPlayersLimit),
      target, priv: !!opts.priv,
    });
    this.rooms.set(room.code, room);
    return room;
  }
  get(code) { return this.rooms.get(String(code || '').toUpperCase().trim()); }
  list() { return [...this.rooms.values()].filter((r) => !r.priv).map((r) => r.summary()).sort((a, b) => b.players - a.players); }
  quick() {
    const open = [...this.rooms.values()].filter((r) => !r.priv && r.connectedCount < r.max && r.phase === 'play');
    open.sort((a, b) => b.connectedCount - a.connectedCount);
    return open[0] || this.create({ name: 'Quick Match' });
  }
  stats() { let players = 0; for (const r of this.rooms.values()) players += r.connectedCount; return { rooms: this.rooms.size, players }; }
  sweep() {
    const t = Date.now();
    for (const [code, r] of this.rooms) {
      if (r.players.size === 0 && t - r.emptySince > EMPTY_TTL_MS) { r.destroy(); this.rooms.delete(code); }
    }
  }
  shutdown() { clearInterval(this.sweeper); for (const r of this.rooms.values()) r.destroy(); this.rooms.clear(); }
}
