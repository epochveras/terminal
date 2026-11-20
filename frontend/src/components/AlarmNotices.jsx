import { BellRing, X, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { fmtPrice } from "@/lib/format";

export function AlarmNotices({ items, onClose, onOpen, metaMap }) {
  return (
    <div className="fixed left-3 bottom-3 z-[60] flex flex-col-reverse gap-2 w-[300px] max-w-[calc(100vw-24px)]" data-testid="alarm-notices">
      {items.map((a) => {
        const dec = metaMap[a.symbol]?.dec ?? 2, up = a.direction === "above";
        return (
          <div key={a.id} data-testid={`alarm-notice-${a.id}`} onClick={() => onOpen(a)}
            className="ev-notice relative cursor-pointer bg-[#0c0d0f]/95 backdrop-blur border border-[#2a2e39] rounded-md shadow-[0_8px_30px_rgba(0,0,0,0.6)] overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#e0a020]" />
            <div className="flex items-start gap-3 pl-4 pr-2 py-3">
              <div className="mt-0.5 w-8 h-8 rounded-full bg-[#e0a020]/15 flex items-center justify-center shrink-0"><BellRing size={15} className="text-[#e0a020]" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-white">{a.symbol}</span>
                  <span className="text-[10px] uppercase tracking-wider text-[#787b86]">Alarm tetiklendi</span>
                </div>
                <div className="flex items-center gap-1 mt-1 text-[12px] text-[#d1d4dc] num">
                  {up ? <ArrowUpRight size={13} className="text-[#089981]" /> : <ArrowDownRight size={13} className="text-[#f23645]" />}
                  {fmtPrice(a.price, dec)} {up ? "yukarı" : "aşağı"} kesildi
                </div>
                <div className="text-[11px] text-[#787b86] mt-0.5 num">Fiyat {fmtPrice(a.trigger_price, dec)} · {new Date(a.triggered_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Istanbul" })}</div>
              </div>
              <button data-testid={`alarm-notice-close-${a.id}`} onClick={(e) => { e.stopPropagation(); onClose(a.id); }} className="p-1 text-[#787b86] hover:text-white"><X size={14} /></button>
            </div>
            <div className="ev-notice-bar h-[2px] bg-[#e0a020]/60" />
          </div>
        );
      })}
    </div>
  );
}
