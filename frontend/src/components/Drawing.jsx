import { MousePointer2, Slash, MoveRight, Ruler, Magnet, Trash2, Square, Type } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

const PosIcon = ({ long }) => (
  <svg width="18" height="18" viewBox="0 0 18 18"><rect x="3" y={long ? 3 : 9} width="12" height="6" fill="#089981" opacity=".9" /><rect x="3" y={long ? 9 : 3} width="12" height="6" fill="#f23645" opacity=".9" /><line x1="2" x2="16" y1="9" y2="9" stroke="#d1d4dc" /></svg>
);
const FibIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.4"><line x1="2" x2="16" y1="3" y2="3" /><line x1="2" x2="16" y1="7" y2="7" /><line x1="2" x2="16" y1="10.5" y2="10.5" /><line x1="2" x2="16" y1="15" y2="15" /><line x1="3" x2="15" y1="15" y2="3" strokeDasharray="2 2" /></svg>
);
const VIcon = () => (<svg width="18" height="18" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.6"><line x1="9" x2="9" y1="1" y2="17" /><circle cx="9" cy="9" r="2" fill="currentColor" /></svg>);
export const STYLED = ["trendline", "hray", "vline", "rect", "fib"];
const TOOLS = [
  ["cursor", "İmleç", <MousePointer2 size={18} />], ["trendline", "Trend çizgisi", <Slash size={18} />],
  ["hray", "Yatay ışın", <MoveRight size={18} />], ["vline", "Dikey çizgi", <VIcon />],
  ["rect", "Dikdörtgen", <Square size={17} />], ["fib", "Fibonacci düzeltme", <FibIcon />], ["text", "Metin ekle", <Type size={18} />],
  ["long", "Uzun pozisyon", <PosIcon long />], ["short", "Kısa pozisyon", <PosIcon />], ["ruler", "Cetvel", <Ruler size={18} />],
];

const Btn = ({ id, label, active, onClick, children }) => (
  <Tooltip><TooltipTrigger asChild>
    <button data-testid={`drawing-tool-${id}`} onClick={onClick} aria-label={label}
      className={`w-10 h-10 md:w-9 md:h-9 flex items-center justify-center rounded-md transition-colors ${active ? "bg-[#1e222d] text-white" : "text-[#b2b5be] hover:bg-[#171b26] hover:text-white"}`}>{children}</button>
  </TooltipTrigger><TooltipContent side="right">{label}</TooltipContent></Tooltip>
);

export function DrawingToolbar({ tool, setTool, magnet, setMagnet, onClear }) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="w-11 shrink-0 bg-[#0c0d0f] border-r border-[#2a2e39] flex flex-col items-center gap-1 py-2 overflow-y-auto ev-noscroll" data-testid="drawing-toolbar">
        {TOOLS.map(([id, label, icon]) => <Btn key={id} id={id} label={label} active={tool === id} onClick={() => setTool(tool === id && id !== "cursor" ? "cursor" : id)}>{icon}</Btn>)}
        <div className="w-6 h-px bg-[#2a2e39] my-1" />
        <Btn id="magnet" label={magnet ? "Yumuşak mıknatıs: Açık" : "Yumuşak mıknatıs: Kapalı"} active={magnet} onClick={() => setMagnet(!magnet)}><Magnet size={18} /></Btn>
        <Btn id="clear" label="Tüm çizimleri sil" onClick={onClear}><Trash2 size={18} /></Btn>
      </div>
    </TooltipProvider>
  );
}

