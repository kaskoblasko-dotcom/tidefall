// Shared between server (authoritative) and client (prediction / presentation).
// Pure data + pure math only. No DOM, no Node APIs.

export const VERSION = '1.0.0';
export const TICK_RATE = 20;               // server snapshots / sim ticks per second
export const SEND_RATE = 20;               // client state upload rate

export const WORLD = { size: 258, cell: 1.5, seaLimit: 116 };

// ---- Tide -----------------------------------------------------------------
// The tide is a pure function of room time, so every client derives the same
// water level from the server clock with no per-frame network traffic.
export const TIDE = { period: 150, mid: 1.2, amp: 2.4, phase: -1.0 };
export function tideLevel(rt) {
  return TIDE.mid + TIDE.amp * Math.sin((Math.PI * 2 * rt) / TIDE.period + TIDE.phase);
}
export function tideRising(rt) {
  return Math.cos((Math.PI * 2 * rt) / TIDE.period + TIDE.phase) > 0;
}

// ---- Player ---------------------------------------------------------------
export const PLAYER = {
  radius: 0.45, height: 1.8, eye: 1.55,
  walk: 5.0, sprint: 8.0, jump: 7.6, gravity: 24,
  wadeMul: 0.78, swimMul: 0.5, carryMul: 0.07, maxCarry: 3,
  maxHp: 100, respawnMs: 4000, protectMs: 2500,
  regenDelayMs: 6000, regenPerSec: 5,
  dash: { speed: 19, ms: 260, cooldownMs: 2800, iframeMs: 240 },
  wadeDepth: 0.35, deepDepth: 1.0, wetDepth: 0.5,
  maxSlope: 1.05, step: 0.55,
};

// ---- Weapons --------------------------------------------------------------
export const WEAPONS = [
  { id: 0, key: 'cutlass', name: 'Cutlass', type: 'melee', dmg: 30, range: 2.9, arcDot: 0.45,
    cooldown: 0.52, mag: 0, reload: 0, backstab: 1.5,
    desc: 'Fast cleave. Backstabs hit 1.5x. Works in any water.' },
  { id: 1, key: 'harpoon', name: 'Harpoon Gun', type: 'ray', dmg: 55, head: 1.5, range: 85,
    cooldown: 0.2, mag: 1, reload: 1.6,
    desc: 'Long range, one shot, slow reload. Hooks a loot carrier\'s relic loose.' },
  { id: 2, key: 'blunderbuss', name: 'Blunderbuss', type: 'spread', dmg: 9, pellets: 8, spread: 0.085,
    range: 26, falloffStart: 9, minMul: 0.35, cooldown: 0.4, mag: 2, reload: 2.3, wet: true,
    desc: 'Devastating up close. Two shells. Powder soaks in deep water.' },
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
  { id: 0, key: 'deckhand', name: 'Deckhand',          unlock: 0,  blurb: 'Striped jersey, flat cap. Everyone starts somewhere.' },
  { id: 1, key: 'diver',    name: 'Brass Diver',       unlock: 4,  blurb: 'Riveted helmet and air tank. Heavy boots, steady stance.' },
  { id: 2, key: 'keeper',   name: 'Lamp Keeper',       unlock: 10, blurb: 'Oilskin slicker, grey beard and a lantern that never dies.' },
  { id: 3, key: 'hermit',   name: 'Shellback',         unlock: 18, blurb: 'A spiral shell, a borrowed claw, and a bad attitude.' },
  { id: 4, key: 'gull',     name: 'Gull Wanderer',     unlock: 30, blurb: 'Beaked mask and white feather cloak. Never seen on land.' },
  { id: 5, key: 'captain',  name: 'Captain Marrow',    unlock: 45, blurb: 'Tricorn, long coat, gold buttons. Owes everyone money.' },
];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
