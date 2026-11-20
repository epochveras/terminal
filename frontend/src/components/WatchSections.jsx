import { useState } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export const OTHER = "__other";

export function buildItems(rows, secs, collapsedOther) {
  if (!secs.length) return rows.map((m) => ({ k: "r", m }));
  const bySym = new Map(rows.map((m) => [m.symbol, m]));
  const used = new Set(); const out = [];
  secs.forEach((s) => {
    const ms = s.symbols.map((x) => bySym.get(x)).filter(Boolean);
    ms.forEach((m) => used.add(m.symbol));
    out.push({ k: "h", id: s.id, name: s.name, n: ms.length, collapsed: !!s.collapsed });
    if (!s.collapsed) ms.forEach((m) => out.push({ k: "r", m, sec: s.id }));
  });
  const rest = rows.filter((m) => !used.has(m.symbol));
  out.push({ k: "h", id: OTHER, name: "Diğer", n: rest.length, collapsed: collapsedOther });
  if (!collapsedOther) rest.forEach((m) => out.push({ k: "r", m, sec: OTHER }));
  return out;
}

export function SectionHeader({ it, onToggle, onRename, onDelete }) {
  const [edit, setEdit] = useState(false); const [v, setV] = useState(it.name);
  const save = () => { const n = v.trim(); if (n && n !== it.name) onRename(it.id, n); setEdit(false); };
  const custom = it.id !== OTHER;
  return (
    <div data-testid={`watchlist-section-${it.id}`} onClick={() => !edit && onToggle(it.id)}
      className="h-[30px] flex items-center gap-1 px-2 cursor-pointer select-none bg-[#0c0d0f] border-y border-[#1e222d] hover:bg-[#131722]">
      {it.collapsed ? <ChevronRight size={13} className="text-[#787b86]" /> : <ChevronDown size={13} className="text-[#787b86]" />}
      {edit ? (
        <input autoFocus data-testid={`watchlist-section-rename-input-${it.id}`} value={v} onClick={(e) => e.stopPropagation()} onChange={(e) => setV(e.target.value)}
          onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEdit(false); }}
          className="bg-[#131722] text-[11px] px-1.5 py-0.5 rounded outline-none w-32" />
      ) : <span className="text-[11px] font-semibold uppercase tracking-wider text-[#b2b5be] truncate" data-testid={`watchlist-section-name-${it.id}`}>{it.name}</span>}
      <span className="text-[10px] text-[#50535e]">{it.n}</span>
      {custom && !edit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <button data-testid={`watchlist-section-menu-${it.id}`} className="ml-auto p-1 text-[#787b86] hover:text-white"><MoreHorizontal size={14} /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent onClick={(e) => e.stopPropagation()} className="bg-[#131722] border-[#2a2e39]">
            <DropdownMenuItem data-testid={`watchlist-section-rename-${it.id}`} onClick={() => { setV(it.name); setEdit(true); }}><Pencil size={13} /> Yeniden adlandır</DropdownMenuItem>
            <DropdownMenuItem data-testid={`watchlist-section-delete-${it.id}`} onClick={() => onDelete(it.id)} className="text-[#f23645]"><Trash2 size={13} /> Bölümü sil</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
