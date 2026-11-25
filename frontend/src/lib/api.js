
import axios from "axios";

const BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
export const API = `${BACKEND_URL}/api`;
export const api = axios.create({ baseURL: API });

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
  rows.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));

export async function fetchKlines(symbol, interval, limit = 1000, endTime) {
  const { data } = await api.get("/market/klines", { params: { symbol, interval, limit, endTime } });
  return parseKlines(data);
}
