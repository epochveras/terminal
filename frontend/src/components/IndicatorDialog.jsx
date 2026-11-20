import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { defaultsOf } from "@/lib/indicators";

export function IndicatorDialog({ open, onOpenChange, title, schema, values, onChange }) {
  const v = { ...defaultsOf(schema), ...(values || {}) };
  const groups = [...new Set(schema.map((s) => s.group))];
  const set = (k, val) => onChange({ ...(values || {}), [k]: val });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#131722] border-[#2a2e39] max-w-lg p-0 gap-0 max-h-[88vh] flex flex-col" data-testid="indicator-settings-dialog">
        <DialogHeader className="px-5 py-4 border-b border-[#2a2e39]"><DialogTitle className="text-[15px]">{title} · Ayarlar</DialogTitle></DialogHeader>
        <div className="overflow-y-auto ev-scroll px-5 py-3 flex-1">
          {groups.map((g) => (
            <div key={g} className="mb-4">
              <p className="text-[10px] uppercase tracking-wider text-[#787b86] mb-2">{g}</p>
              <div className="space-y-1.5">
                {schema.filter((s) => s.group === g).map((s) => (
                  <div key={s.key} className="flex items-center justify-between gap-3 min-h-[34px] text-[13px]">
                    <span className="text-[#d1d4dc]">{s.label}</span>
                    {s.type === "bool" && <Switch data-testid={`ind-input-${s.key}`} checked={!!v[s.key]} onCheckedChange={(c) => set(s.key, c)} />}
                    {s.type === "int" && <input data-testid={`ind-input-${s.key}`} type="number" min={s.min} max={s.max} value={v[s.key]} onChange={(e) => { const n = parseInt(e.target.value, 10); if (!isNaN(n)) set(s.key, Math.max(s.min, Math.min(s.max, n))); }} className="num w-24 h-8 bg-black border border-[#2a2e39] rounded px-2 text-right outline-none focus:border-white" />}
                    {s.type === "color" && <input data-testid={`ind-input-${s.key}`} type="color" value={v[s.key]} onChange={(e) => set(s.key, e.target.value)} className="w-12 h-8 bg-transparent cursor-pointer" />}
                    {s.type === "select" && (
                      <select data-testid={`ind-input-${s.key}`} value={v[s.key]} onChange={(e) => set(s.key, e.target.value)} className="h-8 bg-black border border-[#2a2e39] rounded px-2 outline-none">
                        {s.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-between px-5 py-3 border-t border-[#2a2e39]">
          <button data-testid="ind-reset-button" onClick={() => onChange({})} className="text-[13px] text-[#787b86] hover:text-white">Varsayılana dön</button>
          <button data-testid="ind-close-button" onClick={() => onOpenChange(false)} className="h-8 px-4 rounded bg-white text-black hover:bg-[#d1d4dc] text-[13px]">Tamam</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
