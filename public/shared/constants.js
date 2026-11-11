// Shared between server (authoritative) and client (prediction / presentation).
// Pure data + pure math only. No DOM, no Node APIs.

export const VERSION = '1.0.0';
export const TICK_RATE = 20;               // server snapshots / sim ticks per second
export const SEND_RATE = 20;               // client state upload rate

export const WORLD = { size: 258, cell: 1.5, seaLimit: 116 };

// ---- Tide -----------------------------------------------------------------
// The tide is a pure function of room time, so every client derives the same
// water level from the server clock with no per-frame network traffic.
// DEEPFALL: the whole island chain is sunk. The "tide" is just the gentle swell of the
// surface; the sea level sits well above every peak so the world is a seabed to explore.
export const TIDE = { period: 150, mid: 26, amp: 0.25, phase: 0 };
export function tideLevel(rt) {
  return TIDE.mid + TIDE.amp * Math.sin((Math.PI * 2 * rt) / 20);
}
export function tideRising() { return true; }

// ---- Player ---------------------------------------------------------------
export const PLAYER = {
  radius: 0.45, height: 1.8, eye: 1.55,
  walk: 5.5, sprint: 9.0, jump: 0, gravity: 0,
  wadeMul: 1, swimMul: 1, carryMul: 0.07, maxCarry: 3,
  o2Max: 100, o2DrainPerSec: 1.4, o2RegenPerSec: 30, drownDps: 7,
  maxHp: 100, respawnMs: 4000, protectMs: 2500,
  regenDelayMs: 6000, regenPerSec: 5,
  dash: { speed: 16, ms: 300, cooldownMs: 2800, iframeMs: 260 },
  wadeDepth: 0.35, deepDepth: 1.0, wetDepth: 0.5,
  maxSlope: 1.05, step: 0.55,
};

// ---- Weapons --------------------------------------------------------------
export const WEAPONS = [
  { id: 0, key: 'cutlass', name: 'Dive Knife', type: 'melee', dmg: 30, range: 2.9, arcDot: 0.45,
    cooldown: 0.52, mag: 0, reload: 0, backstab: 1.5,
    desc: 'Fast cleave. Backstabs hit 1.5x.' },
  { id: 1, key: 'harpoon', name: 'Harpoon Gun', type: 'ray', dmg: 55, head: 1.5, range: 70,
    cooldown: 0.2, mag: 1, reload: 1.6,
    desc: 'Long range, one shot, slow reload. Hooks a loot carrier\'s salvage loose.' },
  { id: 2, key: 'blunderbuss', name: 'Burst Cannon', type: 'spread', dmg: 9, pellets: 8, spread: 0.085,
    range: 22, falloffStart: 8, minMul: 0.35, cooldown: 0.4, mag: 2, reload: 2.3, wet: false,
    desc: 'Devastating up close. Two charges, slow recharge.' },
];

// ---- Match ----------------------------------------------------------------
export const MATCH = {
  durationMs: 9 * 60 * 1000, overMs: 12000,
  targets: [15, 25, 40], defaultTarget: 25,
  maxPlayersLimit: 12, minPlayersLimit: 2, defaultMax: 8,
};

// ---- Cosmetics ------------------------------------------------------------
// unlock = lifetime relic value banked (stored locally; cosmetic only).
export const SKINS = [
  { id: 0, key: 'deckhand', name: 'Rookie Diver',      unlock: 0,  blurb: 'Striped wetsuit and a flat cap. Everyone starts somewhere.' },
  { id: 1, key: 'diver',    name: 'Brass Diver',       unlock: 4,  blurb: 'Riveted helmet and air tank. Heavy boots, steady stance.' },
  { id: 2, key: 'keeper',   name: 'Lantern Scout',       unlock: 10, blurb: 'Oilskin slicker, grey beard and a lantern that never dies.' },
  { id: 3, key: 'hermit',   name: 'Shellback',         unlock: 18, blurb: 'A spiral shell, a borrowed claw, and a bad attitude.' },
  { id: 4, key: 'gull',     name: 'Manta Wanderer',     unlock: 30, blurb: 'Beaked mask and a pale cloak that ripples like a ray.' },
  { id: 5, key: 'captain',  name: 'Admiral Marrow',    unlock: 45, blurb: 'Tricorn, long coat, gold buttons. Drowned once, never stopped.' },
];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
