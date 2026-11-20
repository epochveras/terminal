import { useEffect, useRef, useState } from "react";
import { ChartEngine } from "@/chart/ChartEngine";
import { api, fetchKlines } from "@/lib/api";
import { liveKlines } from "@/lib/market";
import { computeEpoch, computeRsi, defaultsOf, EPOCH_SCHEMA, RSI_SCHEMA } from "@/lib/indicators";
import { tfLabel, tfMs } from "@/lib/format";
import { Splash } from "./Splash";

const MTF = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d"];

export default function ChartView({ symbol, meta, tf, settings, alarms, cb, engineRef }) {
  const host = useRef(); const eng = useRef(); const cbRef = useRef(cb); cbRef.current = cb;
  const [loading, setLoading] = useState(true);
  const mtf = useRef(null); const st = useRef(settings); st.current = settings;
  const recompute = useRef(() => {});
  const more = useRef({ busy: false, done: false }); const needMore = useRef(() => {});

  useEffect(() => {
    eng.current = new ChartEngine(host.current, {
      onSelect: (d) => cbRef.current.onSelect?.(d), onDrawingsChange: (l) => cbRef.current.onDrawingsChange?.(l),
      onAddAlarm: (p) => cbRef.current.onAddAlarm?.(p), onDeleteAlarm: (id) => cbRef.current.onDeleteAlarm?.(id),
      onToolDone: () => cbRef.current.onToolDone?.(), onRsiRatio: (r) => cbRef.current.onRsiRatio?.(r),
      onNeedMore: () => needMore.current(), onHistory: (h) => cbRef.current.onHistory?.(h), onInteract: () => cbRef.current.onInteract?.(),
    });
    engineRef.current = eng.current;
    return () => { eng.current.destroy(); engineRef.current = null; };
  }, [engineRef]);

  recompute.current = () => {
    const e = eng.current; if (!e || !e.bars.length) return;
    const s = st.current; const dec = meta?.dec ?? 2;
    const ov = s.epoch?.enabled ? computeEpoch(e.bars, { ...defaultsOf(EPOCH_SCHEMA), ...(s.epoch.values || {}) }, mtf.current) : null;
    const rv = s.rsi?.enabled ? computeRsi(e.bars, { ...defaultsOf(RSI_SCHEMA), ...(s.rsi.values || {}) }, dec) : null;
    e.setOverlays(ov, rv);
  };
  useEffect(() => { recompute.current(); }, [settings.epoch, settings.rsi]);
  useEffect(() => { eng.current?.setRsiRatio(settings.rsiRatio || 0.26); }, [settings.rsiRatio]);

  useEffect(() => {
    if (!meta) return;
    let alive = true; setLoading(true); more.current = { busy: false, done: false }; mtf.current = null;
    const info = { symbol, tf, tfLabel: tfLabel(tf), tfMs: tfMs(tf), tick: meta.tick, dec: meta.dec };
    let stop = () => {}; let lastCalc = 0, pend = null;
    const schedule = () => {
      const now = Date.now();
      if (now - lastCalc > 1000) { lastCalc = now; recompute.current(); }
      else if (!pend) pend = setTimeout(() => { pend = null; lastCalc = Date.now(); recompute.current(); }, 1000);
    };
    needMore.current = async () => {
      const e = eng.current; if (more.current.busy || more.current.done || !e.bars.length || e.bars.length > 8000) return;
      more.current.busy = true;
      try {
        const older = await fetchKlines(symbol, tf, 1000, e.bars[0].t - 1);
        if (!alive) return;
        if (!older.length || e.prepend(older) === 0) more.current.done = true; else recompute.current();
      } catch {} finally { more.current.busy = false; }
    };
    (async () => {
      const [bars, dr] = await Promise.all([
        fetchKlines(symbol, tf, 1000).catch(() => []),
        api.get(`/drawings/${symbol}`).then((r) => r.data.drawings).catch(() => []),
      ]);
      if (!alive) return;
      eng.current.setSeries(info, bars); eng.current.setDrawings(dr); recompute.current(); setLoading(false);
      stop = liveKlines(symbol, tf, (b) => { if (alive) { eng.current.appendLive(b); schedule(); } });
    })();
    const loadMtf = async () => {
      if (!st.current.epoch?.enabled) return;
      const res = await Promise.all(MTF.map((k) => fetchKlines(symbol, k, 300).catch(() => null)));
      if (!alive) return; mtf.current = Object.fromEntries(MTF.map((k, i) => [k, res[i]]).filter((x) => x[1])); recompute.current();
    };
    loadMtf(); const iv = setInterval(loadMtf, 60000);
    return () => { alive = false; stop(); clearInterval(iv); clearTimeout(pend); };
  }, [symbol, tf, meta]);

  useEffect(() => { eng.current?.setAlarms(alarms.filter((a) => a.active && a.symbol === symbol)); }, [alarms, symbol]);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden select-none" data-testid="chart-container">
      <div ref={host} className="absolute inset-0" />
      {loading && <Splash overlay text="Grafik yükleniyor…" />}
    </div>
  );
}
