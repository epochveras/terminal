
import axios from "axios";

const BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
export const API = `${BACKEND_URL}/api`;
export const api = axios.create({ baseURL: API });

const BINANCE = "https://fapi.binance.com";

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem("ev_token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

export function errText(e) {
  const d = e?.response?.data?.detail;
  if (d == null) return e?.message || "Bir hata oluştu";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join(" ");
  return String(d);
}

export const parseKlines = (rows) =>
  rows.map((k) => ({
    t: Number(k[0]),
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
  }));

export async function fetchKlines(symbol, interval, limit = 1000, endTime) {
  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    interval,
    limit: String(Math.min(Math.max(Number(limit) || 1000, 1), 1500)),
  });

  if (endTime != null) {
    params.set("endTime", String(endTime));
  }

  const response = await fetch(
    `${BINANCE}/fapi/v1/klines?${params.toString()}`
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Binance mum verisi HTTP ${response.status}: ${message}`);
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error("Binance mum verisi beklenen formatta değil");
  }

  return parseKlines(data);
}
