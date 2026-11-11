// WebSocket client with automatic reconnect/resume, latency + room-clock sync.
import { wsUrl } from './config.js';

export class Net {
  constructor() {
    this.ws = null; this.handlers = {}; this.status = 'idle'; this.hello = null; this.session = null;
    this.wantOpen = false; this.attempt = 0; this.rtt = 0; this.rtBase = 0; this.hasClock = false; this.pingTimer = 0;
  }
  on(t, f) { (this.handlers[t] ||= []).push(f); return this; }
  emit(t, m) { (this.handlers[t] || []).forEach((f) => f(m)); }
  setStatus(s, extra) { this.status = s; this.emit('status', { status: s, ...extra }); }
  roomTime() { return performance.now() / 1000 + this.rtBase; }
  syncClock(rt) { const target = rt + this.rtt / 2000 - performance.now() / 1000; this.rtBase = this.hasClock ? this.rtBase + (target - this.rtBase) * 0.1 : target; this.hasClock = true; }

  start(hello) { this.hello = hello; this.wantOpen = true; this.attempt = 0; this.open(); }
  stop() { this.wantOpen = false; clearInterval(this.pingTimer); if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } } this.ws = null; this.setStatus('idle'); }

  open() {
    this.setStatus(this.attempt ? 'reconnecting' : 'connecting', { attempt: this.attempt });
    let ws;
    try { ws = new WebSocket(wsUrl()); } catch (e) { return this.retry(); }
    this.ws = ws;
    const timeout = setTimeout(() => { if (ws.readyState !== 1) ws.close(); }, 20000); // Render free tier cold start
    ws.onopen = () => {
      clearTimeout(timeout);
      this.send({ ...this.hello(), t: 'hello', resume: this.session });
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'pong') { this.rtt = performance.now() - m.c; this.syncClock(m.rt); }
      else if (m.t === 'welcome') { this.attempt = 0; this.setStatus('open'); }
      else if (m.t === 'joined') { this.session = { code: m.code, token: m.token }; if (m.rt !== undefined) this.syncClock(m.rt); }
      else if (m.t === 'left' || m.t === 'resumeFailed') { this.session = null; }
      else if (m.t === 'snap') this.syncClock(m.rt);
      this.emit(m.t, m);
    };
    ws.onclose = () => { clearTimeout(timeout); clearInterval(this.pingTimer); if (this.ws === ws) { this.ws = null; if (this.wantOpen) this.retry(); } };
    ws.onerror = () => {};
  }
  retry() {
    this.attempt++;
    this.setStatus('reconnecting', { attempt: this.attempt });
    if (this.attempt > 12) { this.wantOpen = false; this.session = null; this.setStatus('failed'); return; }
    setTimeout(() => { if (this.wantOpen) this.open(); }, Math.min(1000 * 1.5 ** (this.attempt - 1), 8000));
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  get open_() { return this.ws && this.ws.readyState === 1; }
}
