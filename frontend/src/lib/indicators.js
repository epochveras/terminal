// Technical analysis helpers + Epoch Script / CakmaUstad RSI ports
export const PINE = {
  aqua: "#00BCD4", black: "#363A45", blue: "#2196F3", fuchsia: "#E040FB", gray: "#787B86", green: "#4CAF50",
  lime: "#00E676", maroon: "#880E4F", navy: "#311B92", olive: "#808000", orange: "#FF9800", purple: "#9C27B0",
  red: "#FF5252", silver: "#B2B5BE", teal: "#00897B", white: "#FFFFFF", yellow: "#FFEB3B",
};
export const alpha = (hex, a) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export function sma(src, len) {
  const out = new Array(src.length).fill(NaN); let sum = 0, cnt = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i]; if (isNaN(v)) continue;
    sum += v; cnt++;
    if (cnt > len) { let j = i - len; while (isNaN(src[j])) j--; sum -= src[j]; cnt--; }
    if (cnt === len) out[i] = sum / len;
  }
  return out;
}
function smooth(src, len, a) {
  const out = new Array(src.length).fill(NaN); let prev = NaN, buf = [];
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (isNaN(v)) { out[i] = prev; continue; }
    if (isNaN(prev)) { buf.push(v); if (buf.length === len) { prev = buf.reduce((x, y) => x + y, 0) / len; out[i] = prev; } continue; }
    prev = a * v + (1 - a) * prev; out[i] = prev;
  }
  return out;
}
export const ema = (src, len) => smooth(src, len, 2 / (len + 1));
export const rma = (src, len) => smooth(src, len, 1 / len);
export function rsiCalc(src, len) {
  const up = [], dn = [];
  for (let i = 0; i < src.length; i++) {
    const ch = i === 0 ? NaN : src[i] - src[i - 1];
    up.push(isNaN(ch) ? NaN : Math.max(ch, 0)); dn.push(isNaN(ch) ? NaN : -Math.min(ch, 0));
  }
  const u = rma(up, len), d = rma(dn, len);
  return u.map((x, i) => (isNaN(x) || isNaN(d[i]) ? NaN : d[i] === 0 ? 100 : x === 0 ? 0 : 100 - 100 / (1 + x / d[i])));
}
export function atr(bars, len) {
  const tr = bars.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))));
  return rma(tr, len);
}
export function wma(src, len) {
  const out = new Array(src.length).fill(NaN), den = (len * (len + 1)) / 2;
  for (let i = len - 1; i < src.length; i++) { let sum = 0, ok = true; for (let j = 0; j < len; j++) { const v = src[i - j]; if (isNaN(v)) { ok = false; break; } sum += v * (len - j); } if (ok) out[i] = sum / den; }
  return out;
}
export function maOf(type, src, len, vol) {
  if (type === "ema") return ema(src, len);
  if (type === "rma") return rma(src, len);
  if (type === "wma") return wma(src, len);
  if (type === "hma") { const a = wma(src, Math.max(1, Math.floor(len / 2))), b = wma(src, len); return wma(a.map((x, i) => 2 * x - b[i]), Math.max(1, Math.round(Math.sqrt(len)))); }
  if (type === "vwma") { const pv = sma(src.map((x, i) => x * vol[i]), len), v = sma(vol, len); return pv.map((x, i) => x / v[i]); }
  return sma(src, len);
}
// value at detection index i (pivot bar is i - right), NaN otherwise
export function pivot(src, left, right, high) {
  const out = new Array(src.length).fill(NaN);
  for (let i = left + right; i < src.length; i++) {
    const p = i - right, v = src[p]; if (isNaN(v)) continue;
    let ok = true;
    for (let j = p - left; j < p && ok; j++) if (isNaN(src[j]) || (high ? src[j] > v : src[j] < v)) ok = false;
    for (let j = p + 1; j <= i && ok; j++) if (isNaN(src[j]) || (high ? src[j] >= v : src[j] <= v)) ok = false;
    if (ok) out[i] = v;
  }
  return out;
}

// ---------------- settings schemas ----------------
const C = (key, label, def, group) => ({ key, label, type: "color", def, group });
const I = (key, label, def, group, min = 1, max = 1000) => ({ key, label, type: "int", def, group, min, max });
const B = (key, label, def, group) => ({ key, label, type: "bool", def, group });
const S = (key, label, def, group, options) => ({ key, label, type: "select", def, group, options });

