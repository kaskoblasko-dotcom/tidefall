// Persistent settings + profile (name, selected skin, lifetime relics banked -> skin unlocks).
import { SKINS } from '../shared/constants.js';

const KEY = 'tidefall.v1';
const DEFAULTS = { name: '', skin: 0, master: 0.8, music: 0.45, sfx: 0.8, sens: 1, invertY: false, fov: 75, shadows: 'high', fps: false, banked: 0 };
let data = { ...DEFAULTS };
try { Object.assign(data, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* storage unavailable */ }
const listeners = new Set();

export const settings = data;
export function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore */ } listeners.forEach((f) => f(data)); }
export function onSettings(f) { listeners.add(f); }
export function set(k, v) { data[k] = v; save(); }
export function unlocked(id) { return data.banked >= SKINS[id].unlock; }
export function addBanked(n) {
  const before = SKINS.filter((s) => data.banked >= s.unlock).length;
  data.banked += n; save();
  return SKINS.filter((s) => data.banked >= s.unlock).length > before ? SKINS.filter((s) => data.banked >= s.unlock).pop() : null;
}
if (!unlocked(data.skin)) data.skin = 0;
