const nfCache = {};
export const decFromTick = (tick) => {
  const s = String(tick ?? "0.01");
  if (!s.includes(".")) return 0;
  return (s.split(".")[1].replace(/0+$/, "")).length;
};
export function fmtPrice(v, dec = 2) {
  if (v == null || !isFinite(v)) return "—";
  const f = nfCache[dec] || (nfCache[dec] = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: dec, maximumFractionDigits: dec }));
  return f.format(v);
}
export function fmtPct(v) {
  if (v == null || !isFinite(v)) return "—";
  return (v > 0 ? "+" : "") + fmtPrice(v, 2) + "%";
}
export function fmtVol(v) {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return fmtPrice(v / 1e9, 2) + "B";
  if (a >= 1e6) return fmtPrice(v / 1e6, 1) + "M";
  if (a >= 1e3) return fmtPrice(v / 1e3, 1) + "K";
  return fmtPrice(v, 0);
}
// Funding: exact Binance digits shifted to percent, without float rounding
export function fmtFunding(raw) {
  if (raw == null || raw === "") return "—";
  let s = String(raw).trim();
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  let [i, f = ""] = s.split(".");
  f = f.padEnd(2, "0");
  let ni = (i + f.slice(0, 2)).replace(/^0+(?=\d)/, "");
  let nf = f.slice(2).replace(/0+$/, "");
  if (nf.length < 4) nf = nf.padEnd(4, "0");
  return (neg ? "-" : "") + ni + "." + nf + "%";
}
export function fmtCountdown(ms) {
  if (ms == null || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  if (d > 0) return `${d}g ${p(h)}:${p(m)}`;
  if (h > 0) return `${p(h)}:${p(m)}:${p(sec)}`;
  return `${p(m)}:${p(sec)}`;
}
export const TIMEFRAMES = [
  { k: "1m", l: "1m", ms: 60e3 }, { k: "3m", l: "3m", ms: 180e3 }, { k: "5m", l: "5m", ms: 300e3 },
  { k: "15m", l: "15m", ms: 900e3 }, { k: "30m", l: "30m", ms: 1800e3 }, { k: "1h", l: "1s", ms: 3600e3 },
  { k: "4h", l: "4s", ms: 14400e3 }, { k: "1d", l: "1G", ms: 86400e3 }, { k: "1w", l: "1H", ms: 604800e3 },
];
export const tfMs = (k) => (TIMEFRAMES.find((t) => t.k === k) || { ms: { "2h": 7200e3 }[k] || 60e3 }).ms;
export const tfLabel = (k) => (TIMEFRAMES.find((t) => t.k === k) || {}).l || k;
export const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
