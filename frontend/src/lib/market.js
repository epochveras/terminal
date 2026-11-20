import { api, fetchKlines } from "./api";

const WS_BASE = "wss://fstream.binance.com/market/stream?streams=";

class Socket {
  constructor(streams, onMsg, onStatus) {
    this.streams = streams; this.onMsg = onMsg; this.onStatus = onStatus; this.closed = false; this.open = false;
    this.connect();
  }
  connect() {
    if (this.closed) return;
    try { this.ws = new WebSocket(WS_BASE + this.streams.join("/")); } catch { return this.retry(); }
    this.ws.onopen = () => { this.open = true; this.onStatus?.(true); };
    this.ws.onmessage = (e) => { try { this.onMsg(JSON.parse(e.data)); } catch {} };
    this.ws.onclose = () => { this.open = false; this.onStatus?.(false); this.retry(); };
    this.ws.onerror = () => { try { this.ws.close(); } catch {} };
  }
  retry() { if (!this.closed) setTimeout(() => this.connect(), 3000); }
  close() { this.closed = true; try { this.ws?.close(); } catch {} }
}

// Global ticker store: live watchlist + funding
export const market = {
  tickers: {}, listeners: new Set(), wsOpen: false, statusListeners: new Set(), started: false,
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  onStatus(fn) { this.statusListeners.add(fn); fn(this.wsOpen); return () => this.statusListeners.delete(fn); },
  emit() { this.listeners.forEach((f) => f(this.tickers)); },
  merge(s, patch) { this.tickers[s] = { ...(this.tickers[s] || {}), ...patch }; this.dirty = true; },
  async poll() {
    try {
      const { data } = await api.get("/market/tickers");
      data.forEach((t) => this.merge(t.s, { c: +t.c, P: +t.P, q: +t.q, r: t.r, m: +t.m, T: t.T }));
    } catch {}
  },
  start() {
    if (this.started) return; this.started = true;
    this.poll();
    this.sock = new Socket(["!ticker@arr", "!markPrice@arr@1s"], (msg) => {
      const d = msg.data;
      if (!Array.isArray(d)) return;
      if (msg.stream === "!ticker@arr") d.forEach((t) => this.merge(t.s, { c: +t.c, P: +t.P, q: +t.q }));
      else d.forEach((t) => this.merge(t.s, { r: t.r, m: +t.p, T: t.T }));
    }, (o) => { this.wsOpen = o; this.statusListeners.forEach((f) => f(o)); });
    setInterval(() => { if (!this.wsOpen) this.poll(); }, 3000);
    setInterval(() => { if (this.dirty) { this.dirty = false; this.emit(); } }, 700);
  },
};

// Live kline feed for one symbol/interval, with REST fallback
export function liveKlines(symbol, interval, onBar) {
  const sock = new Socket([`${symbol.toLowerCase()}@kline_${interval}`], (msg) => {
    const k = msg.data?.k;
    if (k) onBar({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v });
  });
  const iv = setInterval(async () => {
    if (sock.open) return;
    try { (await fetchKlines(symbol, interval, 2)).forEach(onBar); } catch {}
  }, 2000);
  return () => { sock.close(); clearInterval(iv); };
}
