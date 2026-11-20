import { MousePointer2, Slash, MoveRight, Ruler, Magnet, Trash2, Square } from "lucide-react";
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
  ["rect", "Dikdörtgen", <Square size={17} />], ["fib", "Fibonacci düzeltme", <FibIcon />], ["long", "Uzun pozisyon", <PosIcon long />],
  ["short", "Kısa pozisyon", <PosIcon />], ["ruler", "Cetvel", <Ruler size={18} />],
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
  return (
    <div data-testid="drawing-props-bar" className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-[#131722] border border-[#2a2e39] rounded-md px-2 py-1 shadow-xl max-w-[95%] overflow-x-auto ev-noscroll">
      <button data-testid="drawing-delete-button" onClick={onDelete} className="w-8 h-7 shrink-0 flex items-center justify-center rounded text-[#f23645] hover:bg-[#1e222d]"><Trash2 size={15} /></button>
      {styled && <div className="w-px h-5 bg-[#2a2e39] mx-1 shrink-0" />}
      {styled && [1, 2, 3, 4].map((w) => (
        <button key={w} data-testid={`drawing-width-${w}`} onClick={() => onChange({ width: w })} className={`w-8 h-7 shrink-0 flex items-center justify-center rounded ${sel.width === w ? "bg-[#2a2e39]" : "hover:bg-[#1e222d]"}`}>
          <span className="block w-5 bg-[#d1d4dc]" style={{ height: w }} />
        </button>
      ))}
      {styled && <div className="w-px h-5 bg-[#2a2e39] mx-1 shrink-0" />}
      {styled && SWATCHES.map((c) => (
        <button key={c} data-testid={`drawing-color-${c.slice(1)}`} onClick={() => onChange({ color: c })} className={`w-6 h-6 md:w-5 md:h-5 rounded-sm shrink-0 border ${sel.color === c ? "border-white" : "border-transparent"}`} style={{ background: c }} />
      ))}
      {styled && <input type="color" data-testid="drawing-color-custom" value={sel.color} onChange={(e) => onChange({ color: e.target.value })} className="w-6 h-6 bg-transparent shrink-0" />}
      {!styled && <span className="text-xs text-[#b2b5be] px-2">{sel.type === "long" ? "Uzun pozisyon" : "Kısa pozisyon"}</span>}
    </div>
  );
}