const SWATCHES = ["#2962ff", "#00bcd4", "#089981", "#00e676", "#ffeb3b", "#ff9800", "#f23645", "#e040fb", "#ffffff", "#787b86"];
export function DrawingProps({ sel, onChange, onDelete }) {
  if (!sel) return null;
  const styled = STYLED.includes(sel.type);
  const isText = sel.type === "text";
  return (
    <div data-testid="drawing-props-bar" className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-[#131722] border border-[#2a2e39] rounded-md px-2 py-1 shadow-xl max-w-[95%] overflow-x-auto ev-noscroll">
      <button data-testid="drawing-delete-button" onClick={onDelete} className="w-8 h-7 shrink-0 flex items-center justify-center rounded text-[#f23645] hover:bg-[#1e222d]"><Trash2 size={15} /></button>
      {(styled || isText) && <div className="w-px h-5 bg-[#2a2e39] mx-1 shrink-0" />}
      {styled && [1, 2, 3, 4].map((w) => (
        <button key={w} data-testid={`drawing-width-${w}`} onClick={() => onChange({ width: w })} className={`w-8 h-7 shrink-0 flex items-center justify-center rounded ${sel.width === w ? "bg-[#2a2e39]" : "hover:bg-[#1e222d]"}`}>
          <span className="block w-5 bg-[#d1d4dc]" style={{ height: w }} />
        </button>
      ))}
      {(styled || isText) && <div className="w-px h-5 bg-[#2a2e39] mx-1 shrink-0" />}
      {(styled || isText) && SWATCHES.map((c) => (
        <button key={c} data-testid={`drawing-color-${c.slice(1)}`} onClick={() => onChange({ color: c })} className={`w-6 h-6 md:w-5 md:h-5 rounded-sm shrink-0 border ${sel.color === c ? "border-white" : "border-transparent"}`} style={{ background: c }} />
      ))}
      {(styled || isText) && <input type="color" data-testid="drawing-color-custom" value={sel.color || "#d1d4dc"} onChange={(e) => onChange({ color: e.target.value })} className="w-6 h-6 bg-transparent shrink-0" />}
      {isText && <>
        <div className="w-px h-5 bg-[#2a2e39] mx-1 shrink-0" />
        {[12, 14, 16, 20, 24, 30].map((size) => (
          <button key={size} data-testid={`drawing-font-size-${size}`} onClick={() => onChange({ fontSize: size })} className={`h-7 px-2 shrink-0 rounded text-xs ${Number(sel.fontSize || 14) === size ? "bg-[#2a2e39] text-white" : "text-[#b2b5be] hover:bg-[#1e222d]"}`}>{size}</button>
        ))}
      </>}
      {sel.type === "fib" && <>
        <div className="w-px h-5 bg-[#2a2e39] mx-1 shrink-0" />
        <button data-testid="fib-reverse" onClick={() => onChange({ reverse: !sel.reverse })} className={`h-7 px-2 shrink-0 rounded text-xs ${sel.reverse ? "bg-[#2a2e39] text-white" : "text-[#b2b5be] hover:bg-[#1e222d]"}`}>Ters çevir</button>
        <label className="flex items-center gap-1 text-xs text-[#b2b5be] shrink-0 px-1">
          <input data-testid="fib-fill-toggle" type="checkbox" checked={sel.showFill !== false} onChange={(e) => onChange({ showFill: e.target.checked })} />
          Arka plan
        </label>
        <details className="relative shrink-0">
          <summary data-testid="fib-levels-settings" className="h-7 px-2 flex items-center rounded text-xs text-[#b2b5be] hover:bg-[#1e222d] cursor-pointer list-none">Oranlar ▾</summary>
          <div className="absolute top-8 right-0 z-30 w-56 max-h-72 overflow-y-auto rounded-md border border-[#2a2e39] bg-[#131722] p-2 shadow-xl">
            {(Array.isArray(sel.levels) && sel.levels.length ? sel.levels : [[0,"#787b86"],[0.236,"#f23645"],[0.382,"#ff9800"],[0.5,"#4caf50"],[0.618,"#089981"],[0.786,"#00bcd4"],[1,"#787b86"],[1.618,"#2962ff"]].map(([value,color]) => ({ value, color, visible: true }))).map((level, index) => (
              <div key={`${level.value}-${index}`} className="flex items-center gap-2 py-1">
                <input aria-label={`${level.value} oranını göster`} data-testid={`fib-level-visible-${index}`} type="checkbox" checked={level.visible !== false} onChange={(e) => {
                  const levels = (Array.isArray(sel.levels) && sel.levels.length ? sel.levels : [[0,"#787b86"],[0.236,"#f23645"],[0.382,"#ff9800"],[0.5,"#4caf50"],[0.618,"#089981"],[0.786,"#00bcd4"],[1,"#787b86"],[1.618,"#2962ff"]].map(([value,color]) => ({ value, color, visible: true }))).map((item, i) => i === index ? { ...item, visible: e.target.checked } : item);
                  onChange({ levels });
                }} />
                <span className="text-xs text-[#b2b5be] flex-1 tabular-nums">{level.value}</span>
                <input aria-label={`${level.value} oranı rengi`} data-testid={`fib-level-color-${index}`} type="color" value={level.color || "#d1d4dc"} onChange={(e) => {
                  const levels = (Array.isArray(sel.levels) && sel.levels.length ? sel.levels : [[0,"#787b86"],[0.236,"#f23645"],[0.382,"#ff9800"],[0.5,"#4caf50"],[0.618,"#089981"],[0.786,"#00bcd4"],[1,"#787b86"],[1.618,"#2962ff"]].map(([value,color]) => ({ value, color, visible: true }))).map((item, i) => i === index ? { ...item, color: e.target.value } : item);
                  onChange({ levels });
                }} className="w-7 h-6 bg-transparent" />
              </div>
            ))}
          </div>
        </details>
      </>}
      {!styled && !isText && sel.type !== "fib" && <span className="text-xs text-[#b2b5be] px-2">{sel.type === "long" ? "Uzun pozisyon" : "Kısa pozisyon"}</span>}
    </div>
  );
}