export const EPOCH_SCHEMA = [
  B("showDiv", "RSI Divergence (tüm grafik)", true, "RSI Divergence"), I("divLength", "RSI Length", 14, "RSI Divergence"),
  S("maType", "Moving Average", "sma", "RSI Divergence", ["sma", "ema", "rma", "hma", "wma", "vwma"]), I("maLength", "MA Length", 200, "RSI Divergence", 5, 1000),
  I("zigzagLength", "Zigzag Length", 13, "RSI Divergence", 2, 100), B("showLabel", "Pivot etiketleri", false, "RSI Divergence"),
  B("showZigzag", "Zigzag çiz", false, "RSI Divergence"), C("zigzagColor", "Zigzag rengi", PINE.yellow, "RSI Divergence"),
  C("textColor", "Etiket yazı rengi", "#000000", "RSI Divergence"), B("showAdjRsi", "Ölçekli RSI çizgisi", false, "RSI Divergence"), C("divRsiColor", "RSI rengi", PINE.blue, "RSI Divergence"),
  B("showPivotColors", "Pivot kırılım mum renkleri", true, "Pivot Kırılım"),
  I("LleftBars", "Sol bar", 10, "Pivot Kırılım"), I("RrightBars", "Sağ bar", 10, "Pivot Kırılım"),
  C("pivotUp", "Long rengi", PINE.green, "Pivot Kırılım"), C("pivotDn", "Short rengi", PINE.red, "Pivot Kırılım"),
  B("showEma1", "EMA 1 göster", true, "EMA"), I("length1", "EMA 1 Uzunluğu", 100, "EMA"), C("ema1Color", "EMA 1 rengi", PINE.yellow, "EMA"),
  B("showEma2", "EMA 2 göster", true, "EMA"), I("length2", "EMA 2 Uzunluğu", 200, "EMA"), C("ema2Color", "EMA 2 rengi", PINE.blue, "EMA"),
  B("showEma3", "EMA 3 göster", true, "EMA"), I("length3", "EMA 3 Uzunluğu", 300, "EMA"), C("ema3Color", "EMA 3 rengi", PINE.gray, "EMA"),
  I("emaWidth", "EMA kalınlığı", 2, "EMA", 1, 4),
  B("showTrend1", "Trendline 1 göster", true, "Trendline"), I("prdl1", "Pivot Period 1", 30, "Trendline", 10, 50), I("PPnum1", "Pivot sayısı 1", 5, "Trendline", 2, 8),
  C("utcol", "Uptrend rengi 1", PINE.lime, "Trendline"), C("dtcol", "Downtrend rengi 1", PINE.red, "Trendline"),
  B("showTrend2", "Trendline 2 göster", true, "Trendline"), I("prdl2", "Pivot Period 2", 20, "Trendline", 10, 50), I("PPnum2", "Pivot sayısı 2", 3, "Trendline", 2, 8),
  C("utcol2", "Uptrend rengi 2", PINE.blue, "Trendline"), C("dtcol2", "Downtrend rengi 2", PINE.orange, "Trendline"),
  I("startyear", "Başlangıç yılı", 2020, "Trendline", 2000, 2100), I("startmonth", "Başlangıç ayı", 1, "Trendline", 1, 12), I("startday", "Başlangıç günü", 1, "Trendline", 1, 31),
  B("sae", "Agresif giriş (sarı mum)", true, "Giriş / EMA Bulutu"), C("saeColor", "Agresif mum rengi", PINE.yellow, "Giriş / EMA Bulutu"),
  B("sce", "Konservatif giriş (mavi mum)", true, "Giriş / EMA Bulutu"), C("sceColor", "Konservatif mum rengi", PINE.aqua, "Giriş / EMA Bulutu"),
  B("st", "Trend üçgenleri (üst/alt)", false, "Giriş / EMA Bulutu"), B("pa", "Konservatif giriş okları", true, "Giriş / EMA Bulutu"),
  I("emaFastLen", "Fast EMA", 38, "Giriş / EMA Bulutu"), I("emaSlowLen", "Slow EMA", 62, "Giriş / EMA Bulutu"),
  C("upColor", "Yükseliş rengi", PINE.green, "Giriş / EMA Bulutu"), C("downColor", "Düşüş rengi", PINE.red, "Giriş / EMA Bulutu"),
  B("showCloud", "EMA bulutu", true, "Giriş / EMA Bulutu"), C("cloudUp", "Bulut yükseliş", PINE.green, "Giriş / EMA Bulutu"),
  C("cloudDown", "Bulut düşüş", PINE.red, "Giriş / EMA Bulutu"), I("cloudOpacity", "Bulut opaklık %", 35, "Giriş / EMA Bulutu", 0, 100),
  B("bull", "Bullish SFP", true, "SFP"), B("bear", "Bearish SFP", true, "SFP"), I("len", "Swings", 5, "SFP"), I("rightBars", "Right Bars", 1, "SFP"),
  B("dSwingLine", "Swing çizgileri", true, "SFP"), B("dOpposLine", "Onay çizgileri", true, "SFP"), B("dSFP_Line", "SFP fitili", true, "SFP"), B("dSFP_Label", "SFP etiketi", true, "SFP"),
  C("colBl", "Bullish renk", "#089981", "SFP"), C("colBr", "Bearish renk", "#f23645", "SFP"),
  B("showSfpTable", "MTF SFP tablosu (üst)", true, "MTF Tablolar"), I("freshBars", "SFP Fresh Bars", 5, "MTF Tablolar"),
  B("showPivotTable", "MTF Pivot tablosu (sağ alt)", true, "MTF Tablolar"),
];
const COLOR_NAMES = Object.keys(PINE);
export const RSI_SCHEMA = [
  S("src", "Source", "close", "RSI", ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4"]),
  I("len1", "RSI Length", 22, "RSI"), I("len2", "RSI-EMA Length", 66, "RSI"),
  C("rsiColor", "RSI rengi", "#8E1599", "RSI"), C("rsiEmaColor", "RSI-EMA rengi", "#ff2cff", "RSI"),
  B("showFill", "RSI/EMA dolgusu", true, "RSI"), C("fillUp", "Dolgu yükseliş", PINE.green, "RSI"), C("fillDown", "Dolgu düşüş", PINE.red, "RSI"),
  I("fillOpacity", "Dolgu opaklık %", 25, "RSI", 0, 100),
  B("showUpper", "Upper Band göster", true, "Bantlar"), I("upper", "Upper Band", 70, "Bantlar", 0, 100),
  B("showLower", "Lower Band göster", true, "Bantlar"), I("lower", "Lower Band", 30, "Bantlar", 0, 100),
  B("showMid", "Upper Line (50) göster", true, "Bantlar"), I("mid", "Upper Line", 50, "Bantlar", 0, 100),
  B("showL58", "Lower Line (58) göster", true, "Bantlar"), I("l58", "Lower Line", 58, "Bantlar", 0, 100),
  B("showL42", "LLower Line (42) göster", true, "Bantlar"), I("l42", "LLower Line", 42, "Bantlar", 0, 100),
  C("bandColor", "Bant rengi", "#787B86", "Bantlar"), B("bandFill", "70-30 arka plan dolgusu", true, "Bantlar"),
  C("bandFillColor", "Arka plan rengi", "#C0C0C0", "Bantlar"), I("bandFillOpacity", "Arka plan opaklık %", 12, "Bantlar", 0, 100),
  I("prd", "Pivot Point Period", 10, "Trend Çizgileri", 5, 50), I("PPnum", "Pivot sayısı", 10, "Trend Çizgileri", 2, 10),
  S("linestylei", "Line Style", "Solid", "Trend Çizgileri", ["Solid", "Dashed"]), I("linewidth", "Line Width", 1, "Trend Çizgileri", 1, 4),
  S("line1_color", "TopLine-Color", "red", "Trend Çizgileri", COLOR_NAMES), S("line2_color", "BottomLine-Color", "blue", "Trend Çizgileri", COLOR_NAMES),
  B("showbroken", "Show Broken Trend Lines", true, "Trend Çizgileri"), B("extendlines", "Extend Lines", false, "Trend Çizgileri"),
  B("showpivot", "Show Pivot Points", false, "Trend Çizgileri"),
  B("showLegend", "Gösterge ismini göster", true, "Görünüm"),
  B("showAtr", "ATR tablosu", true, "ATR"), I("ATRlength", "ATR Length", 14, "ATR"),
];
export const defaultsOf = (schema) => Object.fromEntries(schema.map((x) => [x.key, x.def]));

const emptyOv = () => ({ plots: [], fills: [], barColors: null, shapes: [], segs: [], labels: [], hlines: [], tables: [], info: [], legend: [] });

// ---------------- MTF helpers ----------------
export function sfpState(bars, len, rightBars, freshBars) {
  const hi = bars.map((b) => b.h), lo = bars.map((b) => b.l);
  const ph = pivot(hi, len, rightBars, true), pl = pivot(lo, len, rightBars, false);
  let sH = NaN, sL = NaN, lastBar = NaN, state = 0;
  bars.forEach((b, i) => {
    if (!isNaN(ph[i])) sH = ph[i];
    if (!isNaN(pl[i])) sL = pl[i];
    if (b.h > sH && b.o < sH && b.c < sH) { lastBar = i; state = -1; }
    if (b.l < sL && b.o > sL && b.c > sL) { lastBar = i; state = 1; }
  });
  return !isNaN(lastBar) && bars.length - 1 - lastBar <= freshBars ? state : 0;
}
export function pivotStates(bars, L, R) {
  const hi = bars.map((b) => b.h), lo = bars.map((b) => b.l);
  const ph = pivot(hi, L, R, true), pl = pivot(lo, L, R, false);
  let hp = NaN, lp = NaN, phPrev = NaN, lpPrev = NaN, st = 0; const out = [];
  bars.forEach((b, i) => {
    phPrev = hp; lpPrev = lp;
    if (!isNaN(ph[i])) hp = ph[i];
    if (!isNaN(pl[i])) lp = pl[i];
    const pc = i > 0 ? bars[i - 1].c : NaN;
    if (b.c > hp && pc <= phPrev) st = 1;
    if (b.c < lp && pc >= lpPrev) st = -1;
    out.push(st);
  });
  return out;
}

// ---------------- Epoch Script ----------------
function autoTrend(bars, prdl, PPnum, cUp, cDn, startTs) {
  const segs = []; const n = bars.length; if (!n) return segs;
  const hi = bars.map((b) => b.h), lo = bars.map((b) => b.l), close = bars.map((b) => b.c);
  const ph = pivot(hi, prdl, prdl, true), pl = pivot(lo, prdl, prdl, false);
  const tval = [], tpos = [], bval = [], bpos = [];
  for (let i = 0; i < n; i++) {
    if (!isNaN(ph[i])) { tval.unshift(ph[i]); tpos.unshift(i); }
    if (!isNaN(pl[i])) { bval.unshift(pl[i]); bpos.unshift(i); }
  }
  tval.length = Math.min(tval.length, PPnum); tpos.length = tval.length; bval.length = Math.min(bval.length, PPnum); bpos.length = bval.length;
  if (bars[n - 1].t < startTs) return segs;
  const last = n - 1, maxline = 5; let cLo = 0, cHi = 0;
  for (let p1 = 0; p1 <= PPnum - 2; p1++) {
    let up1 = 0, up2 = 0, uv1 = 0, uv2 = 0;
    if (cLo <= maxline) for (let p2 = PPnum - 1; p2 >= p1 + 1; p2--) {
      const v1 = bval[p1], v2 = bval[p2], q1 = bpos[p1], q2 = bpos[p2];
      if (v1 == null || v2 == null || !(v1 > v2)) continue;
      const diff = (v1 - v2) / (q1 - q2); let hl = v2 + diff, lloc = last, valid = true;
      for (let x = Math.max(0, q2 + 1 - prdl); x <= last; x++) { if (close[x] < hl) { valid = false; break; } lloc = x; hl += diff; }
      if (valid) { uv1 = hl - diff; uv2 = v2; up1 = lloc; up2 = q2; break; }
    }
    let dp1 = 0, dp2 = 0, dv1 = 0, dv2 = 0;
    if (cHi <= maxline) for (let p2 = PPnum - 1; p2 >= p1 + 1; p2--) {
      const v1 = tval[p1], v2 = tval[p2], q1 = tpos[p1], q2 = tpos[p2];
      if (v1 == null || v2 == null || !(v1 < v2)) continue;
      const diff = (v2 - v1) / (q1 - q2); let hl = v2 - diff, lloc = last, valid = true;
      for (let x = Math.max(0, q2 + 1 - prdl); x <= last; x++) { if (close[x] > hl) { valid = false; break; } lloc = x; hl -= diff; }
      if (valid) { dv1 = hl + diff; dv2 = v2; dp1 = lloc; dp2 = q2; break; }
    }
    if (up1 && up2 && cLo < maxline) { cLo++; segs.push({ i1: up2 - prdl, p1: uv2, i2: up1, p2: uv1, color: cUp, width: 1 }); }
    if (dp1 && dp2 && cHi < maxline) { cHi++; segs.push({ i1: dp2 - prdl, p1: dv2, i2: dp1, p2: dv1, color: cDn, width: 1 }); }
  }
  return segs;
}

function divergence(bars, s, ov) {
  const n = bars.length, close = bars.map((b) => b.c);
  let mn = Infinity, mx = -Infinity; bars.forEach((b) => { if (b.l < mn) mn = b.l; if (b.h > mx) mx = b.h; });
  const rsi = rsiCalc(close, s.divLength), ma = maOf(s.maType, close, s.maLength, bars.map((b) => b.v));
  const adj = rsi.map((r) => mn + (r * (mx - mn)) / 100);
  if (s.showAdjRsi) ov.plots.push({ data: adj, color: s.divRsiColor, width: 1, name: "RSI" });
  const L = s.zigzagLength, pv = [];
  for (let i = L - 1; i < n; i++) {
    const v = adj[i]; if (isNaN(v)) continue;
    let hi = true, lo = true;
    for (let j = i - L + 1; j < i; j++) { const w = adj[j]; if (isNaN(w)) continue; if (w > v) hi = false; if (w < v) lo = false; }
    const last = pv[pv.length - 1];
    if (hi) { if (last && last.dir > 0) { if (v > last.v) Object.assign(last, { bar: i, v }); } else pv.push({ dir: 1, bar: i, v }); }
    else if (lo) { if (last && last.dir < 0) { if (v < last.v) Object.assign(last, { bar: i, v }); } else pv.push({ dir: -1, bar: i, v }); }
  }
  const P = pv.slice(-300).map((p) => ({ ...p, price: close[p.bar], rsi: rsi[p.bar], ma: ma[p.bar] }));
  const ratio = (k, f) => { const a = P[k], b = P[k - 1], c = P[k - 2]; if (!b || !c) return 1; const d = Math.abs(f(c) - f(b)); return d ? Math.abs(f(a) - f(b)) / d : 1; };
  const col = (dir, r) => (dir > 0 ? (r > 1 ? PINE.green : PINE.orange) : r > 1 ? PINE.red : PINE.lime);
  const txt = (dir, r) => (dir > 0 ? (r > 1 ? "HH" : "LH") : r > 1 ? "LL" : "HL");
  if (s.showZigzag && P.length > 1) {
    ov.plots.push({ zig: P.map((p) => [p.bar, p.price]), color: s.zigzagColor, width: 1 });
    ov.plots.push({ zig: P.map((p) => [p.bar, p.v]), color: s.zigzagColor, width: 1 });
  }
  for (let k = P.length - 1; k >= 2; k--) {
    const p = P[k], pr = ratio(k, (x) => x.price), rr = ratio(k, (x) => x.rsi);
    let pc = col(p.dir, pr), rc = col(p.dir, rr), pt = txt(p.dir, pr), rt = txt(p.dir, rr), div = 0;
    if (pc !== rc) {
      const lp = P[k - 2];
      const trend = Math.sign(p.ma - lp.ma), dir = Math.sign(lp.dir), sent = Math.sign(rr - pr);
      div = trend === dir && sent < 0 ? 1 : trend !== dir && sent > 0 ? -1 : 0;
      if (div !== 0 && !isNaN(trend)) {
        const dc = dir > 0 ? PINE.red : PINE.green;
        ov.segs.push({ i1: p.bar, p1: p.price, i2: lp.bar, p2: lp.price, color: dc, width: 1 });
        if (s.showAdjRsi) ov.segs.push({ i1: p.bar, p1: p.v, i2: lp.bar, p2: lp.v, color: dc, width: 1 });
        rt = pt = div > 0 ? "D" : "H";
        pc = rc = div > 0 ? (dir > 0 ? PINE.orange : PINE.lime) : dir > 0 ? PINE.red : PINE.green;
      } else div = 0;
    }
    if (s.showLabel || div !== 0) {
      const pos = p.dir > 0 ? "above" : "below";
      ov.labels.push({ i: p.bar, p: p.price, text: pt, bg: pc, color: s.textColor, pos, big: div !== 0 });
      if (s.showAdjRsi) ov.labels.push({ i: p.bar, p: p.v, text: rt, bg: rc, color: s.textColor, pos, big: div !== 0 });
    }
  }
}

function sfp(bars, s, ov) {
  const n = bars.length, hi = bars.map((b) => b.h), lo = bars.map((b) => b.l);
  const ph = pivot(hi, s.len, s.rightBars, true), pl = pivot(lo, s.len, s.rightBars, false);
  const objs = [];
  const mk = (o) => { objs.push(o); return o; };
  const kill = (p) => { [p.sw, p.op, p.wk, p.lb].forEach((o) => o && (o.dead = true)); };
  const run = (bear) => {
    let swing = { bix: NaN, prc: NaN }, piv = { active: false, confirmed: false };
    const col = bear ? s.colBr : s.colBl, col2 = alpha(col, 0.5);
    for (let i = 0; i < n; i++) {
      const b = bars[i], pv = bear ? ph[i] : pl[i];
      if (!isNaN(pv)) { swing = { bix: i - s.rightBars, prc: pv }; }
      const sw = swing.prc, bx = swing.bix;
      const cond = bear ? b.h > sw && b.o < sw && b.c < sw : b.l < sw && b.o > sw && b.c > sw;
      if (cond) {
        let oP = sw, oB = i;
        for (let k = 1; k <= i - bx - 1; k++) { const v = bear ? lo[i - k] : hi[i - k]; if (bear ? v < oP : v > oP) { oP = v; oB = i - k; } }
        if (!piv.confirmed) kill(piv);
        piv = { swing_prc: sw, swing_bix: bx, oppos_prc: oP, active: true, confirmed: false };
        if (s.dSwingLine) piv.sw = mk({ k: "seg", i1: bx, p1: sw, i2: i, p2: sw, color: col, width: 1 });
        if (s.dOpposLine) piv.op = mk({ k: "seg", i1: oB, p1: oP, i2: i, p2: oP, color: col, width: 1, dash: "dotted" });
        if (s.dSFP_Line) piv.wk = mk({ k: "seg", i1: i, p1: bear ? b.h : b.l, i2: i, p2: sw, color: col2, width: 3 });
        if (s.dSFP_Label) piv.lb = mk({ k: "lbl", i, p: bear ? b.h : b.l, text: "SFP", color: col, pos: bear ? "above" : "below" });
      }
      if (piv.active && !piv.confirmed) {
        if (piv.sw) piv.sw.i2 = i; if (piv.op) piv.op.i2 = i;
        if (bear ? b.c < piv.oppos_prc : b.c > piv.oppos_prc) {
          piv.confirmed = true;
          if (piv.lb && piv.lb.i === i) piv.lb.text = bear ? "SFP ▼" : "▲ SFP";
          else mk({ k: "lbl", i, p: bear ? b.h : b.l, text: bear ? "▼" : "▲", color: col, pos: bear ? "above" : "below" });
        }
      }
      if (piv.active && (i - piv.swing_bix > 500 || (bear ? b.c > piv.swing_prc : b.c < piv.swing_prc))) {
        piv.active = false; if (!piv.confirmed) kill(piv);
      }
    }
  };
  if (s.bear) run(true);
  if (s.bull) run(false);
  const alive = objs.filter((o) => !o.dead).slice(-500);
  alive.forEach((o) => (o.k === "seg" ? ov.segs.push(o) : ov.labels.push(o)));
}

export function computeEpoch(bars, s, mtf) {
  const ov = emptyOv(); const n = bars.length; if (n < 3) return ov;
  const close = bars.map((b) => b.c), hi = bars.map((b) => b.h), lo = bars.map((b) => b.l);
  const barColors = new Array(n).fill(null);
  // pivot breakout bar colours
  if (s.showPivotColors) {
    const st = pivotStates(bars, s.LleftBars, s.RrightBars);
    st.forEach((v, i) => { if (v === 1) barColors[i] = s.pivotUp; else if (v === -1) barColors[i] = s.pivotDn; });
  }
  [[1, "showEma1"], [2, "showEma2"], [3, "showEma3"]].forEach(([k, sh]) => {
    if (s[sh]) ov.plots.push({ data: ema(close, s["length" + k]), color: s[`ema${k}Color`], width: s.emaWidth, name: `EMA ${s["length" + k]}` });
  });
  const startTs = new Date(s.startyear, s.startmonth - 1, s.startday).getTime();
  if (s.showTrend1) ov.segs.push(...autoTrend(bars, s.prdl1, s.PPnum1, s.utcol, s.dtcol, startTs));
  if (s.showTrend2) ov.segs.push(...autoTrend(bars, s.prdl2, s.PPnum2, s.utcol2, s.dtcol2, startTs));
  // aggressive / conservative + cloud
  const ef = ema(close, s.emaFastLen), es = ema(close, s.emaSlowLen);
  const col = ef.map((f, i) => (f > es[i] ? s.upColor : f < es[i] ? s.downColor : PINE.yellow));
  if (s.showCloud) ov.fills.push({ a: ef, b: es, colors: ef.map((f, i) => alpha(f > es[i] ? s.cloudUp : s.cloudDown, s.cloudOpacity / 100)) });
  ov.plots.push({ data: es, colors: col, width: 2, name: "Slow MA" }, { data: ef, colors: col, width: 2, name: "Fast MA" });
  for (let i = 1; i < n; i++) {
    const up = ef[i] > es[i], dn = ef[i] < es[i];
    if (s.sae && ((up && close[i] < ef[i]) || (dn && close[i] > ef[i]))) barColors[i] = s.saeColor;
    const eUp = up && close[i - 1] < es[i], eDn = dn && close[i - 1] > es[i];
    if (s.sce && (eUp || eDn)) barColors[i] = s.sceColor;
    if (s.st && !isNaN(ef[i]) && !isNaN(es[i])) ov.shapes.push(ef[i] >= es[i] ? { i, kind: "triUp", loc: "bottom", color: PINE.green } : { i, kind: "triDown", loc: "top", color: PINE.red });
    if (s.pa && eUp) ov.shapes.push({ i, kind: "arrowUp", loc: "below", color: PINE.lime, p: lo[i] });
    if (s.pa && eDn) ov.shapes.push({ i, kind: "arrowDown", loc: "above", color: PINE.red, p: hi[i] });
  }
  ov.barColors = barColors;
  sfp(bars, s, ov);
  if (s.showDiv) divergence(bars, s, ov);
  const fc = (v) => (v === 1 ? PINE.lime : v === -1 ? PINE.red : PINE.gray);
  if (mtf) {
    if (s.showSfpTable) ov.tables.push({ pos: "top-center", dir: "col", cells: [["30m", "30M"], ["1h", "1H"], ["2h", "2H"], ["4h", "4H"], ["1d", "1D"]].map(([k, t]) => ({ text: t, color: fc(mtf[k] ? sfpState(mtf[k], s.len, s.rightBars, s.freshBars) : 0) })) });
    if (s.showPivotTable) ov.tables.push({ pos: "bottom-right", dir: "row", cells: [["1m", "1M"], ["3m", "3M"], ["5m", "5M"], ["15m", "15M"], ["30m", "30M"], ["1h", "60M"]].map(([k, t]) => { const st = mtf[k] ? pivotStates(mtf[k], s.LleftBars, s.RrightBars) : [0]; return { text: t, color: fc(st[st.length - 1]) }; }) });
  }
  ov.legend = [{ text: "Epoch", color: "#d1d4dc" }, { text: "Fast", data: ef, color: s.upColor }, { text: "Slow", data: es, color: s.downColor }];
  return ov;
}

// ---------------- CakmaUstad RSI ----------------
export function computeRsi(bars, s, dec = 2) {
  const ov = emptyOv(); const n = bars.length; if (n < 3) return ov;
  const srcMap = { close: (b) => b.c, open: (b) => b.o, high: (b) => b.h, low: (b) => b.l, hl2: (b) => (b.h + b.l) / 2, hlc3: (b) => (b.h + b.l + b.c) / 3, ohlc4: (b) => (b.o + b.h + b.l + b.c) / 4 };
  const src = bars.map(srcMap[s.src] || srcMap.close);
  const rsi = rsiCalc(src, s.len1), re = ema(rsi, s.len2);
  if (s.bandFill) ov.bandFill = { p1: s.upper, p2: s.lower, color: alpha(s.bandFillColor, s.bandFillOpacity / 100) };
  [["showUpper", "upper"], ["showLower", "lower"], ["showMid", "mid"], ["showL58", "l58"], ["showL42", "l42"]].forEach(([on, k]) => { if (s[on]) ov.hlines.push({ p: s[k], color: alpha(s.bandColor, 0.7), dash: "dashed" }); });
  if (s.showFill) ov.fills.push({ a: rsi, b: re, colors: rsi.map((v, i) => alpha(v > re[i] ? s.fillUp : s.fillDown, s.fillOpacity / 100)) });
  ov.plots.push({ data: rsi, color: s.rsiColor, width: 1, name: "RSI" }, { data: re, color: s.rsiEmaColor, width: 1, name: "RSI-EMA" });
  const prd = s.prd, ph = pivot(rsi, prd, prd, true), pl = pivot(rsi, prd, prd, false);
  const T = [], Bt = [];
  for (let i = n - 1; i >= 0 && (T.length < s.PPnum || Bt.length < s.PPnum); i--) {
    if (!isNaN(ph[i]) && ph[i] && T.length < s.PPnum) T.push({ pos: i, val: rsi[i - prd] || 0 });
    if (!isNaN(pl[i]) && pl[i] && Bt.length < s.PPnum) Bt.push({ pos: i, val: rsi[i - prd] || 0 });
  }
  if (s.showpivot) for (let i = 0; i < n; i++) {
    if (ph[i]) ov.segs.push({ i1: i - prd, p1: ph[i], i2: i - prd + 50, p2: ph[i], color: PINE.green, width: 2 });
    if (pl[i]) ov.segs.push({ i1: i - prd, p1: pl[i], i2: i - prd + 50, p2: pl[i], color: PINE.red, width: 2 });
  }
  const ul = PINE[s.line1_color] || PINE.red, dl = PINE[s.line2_color] || PINE.blue;
  const dash = s.linestylei === "Dashed" ? "dashed" : null, last = n - 1, maxline = 20;
  let cLo = 0, cHi = 0;
  const scan = (arr, isLow) => (p1) => {
    let r = null;
    for (let p2 = s.PPnum; p2 >= p1 + 1; p2--) {
      const a = arr[p1 - 1], b = arr[p2 - 1]; if (!a || !b) continue;
      if (isLow ? !(a.val > b.val) : !(a.val < b.val)) continue;
      const diff = (isLow ? a.val - b.val : b.val - a.val) / (a.pos - b.pos);
      let hl = isLow ? b.val + diff : b.val - diff, lloc = last, lval = rsi[last], valid = true, broken = false;
      for (let x = Math.max(0, b.pos + 1 - prd); x <= last; x++) {
        const v = rsi[x] || 0;
        if (isLow ? v < hl : v > hl) { valid = false; if (x + prd >= a.pos) broken = true; break; }
        lloc = x; lval = hl; hl += isLow ? diff : -diff;
      }
      if (valid) { r = { v1: hl, v2: b.val, x1: lloc, x2: b.pos }; break; }
      const cnt = isLow ? cLo : cHi;
      if (s.showbroken && broken && cnt < maxline) {
        if (isLow) cLo++; else cHi++;
        ov.segs.push({ i1: b.pos - prd, p1: b.val, i2: lloc, p2: lval, color: isLow ? dl : ul, width: 1, dash: "dotted", ext: isLow && s.extendlines });
      }
    }
    return r;
  };
  const scanLo = scan(Bt, true), scanHi = scan(T, false);
  for (let p1 = 1; p1 <= s.PPnum - 1; p1++) {
    const u = cLo <= maxline ? scanLo(p1) : null;
    const d = cHi <= maxline ? scanHi(p1) : null;
    if (u && cLo < maxline) { cLo++; ov.segs.push({ i1: u.x2 - prd, p1: u.v2, i2: u.x1, p2: u.v1, color: dl, width: s.linewidth, dash, ext: s.extendlines }); }
    if (d && cHi < maxline) { cHi++; ov.segs.push({ i1: d.x2 - prd, p1: d.v2, i2: d.x1, p2: d.v1, color: ul, width: s.linewidth, dash, ext: s.extendlines }); }
  }
  if (s.showAtr) {
    const a = atr(bars, s.ATRlength)[last];
    ov.info.push({ text: `ATR (${s.ATRlength}): ${isNaN(a) ? "—" : a.toLocaleString("tr-TR", { minimumFractionDigits: dec, maximumFractionDigits: dec })}` });
  }
  if (s.showLegend) ov.legend = [{ text: `CakmaUstad-RSI ${s.len1} ${s.len2}`, color: "#d1d4dc" }, { text: "", data: rsi, color: s.rsiColor }, { text: "", data: re, color: s.rsiEmaColor }];
  ov.fixed = true;
  return ov;
}
