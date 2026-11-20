import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, API, errText } from "@/lib/api";
import { playAlarm, enablePush, pushSupported } from "@/lib/alerts";

export const DEFAULT_SETTINGS = {
  symbol: "BTCUSDT", tf: "15m", epoch: { enabled: true, values: {} }, rsi: { enabled: true, values: {} },
  toolDefaults: { trendline: { color: "#2962ff", width: 2 }, hray: { color: "#00bcd4", width: 1 } },
  magnet: false, panels: { watchlist: true, alarms: true, futures: true }, rsiRatio: 0.26, sound: true, watchlist: { tab: "fav", sort: { k: "q", d: -1 } },
};
export const DEFAULT_FAVS = [{ id: "fav", name: "Favoriler", symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XAUUSDT"] }];

export function useWorkspace(userId) {
  const KEY = `ev_ws_${userId}`;
  const cached = JSON.parse(localStorage.getItem(KEY) || "null");
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS, ...(cached?.settings || {}) });
  const [favorites, setFavorites] = useState(cached?.favorites || DEFAULT_FAVS);
  const [ready, setReady] = useState(false);
  const timer = useRef(); const latest = useRef({ settings, favorites, ts: cached?.ts }); const pending = useRef(false);
  useEffect(() => {
    api.get("/workspace").then(({ data }) => {
      const local = JSON.parse(localStorage.getItem(KEY) || "null");
      if (local?.ts && local.ts > (data.ts || 0)) { api.put("/workspace", local).catch(() => {}); return; }
      const s = { ...DEFAULT_SETTINGS, ...(data.settings || {}) }; const f = data.favorites || DEFAULT_FAVS;
      setSettings(s); setFavorites(f); latest.current = { settings: s, favorites: f, ts: data.ts };
    }).catch(() => {}).finally(() => setReady(true));
    const flush = () => { if (!pending.current) return; pending.current = false; const t = localStorage.getItem("ev_token");
      fetch(`${API}/workspace`, { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(latest.current) }).catch(() => {}); };
    const onHide = () => document.hidden && flush();
    window.addEventListener("pagehide", flush); document.addEventListener("visibilitychange", onHide);
    return () => { window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", onHide); };
  }, [KEY]);
  const save = useCallback(() => {
    latest.current.ts = Date.now(); pending.current = true;
    localStorage.setItem(KEY, JSON.stringify(latest.current));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { pending.current = false; api.put("/workspace", latest.current).catch(() => {}); }, 500);
  }, [KEY]);
  const update = useCallback((patch) => {
    setSettings((s) => { const n = { ...s, ...(typeof patch === "function" ? patch(s) : patch) }; latest.current.settings = n; save(); return n; });
  }, [save]);
  const updateFavs = useCallback((fn) => {
    setFavorites((f) => { const n = fn(f); latest.current.favorites = n; save(); return n; });
  }, [save]);
  return { settings, update, favorites, updateFavs, ready };
}

export function useAlarms(soundOn, metaMap, onTrigger) {
  const trigRef = useRef(onTrigger); trigRef.current = onTrigger;
  const [alarms, setAlarms] = useState([]);
  const seen = useRef(null); const soundRef = useRef(soundOn); soundRef.current = soundOn;
  const metaRef = useRef(metaMap); metaRef.current = metaMap;
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/alarms");
      if (seen.current === null) seen.current = new Set(data.filter((a) => !a.active).map((a) => a.id));
      else data.filter((a) => !a.active && !seen.current.has(a.id)).forEach((a) => {
        seen.current.add(a.id);
        if (soundRef.current) playAlarm();
        trigRef.current?.(a);
      });
      setAlarms(data);
    } catch {}
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 3000); return () => clearInterval(iv); }, [load]);
  const add = useCallback(async (symbol, price, current) => {
    try { await api.post("/alarms", { symbol, price, current_price: current }); toast.success(`Alarm kuruldu · ${symbol}`); load(); }
    catch (e) { toast.error(errText(e)); }
  }, [load]);
  const remove = useCallback(async (id) => { setAlarms((l) => l.filter((a) => a.id !== id)); await api.delete(`/alarms/${id}`).catch(() => {}); load(); }, [load]);
  const clearHistory = useCallback(async () => { await api.delete("/alarms").catch(() => {}); load(); }, [load]);
  return { alarms, add, remove, clearHistory };
}

export function usePush() {
  const [status, setStatus] = useState(pushSupported() ? Notification.permission : "unsupported");
  useEffect(() => { if (pushSupported() && Notification.permission === "granted") enablePush(false).catch(() => {}); }, []);
  const enable = async () => {
    try { await enablePush(true); setStatus("granted"); toast.success("Bildirimler açık"); }
    catch (e) { setStatus(pushSupported() ? Notification.permission : "unsupported"); toast.error(e.message); }
  };
  const test = async () => { try { const { data } = await api.post("/push/test"); toast(data.sent ? "Test bildirimi gönderildi" : "Kayıtlı cihaz yok, önce bildirimleri açın"); } catch (e) { toast.error(errText(e)); } };
  return { status, enable, test };
}

export function useIsMobile() {
  const q = () => window.innerWidth < 768;
  const [m, setM] = useState(q());
  useEffect(() => { const f = () => setM(q()); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return m;
}
