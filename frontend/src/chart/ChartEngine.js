import { fmtPrice, fmtCountdown, uid } from "../lib/format";
import { market } from "../lib/market";

const AXIS_W = 78, TIME_H = 26, DIV = 6;
const C = {
  bg: "#000000", grid: "rgba(70,74,86,0.2)", text: "#b2b5be", border: "#2a2e39", up: "#089981", down: "#f23645",
  cross: "#9598a1", alarm: "#e0a020", handle: "#ffffff",
};
const FAM = "Roboto, -apple-system, BlinkMacSystemFont, 'Trebuchet MS', sans-serif";
const FONT = "12px " + FAM;
const TZ = 3 * 3600e3;
const TWO = ["trendline", "rect", "fib"];
const FIB = [[0, "#787b86"], [0.236, "#f23645"], [0.382, "#ff9800"], [0.5, "#4caf50"], [0.618, "#089981"], [0.786, "#00bcd4"], [1, "#787b86"], [1.618, "#2962ff"]];
const fibDefaults = () => FIB.map(([value, color]) => ({ value, color, visible: true }));
const fibLevels = (d) => Array.isArray(d.levels) && d.levels.length
  ? d.levels.filter((x) => Number.isFinite(Number(x.value))).slice().sort((a, b) => Number(a.value) - Number(b.value))
  : fibDefaults();
const DEF_STYLE = { color: "#d1d4dc", width: 1 };
const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const TICK_INTERVALS = [60e3, 300e3, 900e3, 1800e3, 3600e3, 7200e3, 10800e3, 14400e3, 21600e3, 43200e3, 864e5, 1728e5, 6048e5, "M", "3M", "Y"];

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw))); const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }

export class ChartEngine {
  constructor(el, cb) {
    this.el = el; this.cb = cb || {};
    this.canvas = document.createElement("canvas");
    Object.assign(this.canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", touchAction: "none", display: "block" });
    this.canvas.setAttribute("data-testid", "tradingview-chart-canvas");
    el.appendChild(this.canvas); this.ctx = this.canvas.getContext("2d");
    Object.assign(this, {
      bars: [], dec: 2, tick: 0.01, tf: 60e3, key: "", info: {}, spacing: 8, rightIdx: 0, auto: true, pMin: 0, pMax: 1,
      ov: null, rov: null, rsiRatio: 0.26, drawings: [], alarms: [], tool: "cursor", magnet: false,
      defaults: { trendline: { color: "#2962ff", width: 2 }, hray: { color: "#00bcd4", width: 1 } },
      selected: null, creating: null, ruler: null, cross: null, pointers: new Map(), mode: null, tagRects: [], W: 0, H: 0,
    });
    ["pointerdown", "pointermove", "pointerup", "pointercancel", "pointerleave", "wheel", "dblclick", "contextmenu"].forEach((ev) => {
      const fn = this["on_" + ev].bind(this); this["_" + ev] = fn;
      this.canvas.addEventListener(ev, fn, { passive: false });
    });
    this._touch = (e) => e.preventDefault();
    ["touchstart", "touchmove", "touchend"].forEach((ev) => this.canvas.addEventListener(ev, this._touch, { passive: false }));
    Object.assign(this.canvas.style, { userSelect: "none", webkitUserSelect: "none", webkitTouchCallout: "none" });
    this._key = (e) => this.onKey(e); window.addEventListener("keydown", this._key);
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(el);
    this.timer = setInterval(() => this.dirty(), 1000);
    document.fonts?.ready.then(() => this.dirty());
    this.resize();
  }
  destroy() {
    this.ro.disconnect(); clearInterval(this.timer); window.removeEventListener("keydown", this._key);
    cancelAnimationFrame(this.raf); this.canvas.remove();
  }
  resize() {
    const r = this.el.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    this.W = Math.max(50, r.width); this.H = Math.max(50, r.height); this.dpr = dpr;
    this.canvas.width = Math.round(this.W * dpr); this.canvas.height = Math.round(this.H * dpr);
    this.render();
  }
  dirty() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = null; this.render(); }); }

  // ---------- data ----------
  setSeries(info, bars) {
    const key = info.symbol + "|" + info.tf;
    this.info = info; this.dec = info.dec; this.tick = info.tick; this.tf = info.tfMs; this.bars = bars;
    if (key !== this.key) {
      this.key = key; this.auto = true; this.rAuto = true; this.selected = null; this.creating = null; this.ruler = null;
      this.rightIdx = bars.length - 1 + Math.min(8, Math.floor(this.plotW / this.spacing / 6));
    }
    this.dirty();
  }
  appendLive(bar) {
    const b = this.bars; const last = b[b.length - 1];
    if (!last) return false;
    if (bar.t === last.t) { b[b.length - 1] = bar; this.dirty(); return false; }
    if (bar.t > last.t) { const follow = this.rightIdx >= b.length - 3; b.push(bar); if (follow) this.rightIdx += 1; this.dirty(); return true; }
    return false;
  }
  prepend(older) {
    const first = this.bars[0]; const add = older.filter((x) => !first || x.t < first.t);
    if (!add.length) return 0;
    this.bars = add.concat(this.bars); this.rightIdx += add.length; this.dirty(); return add.length;
  }
  setOverlays(ov, rov) { this.ov = ov; this.rov = rov; this.dirty(); }
  setDrawings(list) {
    this.drawings = list || []; this.selected = null;
    this.past = []; this.future = []; this.snap = JSON.stringify(this.drawings); this.emitHistory(); this.dirty();
  }
  emitHistory() { this.cb.onHistory?.({ undo: this.past.length > 0, redo: this.future.length > 0 }); }
  restore(from, to) {
    if (!from?.length) return;
    to.push(this.snap); this.snap = from.pop();
    this.drawings = JSON.parse(this.snap); this.select(null);
    this.cb.onDrawingsChange?.(this.drawings.map((d) => ({ ...d }))); this.emitHistory();
  }
  undo() { this.restore(this.past, this.future); }
  redo() { this.restore(this.future, this.past); }
  setAlarms(list) { this.alarms = list || []; this.dirty(); }
  setTool(t) {
    this.tool = t; this.creating = null;
    if (t !== "cursor") {
      this.select(null);
      if (this.lastTouch || window.matchMedia?.("(pointer: coarse)").matches) this.cross = { x: this.plotW * 0.6, y: this.mainH / 2, i: Math.round(this.idxOf(this.plotW * 0.6)), pane: "main", touch: true };
    }
    this.dirty();
  }
  setMagnet(m) { this.magnet = m; }
  setDefaults(d) { this.defaults = { ...this.defaults, ...d }; }
  setRsiRatio(r) { this.rsiRatio = r; this.dirty(); }
  select(d) { this.selected = d; this.cb.onSelect?.(d ? { ...d } : null); this.dirty(); }
  emitDrawings() {
    const s = JSON.stringify(this.drawings);
    if (this.snap !== undefined && s !== this.snap) { this.past.push(this.snap); if (this.past.length > 100) this.past.shift(); this.future = []; }
    this.snap = s; this.emitHistory();
    this.cb.onDrawingsChange?.(this.drawings.map((d) => ({ ...d })));
  }
  updateSelected(patch) {
    if (!this.selected) return; Object.assign(this.selected, patch);
    this.emitDrawings(); this.cb.onSelect?.({ ...this.selected }); this.dirty();
  }
  deleteSelected() {
    if (!this.selected) return; this.drawings = this.drawings.filter((d) => d !== this.selected);
    this.select(null); this.emitDrawings();
  }
  clearDrawings() { this.drawings = []; this.select(null); this.emitDrawings(); }
  resetScale() { this.auto = true; this.dirty(); }

  // ---------- geometry ----------
  get plotW() { return this.W - AXIS_W; }
  get hasRsi() { return !!this.rov; }
  get mainH() { const a = this.H - TIME_H; return this.hasRsi ? Math.round(a * (1 - this.rsiRatio) - DIV / 2) : a; }
  get rsiTop() { return this.mainH + DIV; }
  get rsiH() { return this.H - TIME_H - this.rsiTop; }
  xOf(i) { return this.plotW - (this.rightIdx - i) * this.spacing; }
  idxOf(x) { return this.rightIdx - (this.plotW - x) / this.spacing; }
  yOf(p) { return ((this.pMax - p) / (this.pMax - this.pMin)) * this.mainH; }
  pOf(y) { return this.pMax - (y / this.mainH) * (this.pMax - this.pMin); }
  ryOf(v) { return this.rsiTop + ((this.rMax - v) / (this.rMax - this.rMin)) * this.rsiH; }
  rvOf(y) { return this.rMax - ((y - this.rsiTop) / this.rsiH) * (this.rMax - this.rMin); }
  timeToIdx(t) {
    const b = this.bars, n = b.length; if (!n) return 0;
    if (t >= b[n - 1].t) return n - 1 + (t - b[n - 1].t) / this.tf;
    if (t <= b[0].t) return (t - b[0].t) / this.tf;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m].t <= t) lo = m; else hi = m; }
    return lo + (t - b[lo].t) / (b[hi].t - b[lo].t);
  }
  idxToTime(i) {
    const b = this.bars, n = b.length; if (!n) return 0;
    if (i >= n - 1) return b[n - 1].t + (i - (n - 1)) * this.tf;
    if (i <= 0) return b[0].t + i * this.tf;
    const k = Math.floor(i); return b[k].t + (i - k) * (b[k + 1].t - b[k].t);
  }
  xOfT(t) { return this.xOf(this.timeToIdx(t)); }
  visible() { return [Math.max(0, Math.floor(this.idxOf(0)) - 1), Math.min(this.bars.length - 1, Math.ceil(this.idxOf(this.plotW)) + 1)]; }

  computeRange() {
    const [i0, i1] = this.visible(); const b = this.bars;
    if (this.auto && i1 >= i0 && b.length) {
      let mn = Infinity, mx = -Infinity;
      for (let i = i0; i <= i1; i++) { if (b[i].l < mn) mn = b[i].l; if (b[i].h > mx) mx = b[i].h; }
      if (!isFinite(mn)) { mn = b[b.length - 1].l; mx = b[b.length - 1].h; }
      const pad = (mx - mn) * 0.1 || mx * 0.01 || 1; this.pMin = mn - pad; this.pMax = mx + pad;
    }
    if (this.hasRsi && this.rAuto !== false) {
      let mn = Infinity, mx = -Infinity;
      (this.rov.plots || []).forEach((p) => { for (let i = i0; i <= i1; i++) { const v = p.data[i]; if (!isNaN(v)) { if (v < mn) mn = v; if (v > mx) mx = v; } } });
      if (!isFinite(mn)) { mn = 0; mx = 100; }
      const pad = (mx - mn) * 0.08 || 5; this.rMin = mn - pad; this.rMax = mx + pad;
    }
  }

  // ---------- render ----------
  render() {
    const ctx = this.ctx; if (!ctx || !this.W) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, this.W, this.H);
    if (!this.bars.length) return;
    this.computeRange();
    const pw = this.plotW, mh = this.mainH;
    const [i0, i1] = this.visible();
    const yTicks = this.priceTicks(this.pMin, this.pMax, mh);
    const tTicks = this.timeTicks();
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath();
    yTicks.forEach((v) => { const y = Math.round(this.yOf(v)) + 0.5; if (y < mh) { ctx.moveTo(0, y); ctx.lineTo(pw, y); } });
    if (this.hasRsi) this.priceTicks(this.rMin, this.rMax, this.rsiH).forEach((v) => { const y = Math.round(this.ryOf(v)) + 0.5; if (y > this.rsiTop && y < this.rsiTop + this.rsiH) { ctx.moveTo(0, y); ctx.lineTo(pw, y); } });
    tTicks.forEach((t) => { const x = Math.round(t.x) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, this.H - TIME_H); });
    ctx.stroke();

    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, pw, mh); ctx.clip();
    const yf = (p) => this.yOf(p);
    if (this.ov) this.drawFills(this.ov, yf, i0, i1);
    this.drawCandles(i0, i1);
    if (this.ov) this.drawOverlay(this.ov, yf, 0, mh, i0, i1);
    this.drawDrawings();
    this.drawLegend();
    ctx.restore();

    if (this.hasRsi) {
      const rt = this.rsiTop, rh = this.rsiH, rf = (v) => this.ryOf(v);
      ctx.strokeStyle = C.border; ctx.beginPath(); ctx.moveTo(0, mh + DIV / 2 + 0.5); ctx.lineTo(this.W, mh + DIV / 2 + 0.5); ctx.stroke();
      ctx.save(); ctx.beginPath(); ctx.rect(0, rt, pw, rh); ctx.clip();
      const r = this.rov;
      if (r.bandFill) { const ya = rf(r.bandFill.p1), yb = rf(r.bandFill.p2); ctx.fillStyle = r.bandFill.color; ctx.fillRect(0, Math.min(ya, yb), pw, Math.abs(yb - ya)); }
      (r.hlines || []).forEach((h) => { ctx.strokeStyle = h.color; ctx.setLineDash([4, 4]); ctx.beginPath(); const y = Math.round(rf(h.p)) + 0.5; ctx.moveTo(0, y); ctx.lineTo(pw, y); ctx.stroke(); ctx.setLineDash([]); });
      this.drawFills(r, rf, i0, i1);
      this.drawOverlay(r, rf, rt, rh, i0, i1);
      this.drawPaneLegend(r, rt);
      ctx.restore();
    }
    this.drawCrosshair();
    this.drawPriceAxis(yTicks);
    this.drawTimeAxis(tTicks);
  }

  priceTicks(mn, mx, h) {
    const step = Math.max(niceStep((mx - mn) / Math.max(2, h / 28)), +this.tick || 1e-12); const out = [];
    for (let v = Math.ceil(mn / step) * step; v <= mx; v += step) out.push(+v.toFixed(10));
    return out;
  }
  timeTicks() {
    const sp = this.spacing, tf = this.tf;
    let iv = TICK_INTERVALS.find((x) => (typeof x === "number" ? (x / tf) * sp >= 85 : ({ M: 30 * 864e5, "3M": 91 * 864e5, Y: 365 * 864e5 }[x] / tf) * sp >= 85)) || "Y";
    if (typeof iv === "number" && iv < tf) iv = tf;
    const keyOf = (t) => {
      const d = new Date(t);
      if (iv === "M") return d.getUTCFullYear() * 12 + d.getUTCMonth();
      if (iv === "3M") return d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3);
      if (iv === "Y") return d.getUTCFullYear();
      if (iv === 6048e5) return Math.floor((t - 4 * 864e5) / iv);
      return Math.floor(t / iv);
    };
    const out = []; let prevKey = null, lastX = -999;
    const a = Math.floor(this.idxOf(0)) - 1, b = Math.ceil(this.idxOf(this.plotW)) + 1;
    for (let i = a; i <= b; i++) {
      const t = this.idxToTime(i), k = keyOf(t);
      if (prevKey !== null && k !== prevKey) {
        const x = this.xOf(i);
        if (x - lastX > 60 && x > 0 && x < this.plotW) { out.push({ x, t, label: this.tLabel(t, iv) }); lastX = x; }
      }
      prevKey = k;
    }
    return out;
  }
  // Day boundary = 00:00 UTC (03:00 UTC+3, Binance daily open); clock shown in UTC+3
  tLabel(t, iv) {
    const u = new Date(t), l = new Date(t + TZ), p = (n) => String(n).padStart(2, "0");
    const dayStart = t % 864e5 === 0, date = `${u.getUTCDate()} ${MONTHS[u.getUTCMonth()]}`;
    if (iv === "Y" || (dayStart && u.getUTCMonth() === 0 && u.getUTCDate() === 1)) return String(u.getUTCFullYear());
    if (typeof iv !== "number" || iv >= 864e5) return u.getUTCDate() === 1 && iv !== 6048e5 && iv !== 864e5 ? MONTHS[u.getUTCMonth()] : iv === "M" || iv === "3M" ? MONTHS[u.getUTCMonth()] : date;
    if (dayStart) return u.getUTCDate() === 1 ? MONTHS[u.getUTCMonth()] : date;
    return `${p(l.getUTCHours())}:${p(l.getUTCMinutes())}`;
  }
  barColor(i) { const b = this.bars[i]; return (this.ov?.barColors && this.ov.barColors[i]) || (b.c >= b.o ? C.up : C.down); }
  drawCandles(i0, i1) {
    const ctx = this.ctx, sp = this.spacing, bw = Math.max(1, Math.round(sp * 0.72) - (sp > 4 ? 1 : 0));
    for (let i = i0; i <= i1; i++) {
      const b = this.bars[i], x = Math.round(this.xOf(i)), col = this.barColor(i);
      const yo = this.yOf(b.o), yc = this.yOf(b.c), yh = this.yOf(b.h), yl = this.yOf(b.l);
      ctx.fillStyle = col;
      ctx.fillRect(x, Math.round(yh), 1, Math.max(1, Math.round(yl - yh)));
      if (sp >= 2.5) { const top = Math.round(Math.min(yo, yc)); ctx.fillRect(x - Math.floor(bw / 2), top, bw, Math.max(1, Math.round(Math.max(yo, yc)) - top)); }
    }
  }
  drawFills(ov, yf, i0, i1) {
    const ctx = this.ctx;
    (ov.fills || []).forEach((f) => {
      for (let i = Math.max(1, i0); i <= i1; i++) {
        const a0 = f.a[i - 1], a1 = f.a[i], b0 = f.b[i - 1], b1 = f.b[i];
        if ([a0, a1, b0, b1].some((v) => v == null || isNaN(v))) continue;
        const x0 = this.xOf(i - 1), x1 = this.xOf(i);
        ctx.fillStyle = f.colors ? f.colors[i] : f.color;
        ctx.beginPath(); ctx.moveTo(x0, yf(a0)); ctx.lineTo(x1, yf(a1)); ctx.lineTo(x1, yf(b1)); ctx.lineTo(x0, yf(b0)); ctx.closePath(); ctx.fill();
      }
    });
  }
  dash(d) { this.ctx.setLineDash(d === "dotted" ? [2, 3] : d === "dashed" ? [6, 4] : []); }
  drawOverlay(ov, yf, top, h, i0, i1) {
    const ctx = this.ctx; ctx.lineJoin = "round";
    (ov.plots || []).forEach((p) => {
      ctx.lineWidth = p.width || 1;
      if (p.zig) {
        ctx.strokeStyle = p.color; ctx.beginPath(); p.zig.forEach(([i, v], k) => (k ? ctx.lineTo(this.xOf(i), yf(v)) : ctx.moveTo(this.xOf(i), yf(v)))); ctx.stroke(); return;
      }
      if (p.colors) {
        for (let i = Math.max(1, i0); i <= i1; i++) {
          const v0 = p.data[i - 1], v1 = p.data[i]; if (isNaN(v0) || isNaN(v1)) continue;
          ctx.strokeStyle = p.colors[i]; ctx.beginPath(); ctx.moveTo(this.xOf(i - 1), yf(v0)); ctx.lineTo(this.xOf(i), yf(v1)); ctx.stroke();
        }
      } else {
        ctx.strokeStyle = p.color; ctx.beginPath(); let pen = false;
        for (let i = i0; i <= i1; i++) { const v = p.data[i]; if (isNaN(v)) { pen = false; continue; } const x = this.xOf(i), y = yf(v); pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; }
        ctx.stroke();
      }
    });
    (ov.segs || []).forEach((s) => {
      if (Math.max(s.i1, s.i2) < i0 - 2 && !s.ext) return;
      let x1 = this.xOf(s.i1), y1 = yf(s.p1), x2 = this.xOf(s.i2), y2 = yf(s.p2);
      if (s.ext && x2 !== x1) { const k = (y2 - y1) / (x2 - x1); y2 = y2 + k * (this.plotW - x2); x2 = this.plotW; }
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1; this.dash(s.dash);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.font = "10px " + FAM; ctx.textAlign = "center";
    const slots = {};
    (ov.shapes || []).forEach((sh) => { if (sh.kind === "arrowUp") slots[sh.i + "b"] = 14; else if (sh.kind === "arrowDown") slots[sh.i + "a"] = 14; });
    (ov.labels || []).forEach((l) => {
      if (l.i < i0 || l.i > i1) return;
      const sk = l.i + (l.pos === "above" ? "a" : "b"), off = slots[sk] || 0;
      slots[sk] = off + (l.bg ? (l.big ? 22 : 18) : 13);
      const x = this.xOf(l.i), y = yf(l.p) + (l.pos === "above" ? -off : off);
      if (l.bg) {
        ctx.font = `bold ${l.big ? 11 : 9}px ${FAM}`; const w = ctx.measureText(l.text).width + 8, h = l.big ? 16 : 13;
        const by = l.pos === "above" ? y - 6 - h : y + 6; ctx.fillStyle = l.bg; rrect(ctx, x - w / 2, by, w, h, 2); ctx.fill();
        ctx.beginPath(); if (l.pos === "above") { ctx.moveTo(x - 3, by + h); ctx.lineTo(x + 3, by + h); ctx.lineTo(x, by + h + 4); } else { ctx.moveTo(x - 3, by); ctx.lineTo(x + 3, by); ctx.lineTo(x, by - 4); } ctx.fill();
        ctx.fillStyle = l.color; ctx.textBaseline = "middle"; ctx.fillText(l.text, x, by + h / 2 + 0.5); ctx.font = "10px " + FAM; return;
      }
      ctx.fillStyle = l.color;
      l.pos === "above" ? (ctx.textBaseline = "bottom", ctx.fillText(l.text, x, y - 6)) : (ctx.textBaseline = "top", ctx.fillText(l.text, x, y + 6));
    });
    const s = Math.max(2.5, Math.min(5, this.spacing * 0.4));
    (ov.shapes || []).forEach((sh) => {
      if (sh.i < i0 || sh.i > i1) return;
      const x = this.xOf(sh.i); ctx.fillStyle = sh.color; ctx.beginPath();
      if (sh.kind === "triUp") { const y = top + h - 4; ctx.moveTo(x, y - s * 1.6); ctx.lineTo(x - s, y); ctx.lineTo(x + s, y); }
      else if (sh.kind === "triDown") { const y = top + 4; ctx.moveTo(x, y + s * 1.6); ctx.lineTo(x - s, y); ctx.lineTo(x + s, y); }
      else if (sh.kind === "arrowUp") { const y = yf(sh.p) + 6; ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 5); ctx.lineTo(x - 1.5, y + 5); ctx.lineTo(x - 1.5, y + 12); ctx.lineTo(x + 1.5, y + 12); ctx.lineTo(x + 1.5, y + 5); ctx.lineTo(x + 4, y + 5); }
      else { const y = yf(sh.p) - 6; ctx.moveTo(x, y); ctx.lineTo(x - 4, y - 5); ctx.lineTo(x - 1.5, y - 5); ctx.lineTo(x - 1.5, y - 12); ctx.lineTo(x + 1.5, y - 12); ctx.lineTo(x + 1.5, y - 5); ctx.lineTo(x + 4, y - 5); }
      ctx.closePath(); ctx.fill();
    });
    (ov.tables || []).forEach((t) => {
      const cw = 34, ch = 13, gap = 2; ctx.font = "bold 8px " + FAM; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      t.cells.forEach((c, k) => {
        let x, y;
        if (t.pos === "top-center") { x = this.plotW / 2 - cw / 2; y = top + (this.plotW < 560 ? 62 : 6) + k * (ch + gap); }
        else { x = this.plotW - 8 - (t.cells.length - k) * (cw + gap); y = top + h - ch - 22; }
        ctx.fillStyle = c.color; ctx.fillRect(x, y, cw, ch); ctx.fillStyle = "#fff"; ctx.fillText(c.text, x + cw / 2, y + ch / 2 + 0.5);
      });
    });
  }
  legendIdx() { return this.cross && this.cross.i != null ? Math.max(0, Math.min(this.bars.length - 1, this.cross.i)) : this.bars.length - 1; }
  drawLegend() {
    const ctx = this.ctx, i = this.legendIdx(), b = this.bars[i]; if (!b) return;
    const d = this.dec, col = b.c >= b.o ? C.up : C.down; let x = 10, y = 16;
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.font = "600 13px " + FAM; ctx.fillStyle = "#d1d4dc";
    const head = `${this.info.symbol || ""} · ${this.info.tfLabel || ""} · Binance`; ctx.fillText(head, x, y);
    const dp = market.tickers[this.info.symbol]?.P;
    if (dp != null && isFinite(dp)) {
      ctx.fillStyle = dp >= 0 ? C.up : C.down;
      ctx.fillText(`${dp > 0 ? "+" : ""}${fmtPrice(dp, 2)}%`, x + ctx.measureText(head).width + 10, y);
      ctx.fillStyle = "#d1d4dc";
    }
    y += 18; ctx.font = FONT;
    const prev = this.bars[i - 1]; const ch = prev ? b.c - prev.c : 0, chp = prev ? (ch / prev.c) * 100 : 0;
    const parts = [["A", fmtPrice(b.o, d)], ["Y", fmtPrice(b.h, d)], ["D", fmtPrice(b.l, d)], ["K", fmtPrice(b.c, d)], ["", `${ch >= 0 ? "+" : ""}${fmtPrice(ch, d)} (${chp >= 0 ? "+" : ""}${fmtPrice(chp, 2)}%)`]];
    parts.forEach(([k, v]) => { if (k) { ctx.fillStyle = "#787b86"; ctx.fillText(k, x, y); x += ctx.measureText(k).width + 3; } ctx.fillStyle = col; ctx.fillText(v, x, y); x += ctx.measureText(v).width + 8; });
  }
  legendLine(items, x, y, i, d) {
    const ctx = this.ctx; ctx.font = FONT; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    items.forEach((it) => {
      const txt = it.data ? fmtPrice(it.data[i], d) : it.text; if (!txt) return;
      ctx.fillStyle = it.color; ctx.fillText(txt, x, y); x += ctx.measureText(txt).width + 7;
    });
  }
  drawPaneLegend(r, top) {
    const i = this.legendIdx(); this.legendLine(r.legend || [], 10, top + 13, i, 2);
    (r.info || []).forEach((inf, k) => {
      const ctx = this.ctx; ctx.font = "11px " + FAM; const w = ctx.measureText(inf.text).width + 12;
      const oy = (r.legend || []).length ? 24 : 6;
      ctx.fillStyle = "#363a45"; ctx.fillRect(10, top + oy + k * 20, w, 17); ctx.fillStyle = "#fff"; ctx.fillText(inf.text, 16, top + oy + 9 + k * 20);
    });
  }

  // ---------- drawings ----------
  pt(p) { return { x: this.xOfT(p.t), y: this.yOf(p.p) }; }
  handle(x, y, color) {
    const ctx = this.ctx; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = "#000"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = color; ctx.stroke();
  }
  drawDrawings() {
    const list = [...this.drawings]; if (this.creating?.d) list.push(this.creating.d);
    list.forEach((d) => this.drawOne(d, d === this.selected || d === this.creating?.d));
    if (this.ruler) this.drawRuler(this.ruler);
  }
  drawOne(d, sel) {
    const ctx = this.ctx;
    if (d.type === "trendline") {
      const a = this.pt(d.p1), b = this.pt(d.p2);
      ctx.strokeStyle = d.color; ctx.lineWidth = d.width; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (sel) { this.handle(a.x, a.y, d.color); this.handle(b.x, b.y, d.color); }
    } else if (d.type === "hray") {
      const a = this.pt(d.p1);
      ctx.strokeStyle = d.color; ctx.lineWidth = d.width; ctx.beginPath(); ctx.moveTo(a.x, Math.round(a.y) + 0.5); ctx.lineTo(this.plotW, Math.round(a.y) + 0.5); ctx.stroke();
      if (sel) this.handle(a.x, a.y, d.color);
    } else if (d.type === "vline") {
      const x = Math.round(this.xOfT(d.p1.t)) + 0.5;
      ctx.strokeStyle = d.color; ctx.lineWidth = d.width; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.mainH); ctx.stroke();
      if (sel) this.handle(x, this.mainH / 2, d.color);
    } else if (d.type === "rect") {
      const a = this.pt(d.p1), b = this.pt(d.p2);
      ctx.fillStyle = d.color.length === 7 ? d.color + "26" : d.color; ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeStyle = d.color; ctx.lineWidth = d.width; ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      if (sel) { this.handle(a.x, a.y, d.color); this.handle(b.x, b.y, d.color); this.handle(a.x, b.y, d.color); this.handle(b.x, a.y, d.color); }
    } else if (d.type === "fib") {
      const a = this.pt(d.p1), b = this.pt(d.p2), x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), rng = d.p2.p - d.p1.p;
      ctx.strokeStyle = d.color || "#d1d4dc"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      const levels = fibLevels(d).filter((level) => level.visible !== false).map((level) => {
        const lv = Number(level.value), price = d.reverse ? d.p1.p + rng * lv : d.p2.p - rng * lv;
        return { ...level, value: lv, price, y: this.yOf(price), color: level.color || "#d1d4dc" };
      });
      if (d.showFill !== false) {
        for (let i = 1; i < levels.length; i++) {
          const prev = levels[i - 1], cur = levels[i];
          ctx.fillStyle = cur.color + "1a";
          ctx.fillRect(x1, Math.min(prev.y, cur.y), x2 - x1, Math.abs(cur.y - prev.y));
        }
      }
      levels.forEach((level) => {
        const { value: lv, price, y, color } = level;
        ctx.strokeStyle = color; ctx.lineWidth = Number(d.width) || 1; ctx.beginPath(); ctx.moveTo(x1, Math.round(y) + 0.5); ctx.lineTo(x2, Math.round(y) + 0.5); ctx.stroke();
        ctx.fillStyle = color; ctx.font = "11px " + FAM; ctx.textAlign = "right"; ctx.textBaseline = "middle";
        ctx.fillText(`${lv} (${fmtPrice(price, this.dec)})`, x1 - 4, y);
      });
      if (sel) { this.handle(a.x, a.y, d.color); this.handle(b.x, b.y, d.color); }
    } else if (d.type === "text") {
      const a = this.pt(d.p1);
      const size = Math.max(8, Math.min(48, Number(d.fontSize) || 14));
      ctx.font = `${size}px ${FAM}`;
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillStyle = d.color || "#d1d4dc";
      ctx.fillText(String(d.text || ""), a.x, a.y);
      if (sel) {
        const w = ctx.measureText(String(d.text || "")).width;
        ctx.strokeStyle = d.color || "#d1d4dc"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.strokeRect(a.x - 3, a.y - size / 2 - 3, w + 6, size + 6); ctx.setLineDash([]);
        this.handle(a.x, a.y, d.color || "#d1d4dc");
      }
    } else if (d.type === "long" || d.type === "short") this.drawPosition(d, sel);
  }
  drawPosition(d, sel) {
    const ctx = this.ctx, long = d.type === "long";
    const x1 = this.xOfT(d.t1), x2 = this.xOfT(d.t2), yE = this.yOf(d.entry), yT = this.yOf(d.tp), yS = this.yOf(d.sl);
    const n = this.bars.length; const lastBar = this.bars[n - 1];
    let cur = null, curT = null;
    if (lastBar && lastBar.t >= d.t1) {
      const endIdx = Math.min(n - 1, Math.floor(this.timeToIdx(d.t2)));
      const bb = this.bars[Math.max(0, endIdx)]; cur = bb.c; curT = bb.t;
    }
    const profit = cur != null && (long ? cur > d.entry : cur < d.entry), loss = cur != null && (long ? cur < d.entry : cur > d.entry);
    const g = "8,153,129", r = "242,54,69";
    ctx.fillStyle = `rgba(${g},${profit ? 0.34 : 0.16})`; ctx.fillRect(x1, Math.min(yE, yT), x2 - x1, Math.abs(yT - yE));
    ctx.fillStyle = `rgba(${r},${loss ? 0.34 : 0.16})`; ctx.fillRect(x1, Math.min(yE, yS), x2 - x1, Math.abs(yS - yE));
    if (cur != null) {
      const xc = Math.min(x2, this.xOfT(curT)); const yc = this.yOf(Math.max(Math.min(cur, Math.max(d.tp, d.sl)), Math.min(d.tp, d.sl)));
      ctx.fillStyle = profit ? `rgba(${g},0.4)` : `rgba(${r},0.4)`; ctx.fillRect(x1, Math.min(yE, yc), Math.max(0, xc - x1), Math.abs(yc - yE));
      ctx.strokeStyle = "#9598a1"; ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x1, yE); ctx.lineTo(xc, yc); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.strokeStyle = "#9598a1"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x1, yE); ctx.lineTo(x2, yE); ctx.stroke();
    const pct = (v) => fmtPrice(((v - d.entry) / d.entry) * 100, 2) + "%";
    const rr = Math.abs(d.tp - d.entry) / Math.max(1e-12, Math.abs(d.entry - d.sl));
    const tag = (text, y, bg) => {
      ctx.font = "11px " + FAM; const w = ctx.measureText(text).width + 12, xm = (x1 + x2) / 2;
      ctx.fillStyle = bg; rrect(ctx, xm - w / 2, y - 9, w, 18, 3); ctx.fill(); ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, xm, y);
    };
    const up = yT < yE;
    tag(`Hedef ${fmtPrice(d.tp, this.dec)} (${pct(d.tp)})`, up ? yT - 12 : yT + 12, "#089981");
    tag(`Stop ${fmtPrice(d.sl, this.dec)} (${pct(d.sl)})`, up ? yS + 12 : yS - 12, "#f23645");
    if (sel || cur != null) tag(`${long ? "Long" : "Short"} ${fmtPrice(d.entry, this.dec)} · R/Ö ${fmtPrice(rr, 2)}`, yE + (up ? 13 : -13), "#363a45");
    if (sel) { this.handle(x1, yE, "#d1d4dc"); this.handle(x1, yT, "#089981"); this.handle(x1, yS, "#f23645"); this.handle(x2, yE, "#d1d4dc"); }
  }
  drawRuler(r) {
    const ctx = this.ctx, a = this.pt(r.a), b = this.pt(r.b), up = r.b.p >= r.a.p;
    ctx.fillStyle = up ? "rgba(41,98,255,0.22)" : "rgba(242,54,69,0.22)"; ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.strokeStyle = up ? "#2962ff" : "#f23645"; ctx.lineWidth = 1; ctx.beginPath();
    const xm = (a.x + b.x) / 2, ym = (a.y + b.y) / 2; ctx.moveTo(xm, a.y); ctx.lineTo(xm, b.y); ctx.moveTo(a.x, ym); ctx.lineTo(b.x, ym); ctx.stroke();
    const dp = r.b.p - r.a.p, pc = (dp / r.a.p) * 100, bars = Math.round(this.timeToIdx(r.b.t) - this.timeToIdx(r.a.t));
    const dur = Math.abs(r.b.t - r.a.t), hh = Math.floor(dur / 36e5), mm = Math.round((dur % 36e5) / 6e4);
    const durS = hh >= 24 ? `${Math.floor(hh / 24)}g ${hh % 24}s` : `${hh}s ${mm}dk`;
    const l1 = `${dp >= 0 ? "+" : ""}${fmtPrice(dp, this.dec)} (${pc >= 0 ? "+" : ""}${fmtPrice(pc, 2)}%)`, l2 = `${bars} bar, ${durS}`;
    ctx.font = "12px " + FAM; const w = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width) + 16;
    const ly = up ? Math.min(a.y, b.y) - 44 : Math.max(a.y, b.y) + 6;
    ctx.fillStyle = up ? "#2962ff" : "#f23645"; rrect(ctx, xm - w / 2, ly, w, 38, 4); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(l1, xm, ly + 11); ctx.fillText(l2, xm, ly + 27);
  }

  // ---------- axes ----------
  axisLabel(y, text, bg, fg = "#fff", h = 18) {
    const ctx = this.ctx; ctx.fillStyle = bg; ctx.fillRect(this.plotW + 1, y - h / 2, AXIS_W - 1, h);
    ctx.fillStyle = fg; ctx.font = FONT; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(text, this.plotW + 6, y + 0.5);
  }
  drawPriceAxis(ticks) {
    const ctx = this.ctx, pw = this.plotW, mh = this.mainH;
    ctx.fillStyle = C.bg; ctx.fillRect(pw, 0, AXIS_W, this.H);
    ctx.strokeStyle = C.border; ctx.beginPath(); ctx.moveTo(pw + 0.5, 0); ctx.lineTo(pw + 0.5, this.H); ctx.stroke();
    ctx.font = FONT; ctx.fillStyle = C.text; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ticks.forEach((v) => { const y = this.yOf(v); if (y > 8 && y < mh - 8) ctx.fillText(fmtPrice(v, this.dec), pw + 6, y); });
    if (this.hasRsi) {
      this.priceTicks(this.rMin, this.rMax, this.rsiH).forEach((v) => { const y = this.ryOf(v); if (y > this.rsiTop + 8 && y < this.rsiTop + this.rsiH - 8) ctx.fillText(fmtPrice(v, 2), pw + 6, y); });
      const li = this.bars.length - 1;
      (this.rov.plots || []).forEach((p) => { const v = p.data[li]; if (!isNaN(v)) this.axisLabel(Math.max(this.rsiTop + 9, Math.min(this.rsiTop + this.rsiH - 9, this.ryOf(v))), fmtPrice(v, 2), p.color); });
    }
    // alarms tags
    this.tagRects = [];
    this.alarms.forEach((a) => {
      const y = this.yOf(a.price); if (y < 0 || y > mh) return;
      const x = pw + 1;
      if (this.openAlarm !== a.id) {
        // small TradingView-like notch pointing to the alarm price
        ctx.fillStyle = C.alarm; ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(x + 6, y - 6); ctx.lineTo(x + 16, y - 6); ctx.lineTo(x + 16, y + 6); ctx.lineTo(x + 6, y + 6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(x + 10.5, y - 0.5, 2.6, Math.PI, 0); ctx.lineTo(x + 13.3, y + 2.5); ctx.lineTo(x + 7.7, y + 2.5); ctx.closePath(); ctx.fill();
        this.tagRects.push({ x, y: y - 8, w: 22, h: 16, id: a.id, small: true });
        return;
      }
      const w = AXIS_W - 2, h = 22;
      ctx.fillStyle = "#1e1608"; ctx.fillRect(x, y - h / 2, w, h);
      ctx.strokeStyle = C.alarm; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y - h / 2 + 0.5, w - 1, h - 1);
      const pt = fmtPrice(a.price, this.dec); let fs = 11; ctx.font = fs + "px " + FAM;
      while (fs > 8 && ctx.measureText(pt).width > w - 30) { fs -= 0.5; ctx.font = fs + "px " + FAM; }
      ctx.fillStyle = C.alarm; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(pt, x + 4, y + 0.5);
      ctx.fillStyle = "rgba(224,160,32,0.35)"; ctx.fillRect(x + w - 22, y - h / 2 + 1, 21, h - 2);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.8; ctx.beginPath();
      ctx.moveTo(x + w - 15.5, y - 4.5); ctx.lineTo(x + w - 6.5, y + 4.5); ctx.moveTo(x + w - 6.5, y - 4.5); ctx.lineTo(x + w - 15.5, y + 4.5); ctx.stroke(); ctx.lineWidth = 1;
      this.tagRects.push({ x, y: y - h / 2, w, h, id: a.id });
    });
    // last price + countdown
    const last = this.bars[this.bars.length - 1];
    if (last) {
      const y = this.yOf(last.c), col = last.c >= last.o ? C.up : C.down;
      ctx.strokeStyle = col; ctx.setLineDash([1, 2]); ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(pw, Math.round(y) + 0.5); ctx.stroke(); ctx.setLineDash([]);
      if (y > -10 && y < mh + 10) {
        const yy = Math.max(9, Math.min(mh - 27, y));
        this.axisLabel(yy, fmtPrice(last.c, this.dec), col);
        this.axisLabel(yy + 17, fmtCountdown(last.t + this.tf - Date.now()), col, "#fff", 16);
      }
    }
    if (this.cross) {
      const { y, pane } = this.cross;
      if (pane === "main") {
        this.axisLabel(y, fmtPrice(this.pOf(y), this.dec), "#363a45");
        if (this.showPlus()) {
          const px = pw - 14; ctx.beginPath(); ctx.arc(px, y, 9, 0, Math.PI * 2); ctx.fillStyle = "#2a2e39"; ctx.fill(); ctx.strokeStyle = "#787b86"; ctx.stroke();
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px - 4, y); ctx.lineTo(px + 4, y); ctx.moveTo(px, y - 4); ctx.lineTo(px, y + 4); ctx.stroke(); ctx.lineWidth = 1;
        }
      } else if (pane === "rsi") this.axisLabel(y, fmtPrice(this.rvOf(y), 2), "#363a45");
    }
    if (!this.auto) {
      const by = this.mainH - 20; ctx.fillStyle = "#2a2e39"; rrect(ctx, pw + AXIS_W / 2 - 22, by, 44, 16, 3); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 10px " + FAM; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("Sıfırla", pw + AXIS_W / 2, by + 8.5);
    }
    if (this.hasRsi && this.rAuto === false) {
      const by = this.rsiTop + this.rsiH - 20; ctx.fillStyle = "#2a2e39"; rrect(ctx, pw + AXIS_W / 2 - 22, by, 44, 16, 3); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 10px " + FAM; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("Sıfırla", pw + AXIS_W / 2, by + 8.5);
    }
    if (!this.auto) { ctx.fillStyle = "#ffffff"; ctx.font = "bold 10px " + FAM; ctx.textAlign = "center"; ctx.fillText("A", pw + AXIS_W / 2, this.H - TIME_H / 2); }
    else { ctx.fillStyle = "#50535e"; ctx.font = "bold 10px " + FAM; ctx.textAlign = "center"; ctx.fillText("A", pw + AXIS_W / 2, this.H - TIME_H / 2); }
  }
  showPlus() { return this.tool === "cursor" && !this.creating && this.cross && this.cross.pane === "main" && (this.cross.touch || this.cross.x > this.plotW - 140); }
  drawTimeAxis(ticks) {
    const ctx = this.ctx, y0 = this.H - TIME_H;
    ctx.fillStyle = C.bg; ctx.fillRect(0, y0, this.plotW, TIME_H);
    ctx.strokeStyle = C.border; ctx.beginPath(); ctx.moveTo(0, y0 + 0.5); ctx.lineTo(this.W, y0 + 0.5); ctx.stroke();
    ctx.font = "12px " + FAM; ctx.fillStyle = C.text; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ticks.forEach((t) => ctx.fillText(t.label, t.x, y0 + TIME_H / 2));
    if (this.cross && this.cross.i != null) {
      const t = this.idxToTime(this.cross.i), d = new Date(t + TZ), p = (n) => String(n).padStart(2, "0");
      const txt = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}  ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
      const w = ctx.measureText(txt).width + 14, x = this.xOf(this.cross.i);
      ctx.fillStyle = "#363a45"; ctx.fillRect(x - w / 2, y0 + 1, w, TIME_H - 2); ctx.fillStyle = "#fff"; ctx.fillText(txt, x, y0 + TIME_H / 2);
    }
  }
  drawCrosshair() {
    if (!this.cross) return; const ctx = this.ctx, { y, i, pane } = this.cross;
    ctx.strokeStyle = C.cross; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath();
    if (i != null) { const x = Math.round(this.xOf(i)) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, this.H - TIME_H); }
    if (pane) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(this.plotW, Math.round(y) + 0.5); }
    ctx.stroke(); ctx.setLineDash([]);
  }

  // ---------- interaction ----------
  pos(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  region(x, y) {
    if (this.hasRsi && Math.abs(y - (this.mainH + DIV / 2)) <= 5 && x < this.W) return "divider";
    if (y > this.H - TIME_H) return x > this.plotW ? "corner" : "taxis";
    if (x > this.plotW) return y < this.mainH ? "paxis" : "raxis";
    if (this.hasRsi && y >= this.rsiTop) return "rsi";
    return y < this.mainH ? "main" : "none";
  }
  setCross(x, y, touch) {
    const reg = this.region(x, y); const pane = reg === "main" || reg === "paxis" ? "main" : reg === "rsi" || reg === "raxis" ? "rsi" : null;
    const i = x <= this.plotW ? Math.round(this.idxOf(x)) : null;
    let yy = y;
    if (pane === "main" && x <= this.plotW && this.magnet && this.bars[i]) yy = this.snapY(i, y);
    this.cross = { x: Math.min(x, this.plotW), y: yy, i: i ?? (this.cross?.i ?? null), pane, touch };
    if (x > this.plotW) this.cross.i = null;
    this.dirty();
  }
  snapY(i, y) {
    const b = this.bars[i]; let best = y, bd = 28;
    [b.o, b.h, b.l, b.c].forEach((p) => { const d = Math.abs(this.yOf(p) - y); if (d < bd) { bd = d; best = this.yOf(p); } });
    return best;
  }
  point(x, y) {
    const fi = this.idxOf(x), i = Math.round(fi);
    if (this.magnet && this.bars[i]) {
      const b = this.bars[i]; let best = null, bd = 28;
      [b.o, b.h, b.l, b.c].forEach((p) => { const d = Math.abs(this.yOf(p) - y); if (d < bd) { bd = d; best = p; } });
      if (best != null) return { t: b.t, p: best };
    }
    return { t: this.idxToTime(fi), p: this.roundP(this.pOf(y)) };
  }
  roundP(p) { const t = +this.tick || 0.01; return +(Math.round(p / t) * t).toFixed(this.dec); }
  hitTest(x, y, touch) {
    const tol = touch ? 14 : 7;
    for (let k = this.drawings.length - 1; k >= 0; k--) {
      const d = this.drawings[k];
      if (d.type === "trendline") {
        const a = this.pt(d.p1), b = this.pt(d.p2);
        if (Math.hypot(x - a.x, y - a.y) < tol + 3) return { d, h: "p1" };
        if (Math.hypot(x - b.x, y - b.y) < tol + 3) return { d, h: "p2" };
        if (distSeg(x, y, a.x, a.y, b.x, b.y) < tol) return { d, h: null };
      } else if (d.type === "hray") {
        const a = this.pt(d.p1);
        if (Math.hypot(x - a.x, y - a.y) < tol + 3) return { d, h: "p1" };
        if (Math.abs(y - a.y) < tol && x >= a.x - tol) return { d, h: null };
      } else if (d.type === "vline") {
        const xl = this.xOfT(d.p1.t);
        if (Math.abs(x - xl) < tol) return { d, h: null };
      } else if (d.type === "rect" || d.type === "fib") {
        const a = this.pt(d.p1), b = this.pt(d.p2);
        if (Math.hypot(x - a.x, y - a.y) < tol + 3) return { d, h: "p1" };
        if (Math.hypot(x - b.x, y - b.y) < tol + 3) return { d, h: "p2" };
        if (d.type === "rect") {
          if (Math.hypot(x - a.x, y - b.y) < tol + 3) return { d, h: "c1" };
          if (Math.hypot(x - b.x, y - a.y) < tol + 3) return { d, h: "c2" };
        }
        const inX = x >= Math.min(a.x, b.x) - tol && x <= Math.max(a.x, b.x) + tol;
        if (d.type === "rect" && inX && y >= Math.min(a.y, b.y) - tol && y <= Math.max(a.y, b.y) + tol) return { d, h: null };
        if (d.type === "fib" && inX && fibLevels(d).some((level) => level.visible !== false && Math.abs(y - this.yOf(d.reverse ? d.p1.p + (d.p2.p - d.p1.p) * Number(level.value) : d.p2.p - (d.p2.p - d.p1.p) * Number(level.value))) < tol)) return { d, h: null };
      } else if (d.type === "text") {
        const a = this.pt(d.p1), size = Math.max(8, Math.min(48, Number(d.fontSize) || 14));
        const ctx = this.ctx; ctx.save(); ctx.font = `${size}px ${FAM}`;
        const w = ctx.measureText(String(d.text || "")).width; ctx.restore();
        if (x >= a.x - tol && x <= a.x + w + tol && y >= a.y - size / 2 - tol && y <= a.y + size / 2 + tol) return { d, h: null };
      } else if (d.type === "long" || d.type === "short") {
        const x1 = this.xOfT(d.t1), x2 = this.xOfT(d.t2), yE = this.yOf(d.entry), yT = this.yOf(d.tp), yS = this.yOf(d.sl);
        for (const [h, hx, hy] of [["entry", x1, yE], ["tp", x1, yT], ["sl", x1, yS], ["right", x2, yE]]) if (Math.hypot(x - hx, y - hy) < tol + 3) return { d, h };
        if (x >= x1 && x <= x2 && y >= Math.min(yT, yS) && y <= Math.max(yT, yS)) return { d, h: null };
      }
    }
    return null;
  }
  plusHit(x, y, touch) { return this.showPlus() && Math.hypot(x - (this.plotW - 14), y - this.cross.y) < (touch ? 16 : 11); }
  tagHit(x, y, pad = 0) { return this.tagRects.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y - pad && y <= r.y + r.h + pad); }

  on_contextmenu(e) { e.preventDefault(); }
  on_pointerdown(e) {
    e.preventDefault(); this.canvas.setPointerCapture?.(e.pointerId);
    const p = this.pos(e), touch = e.pointerType !== "mouse"; this.pointers.set(e.pointerId, p); this.lastTouch = touch;
    this.cb.onInteract?.();
    if (this.pointers.size === 2) {
      clearTimeout(this.lp); const [a, b] = [...this.pointers.values()];
      const mx = (a.x + b.x) / 2;
      this.mode = { k: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), sp0: this.spacing, anchor: this.idxOf(mx), mx0: mx, r0: this.rightIdx };
      this.creating = this.creating?.d && this.creating.k === "drag" ? null : this.creating; return;
    }
    const reg = this.region(p.x, p.y);
    if ((reg === "main" || reg === "paxis") && this.plusHit(p.x, p.y, touch)) { this.cb.onAddAlarm?.(this.roundP(this.pOf(this.cross.y))); this.mode = { k: "none" }; return; }
    if (reg === "paxis") {
      const t = this.tagHit(p.x, p.y, touch ? 6 : 0);
      if (t) {
        if (t.small) this.openAlarm = t.id;
        else if (p.x > t.x + t.w - (touch ? 34 : 26)) { this.cb.onDeleteAlarm?.(t.id); this.openAlarm = null; }
        else this.openAlarm = null;
        this.dirty(); this.mode = { k: "none" }; return;
      }
    }
    if (this.openAlarm) { this.openAlarm = null; this.dirty(); }
    if (this.ruler && this.tool !== "ruler" && !this.creating) { this.ruler = null; this.dirty(); }
    if (reg === "divider") { this.mode = { k: "divider" }; return; }
    if (reg === "paxis" && !this.auto && p.y > this.mainH - 22) { this.auto = true; this.dirty(); this.mode = { k: "none" }; return; }
    if (reg === "paxis") { this.mode = { k: "scaleP", y0: p.y, min: this.pMin, max: this.pMax }; this.auto = false; return; }
    if (reg === "raxis" && this.hasRsi) {
      if (this.rAuto === false && p.y > this.rsiTop + this.rsiH - 22) { this.rAuto = true; this.dirty(); this.mode = { k: "none" }; return; }
      if (this.lastRTap && Date.now() - this.lastRTap < 300) { this.rAuto = true; this.dirty(); this.mode = { k: "none" }; return; }
      this.lastRTap = Date.now(); this.mode = { k: "scaleR", y0: p.y, min: this.rMin, max: this.rMax }; this.rAuto = false; return;
    }
    if (reg === "taxis") { this.mode = { k: "scaleT", x0: p.x, sp0: this.spacing, r0: this.rightIdx }; return; }
    if (reg === "corner") { this.auto = true; this.rAuto = true; this.dirty(); this.mode = { k: "none" }; return; }
    if (reg === "main" && this.tool !== "cursor" && touch) {
      const c = this.cross?.pane === "main" ? this.cross : { x: p.x, y: p.y };
      this.mode = { k: "aim", fx: p.x, fy: p.y, cx: c.x, cy: c.y, t0: Date.now(), moved: false }; this.aimMove(p); return;
    }
    if (reg === "main" && this.tool !== "cursor") return this.startCreate(p, touch);
    if (reg === "main" || reg === "rsi") {
      const hit = reg === "main" ? this.hitTest(p.x, p.y, touch) : null;
      if (hit) {
        this.select(hit.d);
        this.mode = { k: "edit", hit, x0: p.x, y0: p.y, orig: JSON.parse(JSON.stringify(hit.d)), moved: false };
        return;
      }
      if (this.selected) this.select(null);
      this.mode = { k: "pan", x0: p.x, y0: p.y, r0: this.rightIdx, min: this.pMin, max: this.pMax, rmin: this.rMin, rmax: this.rMax, pane: reg, moved: false, touch, t0: Date.now() };
      if (touch) this.lp = setTimeout(() => { if (this.mode?.k === "pan" && !this.mode.moved) { this.mode = { k: "cross" }; this.setCross(p.x, p.y, true); navigator.vibrate?.(10); } }, 380);
    }
  }
  startCreate(p, touch) {
    const pt = this.point(p.x, p.y), t = this.tool;
    if (this.creating && this.creating.k === "await") { this.finishCreate(pt); this.mode = { k: "none" }; return; }
    if (t === "text") {
      const value = window.prompt("Grafiğe eklenecek metni yazın:", "");
      if (value != null && value.trim()) {
        const d = { id: uid(), type: "text", p1: pt, text: value.trim(), color: "#d1d4dc", fontSize: 14 };
        this.drawings.push(d); this.emitDrawings(); this.select(d);
      }
      this.tool = "cursor"; this.cb.onToolDone?.(); this.mode = { k: "none" }; this.dirty(); return;
    }
    if (TWO.includes(t)) this.creating = { k: "drag", d: { id: uid(), type: t, p1: pt, p2: { ...pt }, ...DEF_STYLE, ...this.defaults[t], ...(t === "fib" ? { levels: fibDefaults(), showFill: true, reverse: false } : {}) }, x0: p.x, y0: p.y };
    else if (t === "ruler") { this.ruler = { a: pt, b: { ...pt } }; this.creating = { k: "drag", ruler: true, x0: p.x, y0: p.y }; }
    else if (t === "hray" || t === "vline") { this.creating = { k: "drag", one: true, d: { id: uid(), type: t, p1: pt, ...DEF_STYLE, ...this.defaults[t] } }; }
    else if (t === "long" || t === "short") {
      const rng = this.pMax - this.pMin, s = t === "long" ? 1 : -1;
      this.creating = { k: "drag", one: true, d: { id: uid(), type: t, t1: pt.t, t2: this.idxToTime(this.timeToIdx(pt.t) + 25), entry: pt.p, tp: this.roundP(pt.p + s * rng * 0.1), sl: this.roundP(pt.p - s * rng * 0.05) } };
    }
    this.mode = { k: "create", touch }; this.dirty();
  }
  aimPos(p) {
    const m = this.mode?.k === "aim" ? this.mode : { fx: p.x, fy: p.y, cx: p.x, cy: p.y };
    return { x: Math.max(1, Math.min(this.plotW - 1, m.cx + p.x - m.fx)), y: Math.max(1, Math.min(this.mainH - 1, m.cy + p.y - m.fy)) };
  }
  aimMove(fp) {
    const p = this.aimPos(fp);
    this.setCross(p.x, p.y, true);
    if (this.creating?.k === "await") { const pt = this.point(p.x, p.y); if (this.creating.ruler) this.ruler.b = pt; else if (this.creating.d) this.creating.d.p2 = pt; }
    this.dirty();
  }
  aimPlace(fp) {
    const p = this.aimPos(fp), pt = this.point(p.x, p.y), t = this.tool;
    if (this.creating?.k === "await") return this.finishCreate(pt);
    if (t === "text") { this.startCreate(p, true); this.mode = null; return; }
    if (TWO.includes(t)) this.creating = { k: "await", d: { id: uid(), type: t, p1: pt, p2: { ...pt }, ...DEF_STYLE, ...this.defaults[t], ...(t === "fib" ? { levels: fibDefaults(), showFill: true, reverse: false } : {}) } };
    else if (t === "ruler") { this.ruler = { a: pt, b: { ...pt } }; this.creating = { k: "await", ruler: true }; }
    else {
      this.startCreate(p, true); this.mode = null; this.finishCreate(null);
    }
    this.dirty();
  }
  finishCreate(pt) {
    const c = this.creating; this.creating = null;
    if (c.ruler) { if (pt) this.ruler.b = pt; }
    else if (c.d) {
      if (pt && c.d.p2) c.d.p2 = pt;
      this.drawings.push(c.d); this.emitDrawings(); this.select(c.d);
    }
    this.tool = "cursor"; this.cb.onToolDone?.(); this.dirty();
  }
  on_pointermove(e) {
    const p = this.pos(e), touch = e.pointerType !== "mouse";
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    const m = this.mode;
    if (m?.k === "pinch" && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2;
      this.spacing = Math.max(0.6, Math.min(80, m.sp0 * (d / Math.max(10, m.d0))));
      this.rightIdx = m.anchor + (this.plotW - mx) / this.spacing; this.clampView(); this.dirty(); return;
    }
    if (!touch && !m) { this.setCross(p.x, p.y, false); this.updateCursor(p); }
    if (this.creating?.k === "await") {
      const pt = this.point(p.x, p.y);
      if (this.creating.ruler) this.ruler.b = pt; else if (this.creating.d) this.creating.d.p2 = pt;
      this.dirty();
    }
    if (!m) return;
    if (m.k === "create" && this.creating) {
      const pt = this.point(p.x, p.y), c = this.creating;
      if (c.one) { if (c.d.p1) c.d.p1 = pt; else { const dE = pt.p - c.d.entry; c.d.entry = pt.p; c.d.tp += dE; c.d.sl += dE; const dt = pt.t - c.d.t1; c.d.t1 = pt.t; c.d.t2 += dt; } }
      else { c.dragged = c.dragged || Math.hypot(p.x - c.x0, p.y - c.y0) > 6; if (c.ruler) this.ruler.b = pt; else c.d.p2 = pt; }
      if (touch) this.setCross(p.x, p.y, true); this.dirty(); return;
    }
    if (m.k === "pan") {
      const dx = p.x - m.x0, dy = p.y - m.y0;
      if (!m.moved && Math.hypot(dx, dy) > 6) { m.moved = true; clearTimeout(this.lp); if (touch) this.cross = null; }
      if (!m.moved) return;
      this.rightIdx = m.r0 - dx / this.spacing;
      if (m.pane === "rsi" && this.rAuto === false) { const k = (m.rmax - m.rmin) / this.rsiH; this.rMin = m.rmin + dy * k; this.rMax = m.rmax + dy * k; }
      else if (m.pane !== "rsi" && !this.auto) { const k = (m.max - m.min) / this.mainH; this.pMin = m.min + dy * k; this.pMax = m.max + dy * k; }
      this.clampView(); this.maybeMore(); this.dirty(); return;
    }
    if (m.k === "cross") { this.setCross(p.x, p.y, true); return; }
    if (m.k === "aim") { if (Math.hypot(p.x - m.fx, p.y - m.fy) > 8) m.moved = true; this.aimMove(p); return; }
    if (m.k === "edit") {
      const { hit, orig } = m; const d = hit.d;
      if (!m.moved && Math.hypot(p.x - m.x0, p.y - m.y0) < 3) return; m.moved = true;
      const pt = this.point(p.x, p.y);
      if (hit.h) {
        if (hit.h === "p1" || hit.h === "p2") d[hit.h] = pt;
        else if (hit.h === "c1") { d.p1 = { t: pt.t, p: d.p1.p }; d.p2 = { t: d.p2.t, p: pt.p }; }
        else if (hit.h === "c2") { d.p2 = { t: pt.t, p: d.p2.p }; d.p1 = { t: d.p1.t, p: pt.p }; }
        else if (hit.h === "entry") { d.entry = pt.p; d.t1 = pt.t; }
        else if (hit.h === "tp") d.tp = pt.p; else if (hit.h === "sl") d.sl = pt.p; else if (hit.h === "right") d.t2 = Math.max(pt.t, d.t1 + this.tf);
        const cp = { p1: d.p1?.p, p2: d.p2?.p, entry: d.entry, tp: d.tp, sl: d.sl, right: d.entry, c1: pt.p, c2: pt.p }[hit.h];
        if (cp != null) this.cross = { x: p.x, y: this.yOf(cp), i: Math.round(this.idxOf(p.x)), pane: "main", touch };
      } else {
        const di = this.idxOf(p.x) - this.idxOf(m.x0), dp = this.pOf(p.y) - this.pOf(m.y0);
        const mt = (t) => this.idxToTime(this.timeToIdx(t) + di), mp = (v) => this.roundP(v + dp);
        if (orig.p1) d.p1 = { t: mt(orig.p1.t), p: mp(orig.p1.p) };
        if (orig.p2) d.p2 = { t: mt(orig.p2.t), p: mp(orig.p2.p) };
        if (orig.t1 != null) { d.t1 = mt(orig.t1); d.t2 = mt(orig.t2); d.entry = mp(orig.entry); d.tp = mp(orig.tp); d.sl = mp(orig.sl); }
        this.cross = { x: p.x, y: p.y, i: Math.round(this.idxOf(p.x)), pane: "main", touch };
      }
      this.dirty(); return;
    }
    if (m.k === "scaleP") {
      const f = Math.exp((p.y - m.y0) * 0.006), c = (m.min + m.max) / 2, h = ((m.max - m.min) / 2) * f;
      this.pMin = c - h; this.pMax = c + h; this.dirty(); return;
    }
    if (m.k === "scaleR") {
      const f = Math.exp((p.y - m.y0) * 0.006), c = (m.min + m.max) / 2, h = ((m.max - m.min) / 2) * f;
      this.rMin = c - h; this.rMax = c + h; this.dirty(); return;
    }
    if (m.k === "scaleT") {
      this.spacing = Math.max(0.6, Math.min(80, m.sp0 * Math.exp((p.x - m.x0) * 0.008)));
      this.clampView(); this.maybeMore(); this.dirty(); return;
    }
    if (m.k === "divider") {
      const a = this.H - TIME_H; const r = 1 - p.y / a; this.rsiRatio = Math.max(0.1, Math.min(0.7, r)); this.dirty();
    }
  }
  on_pointerup(e) {
    const p = this.pos(e), touch = e.pointerType !== "mouse"; this.pointers.delete(e.pointerId); clearTimeout(this.lp);
    const m = this.mode;
    if (m?.k === "pinch") { if (this.pointers.size === 0) this.mode = null; return; }
    this.mode = null;
    if (!m) return;
    if (m.k === "aim") {
      // only a tap places a point; dragging just moves the crosshair
      if (!m.moved && Date.now() - m.t0 < 500) { this.mode = m; this.aimPlace({ x: m.fx, y: m.fy }); this.mode = null; }
      return;
    }
    if (m.k === "create" && this.creating) {
      const c = this.creating;
      if (c.one || c.dragged) this.finishCreate(c.one ? null : this.point(p.x, p.y));
      else c.k = "await";
      if (touch) this.cross = null; this.dirty(); return;
    }
    if (m.k === "edit" && m.moved) { this.emitDrawings(); this.cb.onSelect?.({ ...m.hit.d }); }
    if (m.k === "pan" && !m.moved && touch) { if (this.cross) this.cross = null; else this.setCross(p.x, p.y, true); this.dirty(); }
    if (m.k === "divider") this.cb.onRsiRatio?.(this.rsiRatio);
  }
  on_pointercancel(e) { this.pointers.delete(e.pointerId); this.mode = null; clearTimeout(this.lp); }
  on_pointerleave(e) { if (e.pointerType === "mouse" && !this.mode) { this.cross = null; this.dirty(); } }
  on_dblclick(e) {
    const p = this.pos(e), r = this.region(p.x, p.y);
    if (r === "main") {
      const hit = this.hitTest(p.x, p.y, false);
      if (hit?.d?.type === "text") {
        const value = window.prompt("Metni düzenle:", hit.d.text || "");
        if (value != null) {
          if (value.trim()) hit.d.text = value.trim();
          else this.drawings = this.drawings.filter((d) => d !== hit.d);
          this.select(value.trim() ? hit.d : null); this.emitDrawings(); this.dirty();
        }
        return;
      }
    }
    if (r === "paxis" || r === "taxis") { this.auto = true; this.dirty(); }
    if (r === "raxis") { this.rAuto = true; this.dirty(); }
  }
  on_wheel(e) {
    e.preventDefault(); const p = this.pos(e);
    if (this.region(p.x, p.y) === "raxis" && this.hasRsi) {
      this.rAuto = false; const f = Math.exp(e.deltaY * 0.0015), c = (this.rMin + this.rMax) / 2, h = ((this.rMax - this.rMin) / 2) * f;
      this.rMin = c - h; this.rMax = c + h; this.dirty(); return;
    }
    if (this.region(p.x, p.y) === "paxis") {
      this.auto = false; const f = Math.exp(e.deltaY * 0.0015), c = (this.pMin + this.pMax) / 2, h = ((this.pMax - this.pMin) / 2) * f;
      this.pMin = c - h; this.pMax = c + h; this.dirty(); return;
    }
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { this.rightIdx += e.deltaX / this.spacing; }
    else {
      const anchor = this.idxOf(Math.min(p.x, this.plotW));
      this.spacing = Math.max(0.6, Math.min(80, this.spacing * Math.exp(-e.deltaY * 0.0018)));
      this.rightIdx = anchor + (this.plotW - Math.min(p.x, this.plotW)) / this.spacing;
    }
    this.clampView(); this.maybeMore(); this.dirty();
  }
  onKey(e) {
    if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    if ((e.key === "Delete" || e.key === "Backspace") && this.selected) { e.preventDefault(); this.deleteSelected(); }
    if (e.key === "Escape") { this.creating = null; this.ruler = null; this.tool = "cursor"; this.cb.onToolDone?.(); this.select(null); }
  }
  updateCursor(p) {
    const reg = this.region(p.x, p.y); let c = this.tool !== "cursor" ? "crosshair" : "crosshair";
    if (reg === "paxis" || reg === "raxis") c = this.tagHit(p.x, p.y) ? "pointer" : "ns-resize";
    else if (reg === "taxis") c = "ew-resize"; else if (reg === "divider") c = "row-resize";
    else if (reg === "main" && (this.plusHit(p.x, p.y) || (this.tool === "cursor" && this.hitTest(p.x, p.y)))) c = "pointer";
    this.canvas.style.cursor = c;
  }
  clampView() {
    const n = this.bars.length; const vis = this.plotW / this.spacing;
    this.rightIdx = Math.max(Math.min(5, n - 1), Math.min(n - 1 + vis * 0.85, this.rightIdx));
  }
  maybeMore() { if (this.idxOf(0) < 40 && this.cb.onNeedMore) this.cb.onNeedMore(); }
}
