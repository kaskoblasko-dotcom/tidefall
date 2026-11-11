// Fully procedural audio (WebAudio): ambience, music, UI, movement and combat sfx.
// No audio files needed. Positional sounds are panned/attenuated relative to the listener.
import { settings } from './settings.js';

class AudioEngine {
  constructor() { this.ctx = null; this.listener = { x: 0, z: 0, yaw: 0 }; this.lastStep = 0; this.musicOn = false; this.ambOn = false; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.connect(c.destination);
    this.sfxBus = c.createGain(); this.sfxBus.connect(this.master);
    this.musicBus = c.createGain(); this.musicBus.connect(this.master);
    this.ambBus = c.createGain(); this.ambBus.connect(this.master);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.applyVolumes();
  }
  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(settings.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(settings.music * 0.55, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(settings.sfx, t, 0.05);
    this.ambBus.gain.setTargetAtTime(Math.min(1, settings.sfx * 0.9), t, 0.1);
  }
  setListener(x, z, yaw) { this.listener.x = x; this.listener.z = z; this.listener.yaw = yaw; }

  // route: returns an input node, applying distance gain + pan when a position is given
  out(pos, vol = 1) {
    const c = this.ctx, g = c.createGain(); g.gain.value = vol;
    let last = g;
    if (pos) {
      const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z, d = Math.hypot(dx, dz);
      const att = Math.max(0, 1 - d / 70) ** 1.6; g.gain.value = vol * att;
      if (c.createStereoPanner && d > 0.5) {
        const p = c.createStereoPanner();
        const rx = Math.cos(this.listener.yaw) * dx - Math.sin(this.listener.yaw) * dz; // right axis
        p.pan.value = Math.max(-1, Math.min(1, rx / Math.max(6, d)));
        g.connect(p); last = p;
      }
    }
    last.connect(this.sfxBus);
    return g;
  }
  tone(dest, f0, dur, { type = 'sine', vol = 0.3, f1 = null, delay = 0, attack = 0.004 } = {}) {
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dest, dur, { type = 'lowpass', f0 = 1000, f1 = null, q = 0.7, vol = 0.3, delay = 0, attack = 0.003 } = {}) {
    const c = this.ctx, t = c.currentTime + delay, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; s.loopStart = Math.random(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  // ---- sound effects -------------------------------------------------------
  play(name, pos = null, vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const o = this.out(pos, vol);
    switch (name) {
      case 'click': this.tone(o, 520, 0.06, { type: 'triangle', vol: 0.18 }); break;
      case 'hover': this.tone(o, 760, 0.03, { type: 'sine', vol: 0.05 }); break;
      case 'back': this.tone(o, 380, 0.08, { type: 'triangle', vol: 0.16, f1: 280 }); break;
      case 'error': this.tone(o, 200, 0.2, { type: 'sawtooth', vol: 0.12, f1: 140 }); break;
      case 'confirm': this.tone(o, 440, 0.1, { type: 'triangle', vol: 0.2 }); this.tone(o, 660, 0.16, { type: 'triangle', vol: 0.2, delay: 0.08 }); break;
      case 'swing': this.noise(o, 0.2, { type: 'bandpass', f0: 500, f1: 2400, q: 1.2, vol: 0.28 }); break;
      case 'slash': this.noise(o, 0.12, { type: 'highpass', f0: 2500, vol: 0.25 }); this.tone(o, 900, 0.18, { type: 'square', vol: 0.08, f1: 600 }); this.tone(o, 1380, 0.2, { type: 'sine', vol: 0.1 }); break;
      case 'harpoon': this.tone(o, 150, 0.3, { type: 'sine', vol: 0.5, f1: 45 }); this.noise(o, 0.25, { type: 'lowpass', f0: 2400, f1: 300, vol: 0.4 }); this.tone(o, 900, 0.5, { type: 'triangle', vol: 0.1, f1: 600, delay: 0.03 }); break;
      case 'blunder': this.tone(o, 90, 0.4, { type: 'sine', vol: 0.65, f1: 30 }); this.noise(o, 0.45, { type: 'lowpass', f0: 3200, f1: 200, vol: 0.7 }); break;
      case 'dry': this.tone(o, 1800, 0.03, { type: 'square', vol: 0.06 }); break;
      case 'wet': this.noise(o, 0.35, { type: 'bandpass', f0: 1400, f1: 500, q: 2, vol: 0.2 }); break;
      case 'reload': this.tone(o, 1200, 0.03, { type: 'square', vol: 0.07 }); this.tone(o, 800, 0.04, { type: 'square', vol: 0.07, delay: 0.16 }); this.noise(o, 0.05, { type: 'highpass', f0: 3000, vol: 0.15, delay: 0.5 }); break;
      case 'swap': this.noise(o, 0.08, { type: 'highpass', f0: 2000, vol: 0.1 }); this.tone(o, 600, 0.05, { type: 'triangle', vol: 0.06 }); break;
      case 'bubble': this.noise(o, 0.18, { type: 'bandpass', f0: 500, f1: 1500, q: 2, vol: 0.12 }); break;
      case 'dash': this.noise(o, 0.28, { type: 'bandpass', f0: 300, f1: 1800, q: 0.9, vol: 0.3 }); break;
      case 'jump': this.tone(o, 220, 0.12, { type: 'triangle', vol: 0.09, f1: 330 }); break;
      case 'land': this.noise(o, 0.1, { f0: 400, vol: 0.18 }); break;
      case 'splash': this.noise(o, 0.35, { type: 'bandpass', f0: 1200, f1: 400, q: 0.8, vol: 0.28 }); break;
      case 'stepSand': this.noise(o, 0.07, { f0: 1800, f1: 600, vol: 0.09 }); break;
      case 'stepGrass': this.noise(o, 0.08, { type: 'bandpass', f0: 2400, q: 0.6, vol: 0.07 }); break;
      case 'stepRock': this.noise(o, 0.05, { type: 'highpass', f0: 1500, vol: 0.1 }); this.tone(o, 160, 0.05, { type: 'triangle', vol: 0.08 }); break;
      case 'stepWood': this.tone(o, 190, 0.07, { type: 'triangle', vol: 0.12, f1: 120 }); this.noise(o, 0.04, { f0: 900, vol: 0.06 }); break;
      case 'stepWater': this.noise(o, 0.16, { type: 'bandpass', f0: 900, f1: 400, q: 1, vol: 0.16 }); break;
      case 'hitmark': this.tone(o, 1500, 0.06, { type: 'square', vol: 0.08 }); this.tone(o, 2100, 0.05, { type: 'sine', vol: 0.08, delay: 0.02 }); break;
      case 'crit': this.tone(o, 1100, 0.1, { type: 'square', vol: 0.1 }); this.tone(o, 1650, 0.14, { type: 'triangle', vol: 0.14, delay: 0.04 }); break;
      case 'hurt': this.tone(o, 140, 0.22, { type: 'sawtooth', vol: 0.2, f1: 70 }); this.noise(o, 0.12, { f0: 800, vol: 0.15 }); break;
      case 'kill': this.tone(o, 90, 0.5, { type: 'sine', vol: 0.4, f1: 40 }); this.tone(o, 880, 0.3, { type: 'triangle', vol: 0.14, delay: 0.1 }); break;
      case 'die': this.tone(o, 220, 0.7, { type: 'sawtooth', vol: 0.2, f1: 50 }); this.noise(o, 0.6, { f0: 1200, f1: 100, vol: 0.2 }); break;
      case 'respawn': this.tone(o, 330, 0.2, { type: 'triangle', vol: 0.15 }); this.tone(o, 495, 0.3, { type: 'triangle', vol: 0.15, delay: 0.12 }); break;
      case 'pickup': this.tone(o, 880, 0.12, { type: 'sine', vol: 0.22 }); this.tone(o, 1320, 0.22, { type: 'sine', vol: 0.22, delay: 0.07 }); this.tone(o, 1760, 0.3, { type: 'sine', vol: 0.12, delay: 0.14 }); break;
      case 'drop': this.tone(o, 500, 0.2, { type: 'triangle', vol: 0.15, f1: 200 }); break;
      case 'bank': [523, 659, 784, 1047].forEach((f, i) => this.tone(o, f, 0.4, { type: 'triangle', vol: 0.22, delay: i * 0.08 })); this.tone(o, 131, 0.8, { type: 'sine', vol: 0.3 }); break;
      case 'bell': this.tone(o, 392, 2.2, { type: 'sine', vol: 0.25, attack: 0.01 }); this.tone(o, 784 * 1.01, 1.6, { type: 'sine', vol: 0.12 }); this.tone(o, 1170, 1.0, { type: 'sine', vol: 0.06 }); break;
      case 'matchEnd': [392, 330, 262].forEach((f, i) => this.tone(o, f, 0.7, { type: 'triangle', vol: 0.25, delay: i * 0.25 })); break;
      case 'win': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(o, f, 0.5, { type: 'triangle', vol: 0.22, delay: i * 0.12 })); break;
      default: break;
    }
  }

  // ---- ambience --------------------------------------------------------------
  startAmbient() {
    if (!this.ctx || this.ambOn) return; this.ambOn = true;
    const c = this.ctx;
    const loop = (filterType, f, q, vol, lfoRate, lfoDepth) => {
      const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
      const fl = c.createBiquadFilter(); fl.type = filterType; fl.frequency.value = f; fl.Q.value = q;
      const g = c.createGain(); g.gain.value = vol;
      const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = lfoRate; lg.gain.value = lfoDepth;
      lfo.connect(lg); lg.connect(g.gain); lfo.start();
      s.connect(fl); fl.connect(g); g.connect(this.ambBus); s.start();
      return { g, fl };
    };
    this.waves = loop('lowpass', 520, 0.5, 0.16, 0.11, 0.1);
    loop('bandpass', 700, 0.4, 0.05, 0.07, 0.04); // wind
    this.surf = loop('highpass', 2600, 0.5, 0.025, 0.13, 0.02);
    const gull = () => {
      if (!this.ambOn) return;
      if (this.ctx.state === 'running') {
        const o = this.ambBus, n = 2 + (Math.random() * 3 | 0), base = 1500 + Math.random() * 600;
        for (let i = 0; i < n; i++) this.tone(o, base, 0.22, { type: 'triangle', vol: 0.03 + Math.random() * 0.02, f1: base * (0.7 + Math.random() * 0.2), delay: i * 0.28 });
      }
      setTimeout(gull, 7000 + Math.random() * 14000);
    };
    setTimeout(gull, 3000);
  }
  setTideAmbience(level) { if (this.waves) this.waves.g.gain.setTargetAtTime(0.1 + (level + 1.2) / 4.8 * 0.14, this.ctx.currentTime, 0.5); }

  // ---- music: slow modal pad + sparse plucks (D dorian) -----------------------
  startMusic() {
    if (!this.ctx || this.musicOn) return; this.musicOn = true;
    const c = this.ctx;
    const delay = c.createDelay(1), fb = c.createGain(), wet = c.createGain(), lp = c.createBiquadFilter();
    delay.delayTime.value = 0.42; fb.gain.value = 0.38; wet.gain.value = 0.5; lp.type = 'lowpass'; lp.frequency.value = 1800;
    delay.connect(lp); lp.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(this.musicBus);
    const dry = c.createGain(); dry.gain.value = 0.9; dry.connect(this.musicBus);
    const hz = (m) => 440 * 2 ** ((m - 69) / 12);
    const prog = [[50, 57, 60, 64], [46, 53, 57, 62], [43, 50, 55, 60], [45, 52, 57, 61]]; // Dm9 Bbmaj7 Gm7 A7
    const scale = [62, 64, 65, 67, 69, 71, 72, 74];
    let bar = 0;
    const play = () => {
      if (!this.musicOn) return;
      if (c.state === 'running') {
        const ch = prog[bar % 4], t = c.currentTime;
        for (const n of ch) {
          const o = c.createOscillator(), g = c.createGain(), o2 = c.createOscillator();
          o.type = 'triangle'; o2.type = 'sine'; o.frequency.value = hz(n); o2.frequency.value = hz(n) * 1.004;
          g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07, t + 1.6); g.gain.linearRampToValueAtTime(0.0001, t + 5.6);
          o.connect(g); o2.connect(g); g.connect(dry); g.connect(delay); o.start(t); o2.start(t); o.stop(t + 6); o2.stop(t + 6);
        }
        for (let i = 0; i < 8; i++) if (Math.random() < 0.55) {
          const n = scale[(Math.random() * scale.length) | 0], tt = t + i * 0.75, o = c.createOscillator(), g = c.createGain();
          o.type = 'sine'; o.frequency.value = hz(n);
          g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(0.06, tt + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, tt + 1.4);
          o.connect(g); g.connect(dry); g.connect(delay); o.start(tt); o.stop(tt + 1.5);
        }
      }
      bar++; setTimeout(play, 6000);
    };
    play();
  }
  duck(on) { if (!this.ctx) return; this.musicBus.gain.setTargetAtTime(settings.music * 0.55 * (on ? 0.4 : 1), this.ctx.currentTime, 0.3); }
}

export const audio = new AudioEngine();
