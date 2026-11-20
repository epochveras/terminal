import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Star, Search, Plus, X, ListPlus, Check, GripVertical, FolderPlus } from "lucide-react";
import { market } from "@/lib/market";
import { fmtPrice, fmtPct, fmtVol, fmtFunding, uid } from "@/lib/format";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { OTHER, buildItems, SectionHeader } from "@/components/WatchSections";

const ROW = 30;
const GRID = "22px minmax(92px,1fr) 84px 62px 56px 108px";

export function useTickers() {
  const [t, setT] = useState(market.tickers);
  useEffect(() => market.subscribe((x) => setT({ ...x })), []);
  return t;
}

const Row = memo(function Row({ m, t, fav, active, groups, onSelect, onStar, onToggleGroup, secs, sec, onMove, onGrip, ghost }) {
  const chg = t?.P ?? 0;
  const prev = useRef(t?.c); const [dir, setDir] = useState(null); const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (t?.c != null && prev.current != null && t.c !== prev.current) {
      setDir(t.c > prev.current ? "up" : "down"); setFlash(true);
      const id = setTimeout(() => setFlash(false), 600); prev.current = t.c; return () => clearTimeout(id);
    }
    prev.current = t?.c;
  }, [t?.c]);
  const bg = !flash ? "bg-transparent" : dir === "up" ? "bg-[rgba(8,153,129,0.55)]" : "bg-[rgba(242,54,69,0.55)]";
  const col = chg > 0 ? "text-[#089981]" : chg < 0 ? "text-[#f23645]" : "text-[#d1d4dc]";
  const fr = t?.r != null ? +t.r : null;
  const custom = groups.filter((g) => g.id !== "fav");
  return (
    <div data-testid={`watchlist-row-${m.symbol}`} onClick={() => onSelect(m.symbol)}
      className={`grid items-center h-[30px] px-1 cursor-pointer text-[12px] border-l-2 ${ghost ? "opacity-30" : ""} ${active ? "bg-[#1e222d] border-white" : "border-transparent hover:bg-[#131722]"}`} style={{ gridTemplateColumns: GRID }}>
      <button data-testid={`watchlist-star-${m.symbol}`} onClick={(e) => { e.stopPropagation(); onStar(m.symbol); }} className="flex items-center justify-center h-full">
        <Star size={13} className={fav ? "fill-[#f0b90b] text-[#f0b90b]" : "text-[#50535e]"} />
      </button>
      <div className="truncate flex items-center gap-1 min-w-0">
        {onGrip && <span data-testid={`watchlist-drag-${m.symbol}`} onPointerDown={(e) => onGrip(e, m.symbol)} onClick={(e) => e.stopPropagation()}
          className="text-[#50535e] hover:text-white cursor-grab touch-none -ml-0.5 py-1.5"><GripVertical size={12} /></span>}
        <span className="font-semibold text-[#d1d4dc]">{m.base}</span><span className="text-[#50535e] text-[11px]">{m.quote}</span>
        {(custom.length > 0 || secs.length > 0) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button data-testid={`watchlist-group-menu-${m.symbol}`} className="ml-auto text-[#50535e] hover:text-white px-1"><ListPlus size={13} /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent onClick={(e) => e.stopPropagation()} className="bg-[#131722] border-[#2a2e39] max-h-80 overflow-auto">
              {custom.length > 0 && <DropdownMenuLabel className="text-[10px] text-[#787b86]">Gruplar</DropdownMenuLabel>}
              {custom.map((g) => (
                <DropdownMenuItem key={g.id} onClick={() => onToggleGroup(g.id, m.symbol)}>
                  <Check size={13} className={g.symbols.includes(m.symbol) ? "opacity-100" : "opacity-0"} /> {g.name}
                </DropdownMenuItem>
              ))}
              {custom.length > 0 && secs.length > 0 && <DropdownMenuSeparator />}
              {secs.length > 0 && <DropdownMenuLabel className="text-[10px] text-[#787b86]">Bölüme taşı</DropdownMenuLabel>}
              {secs.map((s) => (
                <DropdownMenuItem key={s.id} data-testid={`watchlist-move-${m.symbol}-${s.id}`} onClick={() => onMove(m.symbol, s.id)}>
                  <Check size={13} className={sec === s.id ? "opacity-100" : "opacity-0"} /> {s.name}
                </DropdownMenuItem>
              ))}
              {secs.length > 0 && sec && sec !== OTHER && (
                <DropdownMenuItem data-testid={`watchlist-move-${m.symbol}-out`} onClick={() => onMove(m.symbol, OTHER)}><X size={13} /> Bölümden çıkar</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div data-testid={`watchlist-price-${m.symbol}`} className={`num text-right pr-1 rounded-sm transition-colors duration-300 text-white ${bg}`}>{fmtPrice(t?.c, m.dec)}</div>
      <div className={`num text-right ${col}`}>{fmtPct(t?.P)}</div>
      <div className="num text-right text-[#b2b5be]">{fmtVol(t?.q)}</div>
      <div className={`num text-right pr-1 text-[11px] ${fr > 0 ? "text-[#0ecb81]" : fr < 0 ? "text-[#f6465d]" : "text-[#b2b5be]"}`}>
        {fmtFunding(t?.r)}<span className="text-[#787b86]"> ({m.fundingHours}s)</span>
      </div>
    </div>
  );
});

export function Watchlist({ symbols, current, onSelect, favorites, updateFavs, prefs, setPrefs }) {
  const tickers = useTickers();
  const tab = favorites.some((g) => g.id === prefs?.tab) || ["crypto", "commodity"].includes(prefs?.tab) ? prefs.tab : "fav";
  const setTab = (t) => setPrefs({ ...prefs, tab: t });
  const sort = useMemo(() => prefs?.sort || { k: "q", d: -1 }, [prefs?.sort]);
  const setSort = (fn) => setPrefs({ ...prefs, sort: fn(sort) });
  const [q, setQ] = useState("");
  const [scroll, setScroll] = useState(0); const [h, setH] = useState(400);
  const [adding, setAdding] = useState(false); const [gname, setGname] = useState("");
  const box = useRef();
  useEffect(() => { const ro = new ResizeObserver(() => setH(box.current?.clientHeight || 400)); ro.observe(box.current); return () => ro.disconnect(); }, []);
  const favSet = useMemo(() => new Set(favorites.find((g) => g.id === "fav")?.symbols || []), [favorites]);
  const tabs = [...favorites.map((g) => ({ id: g.id, name: g.name, custom: g.id !== "fav" })), { id: "crypto", name: "Kripto" }, { id: "commodity", name: "Emtia" }];
  const sd = useMemo(() => prefs?.sections?.[tab] || {}, [prefs?.sections, tab]);
  const secs = useMemo(() => sd.list || [], [sd]);
  const setSd = (patch) => setPrefs({ ...prefs, sections: { ...(prefs?.sections || {}), [tab]: { ...sd, ...patch } } });
  const manual = !sort.k && !q;
  const list = useMemo(() => {
    let l;
    if (tab === "crypto") l = symbols.filter((s) => ["COIN", "INDEX", "PREMARKET"].includes(s.type));
    else if (tab === "commodity") l = symbols.filter((s) => s.type === "COMMODITY");
    else { const g = favorites.find((x) => x.id === tab); const set = new Set(g?.symbols || []); l = symbols.filter((s) => set.has(s.symbol)); }
    if (q) { const u = q.toUpperCase(); l = l.filter((s) => s.symbol.includes(u)); }
    if (!sort.k) {
      const ord = new Map((sd.order || []).map((s, i) => [s, i])); const vol = (s) => +(tickers[s.symbol]?.q ?? 0);
      return [...l].sort((a, b) => (ord.get(a.symbol) ?? 1e9) - (ord.get(b.symbol) ?? 1e9) || vol(b) - vol(a));
    }
    const val = (s) => { const t = tickers[s.symbol] || {}; return sort.k === "s" ? s.symbol : sort.k === "r" ? +(t.r ?? 0) : t[sort.k] ?? -Infinity; };
    return [...l].sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * sort.d; });
  }, [symbols, tab, favorites, q, tickers, sort, sd.order]);
  const items = useMemo(() => manual ? buildItems(list, secs, !!sd.otherCollapsed) : list.map((m) => ({ k: "r", m })), [manual, list, secs, sd.otherCollapsed]);
  const [secName, setSecName] = useState(null);
  const addSection = () => {
    const n = (secName || "").trim(); setSecName(null); if (!n) return;
    setPrefs({ ...prefs, sort: { k: null }, sections: { ...(prefs?.sections || {}), [tab]: { ...sd, list: [...secs, { id: uid(), name: n, symbols: [] }] } } });
  };
  const toggleSec = (id) => id === OTHER ? setSd({ otherCollapsed: !sd.otherCollapsed }) : setSd({ list: secs.map((s) => s.id === id ? { ...s, collapsed: !s.collapsed } : s) });
  const renameSec = (id, name) => setSd({ list: secs.map((s) => s.id === id ? { ...s, name } : s) });
  const deleteSec = (id) => setSd({ list: secs.filter((s) => s.id !== id) });
  const place = (sym, target, pos) => {
    const l2 = secs.map((s) => ({ ...s, symbols: s.symbols.filter((x) => x !== sym) }));
    if (target === OTHER) {
      const inSec = new Set(l2.flatMap((s) => s.symbols));
      const rest = list.map((m) => m.symbol).filter((x) => x !== sym && !inSec.has(x));
      rest.splice(pos ?? rest.length, 0, sym); setSd({ list: l2, order: rest });
    } else setSd({ list: l2.map((s) => s.id !== target ? s : { ...s, symbols: [...s.symbols.slice(0, pos ?? s.symbols.length), sym, ...s.symbols.slice(pos ?? s.symbols.length)] }) });
  };
  const curSec = useMemo(() => { const m = {}; secs.forEach((s) => s.symbols.forEach((x) => { m[x] = s.id; })); return m; }, [secs]);
  const [drag, setDrag] = useState(null);
  const dropAt = (sym, ins) => {
    let j = ins - 1, pos = 0;
    while (j >= 0 && items[j].k !== "h") { if (items[j].m.symbol !== sym) pos++; j--; }
    place(sym, j < 0 ? items[0].id : items[j].id, j < 0 ? 0 : pos);
  };
  const onGrip = (e, sym) => {
    e.preventDefault(); e.stopPropagation();
    const calc = (cy) => {
      const el = box.current, r = el.getBoundingClientRect();
      if (cy < r.top + 40) el.scrollTop -= 12; else if (cy > r.bottom - 30) el.scrollTop += 12;
      return Math.max(0, Math.min(items.length, Math.round((cy - r.top + el.scrollTop - 28) / ROW)));
    };
    setDrag({ sym, ins: calc(e.clientY) });
    const mv = (ev) => setDrag({ sym, ins: calc(ev.clientY) });
    const up = (ev) => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); dropAt(sym, calc(ev.clientY)); setDrag(null); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };
  const star = (sym) => updateFavs((gs) => gs.map((g) => g.id !== "fav" ? g : { ...g, symbols: g.symbols.includes(sym) ? g.symbols.filter((x) => x !== sym) : [...g.symbols, sym] }));
  const toggleGroup = (gid, sym) => updateFavs((gs) => gs.map((g) => g.id !== gid ? g : { ...g, symbols: g.symbols.includes(sym) ? g.symbols.filter((x) => x !== sym) : [...g.symbols, sym] }));
  const addGroup = () => { const n = gname.trim(); if (!n) return setAdding(false); const id = uid(); updateFavs((gs) => [...gs, { id, name: n, symbols: [] }]); setPrefs({ ...prefs, tab: id }); setGname(""); setAdding(false); };
  const delGroup = (id) => { updateFavs((gs) => gs.filter((g) => g.id !== id)); setTab("fav"); };
  const start = Math.max(0, Math.floor(scroll / ROW) - 5), end = Math.min(items.length, start + Math.ceil(h / ROW) + 10);
  const H = ({ k, l, cls = "" }) => (
    <button data-testid={`watchlist-sort-${k}`} onClick={() => setSort((s) => { const i = k === "s" ? 1 : -1; return s.k !== k ? { k, d: i } : s.d === i ? { k, d: -i } : { k: null }; })} className={`text-[10px] uppercase tracking-wide ${sort.k === k ? "text-[#d1d4dc]" : "text-[#787b86]"} ${cls}`}>{l}{sort.k === k ? (sort.d < 0 ? " ↓" : " ↑") : ""}</button>
  );
  return (
    <div className="flex flex-col h-full min-h-0" data-testid="watchlist-panel">
      <div className="flex items-center gap-1 px-2 border-b border-[#1e222d] overflow-x-auto ev-noscroll shrink-0">
        {tabs.map((t) => (
          <div key={t.id} className={`flex items-center shrink-0 border-b-2 ${tab === t.id ? "border-white" : "border-transparent"}`}>
            <button data-testid={`watchlist-tab-${t.id}`} onClick={() => setTab(t.id)} className={`py-2 px-1.5 text-[12px] flex items-center gap-1 ${tab === t.id ? "text-white" : "text-[#787b86] hover:text-[#d1d4dc]"}`}>
              {t.id === "fav" && <Star size={11} className="fill-current" />}{t.name}
            </button>
            {t.custom && tab === t.id && <button data-testid={`watchlist-delete-group-${t.id}`} onClick={() => delGroup(t.id)} className="text-[#787b86] hover:text-[#f23645]"><X size={12} /></button>}
          </div>
        ))}
        {adding ? (
          <input autoFocus data-testid="watchlist-new-group-input" value={gname} onChange={(e) => setGname(e.target.value)} onBlur={addGroup} onKeyDown={(e) => e.key === "Enter" && addGroup()} placeholder="Grup adı" className="w-24 bg-[#131722] text-[12px] px-2 py-1 rounded outline-none shrink-0" />
        ) : <button data-testid="watchlist-add-group-button" onClick={() => setAdding(true)} className="p-1.5 text-[#787b86] hover:text-white shrink-0"><Plus size={14} /></button>}
      </div>
      <div className="px-2 py-1.5 shrink-0 flex items-center gap-1">
        <div className="flex-1 flex items-center gap-2 bg-[#131722] rounded px-2 h-8 min-w-0">
          <Search size={13} className="text-[#787b86]" />
          <input data-testid="watchlist-search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sembol ara" className="bg-transparent outline-none text-[12px] flex-1 min-w-0" />
        </div>
        {secName !== null ? (
          <input autoFocus data-testid="watchlist-new-section-input" value={secName} onChange={(e) => setSecName(e.target.value)} onBlur={addSection}
            onKeyDown={(e) => { if (e.key === "Enter") addSection(); if (e.key === "Escape") setSecName(null); }} placeholder="Bölüm adı" className="w-28 h-8 bg-[#131722] text-[12px] px-2 rounded outline-none" />
        ) : <button data-testid="watchlist-add-section-button" title="Bölüm ekle" onClick={() => setSecName("")} className="h-8 w-8 flex items-center justify-center rounded text-[#787b86] hover:text-white hover:bg-[#131722]"><FolderPlus size={15} /></button>}
      </div>
      {secs.length > 0 && sort.k && (
        <div className="px-3 pb-1 text-[11px] text-[#787b86] flex items-center gap-2 shrink-0" data-testid="watchlist-sort-hint">
          Sıralama açık, bölümler gizli
          <button data-testid="watchlist-clear-sort" onClick={() => setPrefs({ ...prefs, sort: { k: null } })} className="text-[#d1d4dc] underline underline-offset-2">Bölümleri göster</button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto ev-scroll" ref={box} onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
        <div className="min-w-[440px]">
          <div className="grid items-center h-7 px-1 sticky top-0 bg-[#0c0d0f] z-[1] border-b border-[#1e222d]" style={{ gridTemplateColumns: GRID }}>
            <span /><H k="s" l="Sembol" cls="text-left" /><H k="c" l="Son" cls="text-right pr-1" /><H k="P" l="%Değ" cls="text-right" /><H k="q" l="Hacim" cls="text-right" /><H k="r" l="Funding" cls="text-right pr-1" />
          </div>
          <div style={{ height: items.length * ROW, position: "relative" }}>
            <div style={{ position: "absolute", top: start * ROW, left: 0, right: 0 }}>
              {items.slice(start, end).map((it) => it.k === "h"
                ? <SectionHeader key={`h-${it.id}`} it={it} onToggle={toggleSec} onRename={renameSec} onDelete={deleteSec} />
                : <Row key={it.m.symbol} m={it.m} t={tickers[it.m.symbol]} fav={favSet.has(it.m.symbol)} active={it.m.symbol === current} groups={favorites} onSelect={onSelect} onStar={star} onToggleGroup={toggleGroup}
                    secs={manual ? secs : []} sec={curSec[it.m.symbol] || OTHER} onMove={(s, t) => place(s, t)} onGrip={manual ? onGrip : null} ghost={drag?.sym === it.m.symbol} />)}
            </div>
            {drag && <div data-testid="watchlist-drop-indicator" className="absolute left-0 right-0 h-0.5 bg-white pointer-events-none" style={{ top: drag.ins * ROW - 1 }} />}
          </div>
          {!list.length && <p className="text-center text-[12px] text-[#787b86] py-6" data-testid="watchlist-empty">Liste boş</p>}
        </div>
      </div>
    </div>
  );
}
