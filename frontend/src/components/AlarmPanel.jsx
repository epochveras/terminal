import { useState } from "react";
import { Bell, BellRing, Trash2, Volume2, VolumeX, Send, ArrowUp, ArrowDown } from "lucide-react";
import { fmtPrice } from "@/lib/format";
import { market } from "@/lib/market";

export function AlarmPanel({ onSelect, alarms, symbol, metaMap, add, remove, clearHistory, sound, setSound, push }) {
  const [price, setPrice] = useState("");
  const active = alarms.filter((a) => a.active), done = alarms.filter((a) => !a.active);
  const dec = (s) => metaMap[s]?.dec ?? 2;
  const submit = (e) => {
    e.preventDefault();
    const raw = String(price).trim(), cur = market.tickers[symbol]?.c;
    let cands = raw.includes(",") ? [raw.replace(/\./g, "").replace(",", ".")] : [raw, raw.replace(/\./g, "")];
    cands = cands.map(Number).filter((x) => isFinite(x) && x > 0);
    if (!cands.length) return;
    const p = cur ? cands.sort((x, y) => Math.abs(Math.log(x / cur)) - Math.abs(Math.log(y / cur)))[0] : cands[0];
    add(symbol, p, cur); setPrice("");
  };
  const Item = ({ a }) => (
    <div data-testid={`alarm-item-${a.id}`} onClick={() => onSelect(a.symbol)} className={`flex items-center gap-2 px-3 h-9 text-[12px] border-b border-[#131722] cursor-pointer hover:bg-[#131722] ${a.active ? "" : "opacity-50"} ${a.symbol === symbol ? "bg-[#131722]" : ""}`}>
      {a.active ? <Bell size={13} className="text-[#e0a020]" /> : <BellRing size={13} className="text-[#787b86]" />}
      <span className="font-semibold w-24 truncate">{a.symbol}</span>
      {a.direction === "above" ? <ArrowUp size={13} className="text-[#089981]" /> : <ArrowDown size={13} className="text-[#f23645]" />}
      <span className="num ml-auto">{fmtPrice(a.price, dec(a.symbol))}</span>
      {!a.active && <span className="text-[10px] text-[#787b86] num">{new Date(a.triggered_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" })}</span>}
      <button data-testid={`alarm-delete-${a.id}`} onClick={(e) => { e.stopPropagation(); remove(a.id); }} className="p-1 text-[#787b86] hover:text-[#f23645]"><Trash2 size={13} /></button>
    </div>
  );
  return (
    <div className="flex flex-col h-full min-h-0" data-testid="alarm-panel">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#1e222d] text-[11px] shrink-0 flex-wrap">
        <button data-testid="alarm-sound-toggle" onClick={() => setSound(!sound)} className={`flex items-center gap-1 ${sound ? "text-[#d1d4dc]" : "text-[#787b86]"}`}>{sound ? <Volume2 size={13} /> : <VolumeX size={13} />} Ses</button>
        {push.status === "granted" ? (
          <button data-testid="alarm-push-test" onClick={push.test} className="flex items-center gap-1 text-[#089981]"><Send size={12} /> Push aktif · test</button>
        ) : (
          <button data-testid="alarm-push-enable" onClick={push.enable} className="flex items-center gap-1 text-white"><Send size={12} /> {push.status === "unsupported" ? "Push desteklenmiyor" : "Bildirimleri aç"}</button>
        )}
      </div>
      <form onSubmit={submit} className="flex items-center gap-2 px-3 py-2 shrink-0">
        <span className="text-[11px] text-[#787b86] truncate max-w-[90px]">{symbol}</span>
        <input data-testid="alarm-price-input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Fiyat" className="num flex-1 min-w-0 bg-[#131722] rounded px-2 h-8 text-[12px] outline-none" />
        <button data-testid="alarm-add-button" className="h-8 px-3 rounded bg-white text-black hover:bg-[#d1d4dc] text-[12px]">Ekle</button>
      </form>
      <div className="flex-1 min-h-0 overflow-y-auto ev-scroll">
        {active.map((a) => <Item key={a.id} a={a} />)}
        {!active.length && <p className="text-[11px] text-[#787b86] px-3 py-2">Aktif alarm yok. Grafikte fiyat ölçeğine yaklaşıp + ile ekleyebilirsin.</p>}
        {done.length > 0 && (
          <div className="flex items-center justify-between px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-[#787b86]">
            <span>Tetiklenenler</span><button data-testid="alarm-clear-history" onClick={clearHistory} className="hover:text-[#f23645]">Temizle</button>
          </div>
        )}
        {done.map((a) => <Item key={a.id} a={a} />)}
      </div>
    </div>
  );
}
