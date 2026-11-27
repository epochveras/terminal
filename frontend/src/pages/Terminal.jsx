
Şuradan devam edildi:
Render Logs Review (38)
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List, Bell, Activity, X, Pencil } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandItem } from "@/components/ui/command";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { market, fetchSymbols } from "@/lib/market";
import { decFromTick } from "@/lib/format";
import { EPOCH_SCHEMA, RSI_SCHEMA } from "@/lib/indicators";
import { unlockAudio } from "@/lib/alerts";
import { useAuth } from "@/context/AuthContext";
import { useWorkspace, useAlarms, usePush, useIsMobile } from "@/hooks/useTerminal";
import { Splash } from "@/components/Splash";
import ChartView from "@/components/ChartView";
import { TopBar } from "@/components/TopBar";
import { DrawingToolbar, DrawingProps, STYLED } from "@/components/Drawing";
import { AlarmNotices } from "@/components/AlarmNotices";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Watchlist } from "@/components/Watchlist";
import { AlarmPanel } from "@/components/AlarmPanel";
import { FuturesPanel } from "@/components/FuturesPanel";
import { IndicatorDialog } from "@/components/IndicatorDialog";

const PANELS = [
  ["watchlist", "Watchlist", List],
  ["alarms", "Alarmlar", Bell],
  ["futures", "Futures Data", Activity],
];

const SYMBOL_CACHE_KEY = "ev_symbols";

function getCachedSymbols() {
  try {
    const cached = JSON.parse(
      localStorage.getItem(SYMBOL_CACHE_KEY) || "null"
    );

    return Array.isArray(cached) && cached.length ? cached : null;
  } catch {
    return null;
  }
}

function PanelBox({ id, title, Icon, onClose, children }) {
  return (
    <div
      className="flex flex-col h-full min-h-0 bg-[#0c0d0f]"
      data-testid={panel-${id}}
    >
      <div className="flex items-center gap-2 px-3 h-8 border-b border-[#1e222d] shrink-0">
        <Icon size={13} className="text-[#787b86]" />
        <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-[#d1d4dc]">
          {title}
        </span>

        {onClose && (
          <button
            data-testid={panel-close-${id}}
            onClick={onClose}
            className="ml-auto p-1 text-[#787b86] hover:text-white"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

export default function Terminal() {
  const { user, logout } = useAuth();

  const {
    settings,
    update,
    favorites,
    updateFavs,
  } = useWorkspace(user?.id);

  const [symbols, setSymbols] = useState(() => getCachedSymbols());
  const [tool, setTool] = useState("cursor");
  const [sel, setSel] = useState(null);
  const [search, setSearch] = useState(false);
  const [indDlg, setIndDlg] = useState(null);
  const [live, setLive] = useState(false);
  const [sheet, setSheet] = useState(null);

  // Çizim paneli tercihi ortak workspace üzerinden yönetilir.
  const drawingOpen = settings.drawingOpen ?? true;

  const engine = useRef(null);
  const mobile = useIsMobile();

  const symbol = settings.symbol;
  const tf = settings.tf;

  useEffect(() => {
    let alive = true;
    let retryTimer;

    const load = async () => {
      try {
        const response = await fetchSymbols();

        if (!alive) return;

        const list = response.map((s) => ({
          ...s,
          dec: decFromTick(s.tick),
        }));

        if (list.length) {
          setSymbols(list);

          try {
            localStorage.setItem(
              SYMBOL_CACHE_KEY,
              JSON.stringify(list)
            );
          } catch {
            // Cache storage is optional.
          }
        }
      } catch (error) {
        console.warn(
          "Binance sembol listesi alınamadı:",
          error
        );

        if (!alive) return;

        setSymbols((current) =>
          current?.length
            ? current
            : [{
                symbol: settings.symbol || "BTCUSDT",
                tick: "0.01",
                dec: 2,
                type: "COIN",
              }]
        );

        retryTimer = setTimeout(load, 10000);
      }
    };

    load();

    market.start();

    const off = market.onStatus(setLive);

    const sym = new URLSearchParams(
      window.location.search
    ).get("symbol");

    if (sym) {
      update({ symbol: sym.toUpperCase() });
      window.history.replaceState({}, "", "/");
    }

    window.addEventListener(
      "pointerdown",
      unlockAudio,
      { once: true }
    );

    return () => {
      alive = false;
      clearTimeout(retryTimer);
      off();
    };
  }, [update, settings.symbol]);

  const metaMap = useMemo(() => {
    const map = Object.fromEntries(
      (symbols || []).map((s) => [s.symbol, s])
    );

    if (!map[symbol]) {
      map[symbol] = {
        symbol,
        tick: "0.01",
        dec: 2,
        type: "COIN",
      };
    }

    return map;
  }, [symbols, symbol]);

  const symbolList = useMemo(() => {
    const list = symbols || [];

    return list.some((s) => s.symbol === symbol)
      ? list
      : [...list, metaMap[symbol]];
  }, [symbols, symbol, metaMap]);

  const meta = metaMap[symbol];

  const [notices, setNotices] = useState([]);
  const [confirmClear, setConfirmClear] = useState(false);

  const closeNotice = useCallback(
    (id) => setNotices((l) => l.filter((x) => x.id !== id)),
    []
  );

  const onTrigger = useCallback((a) => {
    setNotices((l) => [...l.slice(-3), a]);
    setTimeout(() => closeNotice(a.id), 20000);
  }, [closeNotice]);

  const {
    alarms,
    add,
    remove,
    clearHistory,
  } = useAlarms(settings.sound, metaMap, onTrigger);

  const push = usePush();

  useEffect(() => {
    engine.current?.setTool(tool);
  }, [tool]);

  useEffect(() => {
    engine.current?.setMagnet(settings.magnet);
    engine.current?.setDefaults(settings.toolDefaults);
  }, [settings.magnet, settings.toolDefaults, meta]);

  const saveTimer = useRef();
  const [hist, setHist] = useState({
    undo: false,
    redo: false,
  });

  useEffect(() => {
    const onKey = (e) => {
      if (
        !(e.ctrlKey || e.metaKey) ||
        /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) ||
        e.target.isContentEditable
      ) {
        return;
      }

      const k = e.key.toLowerCase();

      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        engine.current?.undo();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        engine.current?.redo();
      }
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cb = {
    onSelect: setSel,

    onToolDone: () => setTool("cursor"),

    onDrawingsChange: (list) => {
      const s = symbol;

      clearTimeout(saveTimer.current);

      saveTimer.current = setTimeout(() => {
        api.put(/drawings/${s}, { drawings: list })
          .catch(() => toast.error("Çizim kaydedilemedi"));
      }, 500);
    },

    onAddAlarm: (price) =>
      add(symbol, price, market.tickers[symbol]?.c),

    onDeleteAlarm: (id) => remove(id),

    onRsiRatio: (r) => update({ rsiRatio: r }),

    onHistory: setHist,
  };

  const changeDrawing = (patch) => {
    engine.current?.updateSelected(patch);

    if (sel && STYLED.includes(sel.type)) {
      update((s) => ({
        toolDefaults: {
          ...s.toolDefaults,
          [sel.type]: {
            ...(s.toolDefaults[sel.type] || {}),
            ...patch,
          },
        },
      }));
    }
  };

  const selectSymbol = useCallback(
    (s, keepSheetOpen = false) => {
      update({ symbol: s });
      setSel(null);

      if (!keepSheetOpen) {
        setSheet(null);
      }
    },
    [update]
  );

  const setPanel = (k, v) =>
    update((s) => ({
      panels: {
        ...s.panels,
        [k]: v,
      },
    }));

  const togglePanel = (k) => {
    if (mobile) {
      setSheet(sheet === k ? null : k);
    } else {
      setPanel(k, !settings.panels[k]);
    }
  };

  const content = {
    watchlist: (
      <Watchlist
        symbols={symbolList}
        current={symbol}
        onSelect={(s) => selectSymbol(s, true)}
        favorites={favorites}
        updateFavs={updateFavs}
        prefs={settings.watchlist}
        setPrefs={(w) => update({ watchlist: w })}
      />
    ),

    alarms: (
      <AlarmPanel
        onSelect={selectSymbol}
        alarms={alarms}
        symbol={symbol}
        metaMap={metaMap}
        add={add}
        remove={remove}
        clearHistory={clearHistory}
        sound={settings.sound}
        setSound={(v) => update({ sound: v })}
        push={push}
      />
    ),

    futures: (
      <FuturesPanel
        symbol={symbol}
        meta={meta}
      />
    ),
  };

  const open = PANELS.filter(
    ([k]) => settings.panels[k]
  );

  const activeCount = alarms.filter(
    (a) => a.active
  ).length;

  return (
    <div
      className="h-[100dvh] w-full flex flex-col bg-black overflow-hidden"
      data-testid="terminal-root"
    >
      <TopBar
        symbol={symbol}
        tf={tf}
        setTf={(k) => update({ tf: k })}
        onSearch={() => setSearch(true)}
        settings={settings}
        toggleInd={(k, c) =>
          update((s) => ({
            [k]: {
              ...s[k],
              enabled: c,
            },
          }))
        }
        openInd={setIndDlg}
        onAlarm={() => togglePanel("alarms")}
        hist={hist}
        onUndo={() => engine.current?.undo()}
        onRedo={() => engine.current?.redo()}
        live={live}
        user={user}
        logout={logout}
      />

      <div className="flex-1 min-h-0 flex">
        {drawingOpen && (
          <DrawingToolbar
            tool={tool}
            setTool={setTool}
            magnet={settings.magnet}
          
…
Terminal.jsx dosyasını aldım. İstediğin özellik için mevcut yapıda uygun yer var: kutucuk doğrudan grafik alanının üzerine yerleşebilir.

Coin değiştirmeyi favorites listesinden yapacağız. Böylece Watchlist panelini açmadan favoriler arasında yukarı/aşağı geçebileceksin. Kutucuk yalnızca mobilde görünecek; masaüstü görünümü ve alttan açılan Watchlist paneli değişmeyecek.

Şimdi bir dosya daha gönder: Watchlist.jsx.

Favorilerin nasıl sıralandığını ve coinlerin nasıl seçildiğini oradan kontrol edeceğim. Böylece kutucuk Watchlist ile aynı sırayı kullanacak ve mevcut coin değiştirme mantığını bozmayacak.

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
    <div data-testid={watchlist-row-${m.symbol}} onClick={() => onSelect(m.symbol)}
      className={grid items-center h-[30px] px-1 cursor-pointer text-[12px] border-l-2 ${ghost ? "opacity-30" : ""} ${active ? "bg-[#1e222d] border-white" : "border-transparent hover:bg-[#131722]"}} style={{ gridTemplateColumns: GRID }}>
      <button data-testid={watchlist-star-${m.symbol}} onClick={(e) => { e.stopPropagation(); onStar(m.symbol); }} className="flex items-center justify-center h-full">
        <Star size={13} className={fav ? "fill-[#f0b90b] text-[#f0b90b]" : "text-[#50535e]"} />
      </button>
      <div className="truncate flex items-center gap-1 min-w-0">
        {onGrip && <span data-testid={watchlist-drag-${m.symbol}} onPointerDown={(e) => onGrip(e, m.symbol)} onClick={(e) => e.stopPropagation()}
          className="text-[#50535e] hover:text-white cursor-grab touch-none -ml-0.5 py-1.5"><GripVertical size={12} /></span>}
        <span className="font-semibold text-[#d1d4dc]">{m.base}</span><span className="text-[#50535e] text-[11px]">{m.quote}</span>
        {(custom.length > 0 || secs.length > 0) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button data-testid={watchlist-group-menu-${m.symbol}} className="ml-auto text-[#50535e] hover:text-white px-1"><ListPlus size={13} /></button>
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
                <DropdownMenuItem key={s.id} data-testid={watchlist-move-${m.symbol}-${s.id}} onClick={() => onMove(m.symbol, s.id)}>
                  <Check size={13} className={sec === s.id ? "opacity-100" : "opacity-0"} /> {s.name}
                </DropdownMenuItem>
              ))}
              {secs.length > 0 && sec && sec !== OTHER && (
                <DropdownMenuItem data-testid={watchlist-move-${m.symbol}-out} onClick={() => onMove(m.symbol, OTHER)}><X size={13} /> Bölümden çıkar</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div data-testid={watchlist-price-${m.symbol}} className={num text-right pr-1 rounded-sm transition-colors duration-300 text-white ${bg}}>{fmtPrice(t?.c, m.dec)}</div>
      <div className={num text-right ${col}}>{fmtPct(t?.P)}</div>
      <div className="num text-right text-[#b2b5be]">{fmtVol(t?.q)}</div>
      <div className={num text-right pr-1 text-[11px] ${fr > 0 ? "text-[#0ecb81]" : fr < 0 ? "text-[#f6465d]" : "text-[#b2b5be]"}}>
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

  // Bölüm başlıklarını koru; sıralı liste her bölümün kendi içinde gösterilir.
  const items = useMemo(
    () => buildItems(list, secs, !!sd.otherCollapsed),
    [list, secs, sd.otherCollapsed]
  );

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
  const star = (sym) => updateFavs((gs) => gs.map((g) => g.id !== "fav" ? g : { ...g, symbols: g.symbols.includes(sym) ? g.symbols.filter
…
Watchlist.jsx dosyasını da aldım. Favori coinlerin sırasının favorites içindeki fav grubundan geldiğini gördüm.

Mobil kutucukta şu davranışı uygulayacağız:

Mevcut coin kutucukta görünecek.

Parmağını yukarı kaydırınca favorilerdeki sonraki coin seçilecek.

Aşağı kaydırınca önceki coin seçilecek.

Listenin sonuna gelince başa, başına gelince sona geçecek.

Coin seçimi mevcut selectSymbol fonksiyonunu kullanacak.

Watchlist panelinin açılma şekline, sıralamasına ve masaüstüne dokunmayacağız.

Kodları hazırlarken yalnızca Terminal.jsx üzerinde çalışmamız yeterli görünüyor; Watchlist.jsx değişmeden kalabilir.

Bu da ilgini çekebilir.



Reklam
Tamam tam kodu yaz

23s düşündü

Hazır Terminal.jsx dosyasının tamamını düzenledim.

Terminal.jsx dosyasını indir

Yaptığım değişiklikler:

Mobilde grafiğin sol üstünde küçük coin kutucuğu.

Yukarı kaydırınca sonraki favori, aşağı kaydırınca önceki favori.

Ok tuşlarıyla da coin değiştirme.

Favorilerde olmayan mevcut coin de kutucukta gösterilir.

Watchlist panelinin açılma şekli ve masaüstü görünümü değiştirilmedi.

Watchlist.jsx dosyasına dokunulmadı.

Kurulum: İndirdiğin dosyayla projendeki Terminal.jsx dosyasını değiştir.

Not: Kod değişikliğini hazırladım ancak projede derleme ve gerçek telefonda test yapmadım. Önce mobilde kutucuğun görünmesini ve coin geçişini kontrol edelim.


Terminal.jsx
Kod




import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List, Bell, Activity, X, Pencil, ChevronUp, ChevronDown } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandItem } from "@/components/ui/command";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { market, fetchSymbols } from "@/lib/market";
import { decFromTick } from "@/lib/format";
import { EPOCH_SCHEMA, RSI_SCHEMA } from "@/lib/indicators";
import { unlockAudio } from "@/lib/alerts";
import { useAuth } from "@/context/AuthContext";
import { useWorkspace, useAlarms, usePush, useIsMobile } from "@/hooks/useTerminal";
import { Splash } from "@/components/Splash";
import ChartView from "@/components/ChartView";
import { TopBar } from "@/components/TopBar";
import { DrawingToolbar, DrawingProps, STYLED } from "@/components/Drawing";
import { AlarmNotices } from "@/components/AlarmNotices";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Watchlist } from "@/components/Watchlist";
import { AlarmPanel } from "@/components/AlarmPanel";
import { FuturesPanel } from "@/components/FuturesPanel";
import { IndicatorDialog } from "@/components/IndicatorDialog";

const PANELS = [
  ["watchlist", "Watchlist", List],
  ["alarms", "Alarmlar", Bell],
  ["futures", "Futures Data", Activity],
];

const SYMBOL_CACHE_KEY = "ev_symbols";

function getCachedSymbols() {
  try {
    const cached = JSON.parse(
      localStorage.getItem(SYMBOL_CACHE_KEY) || "null"
    );

    return Array.isArray(cached) && cached.length ? cached : null;
  } catch {
    return null;
  }
}

function PanelBox({ id, title, Icon, onClose, children }) {
  return (
    <div
      className="flex flex-col h-full min-h-0 bg-[#0c0d0f]"
      data-testid={`panel-${id}`}
    >
      <div className="flex items-center gap-2 px-3 h-8 border-b border-[#1e222d] shrink-0">
        <Icon size={13} className="text-[#787b86]" />
        <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-[#d1d4dc]">
          {title}
        </span>

        {onClose && (
          <button
            data-testid={`panel-close-${id}`}
            onClick={onClose}
            className="ml-auto p-1 text-[#787b86] hover:text-white"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

export default function Terminal() {
  const { user, logout } = useAuth();

  const {
    settings,
    update,
    favorites,
    updateFavs,
  } = useWorkspace(user?.id);

  const [symbols, setSymbols] = useState(() => getCachedSymbols());
  const [tool, setTool] = useState("cursor");
  const [sel, setSel] = useState(null);
  const [search, setSearch] = useState(false);
  const [indDlg, setIndDlg] = useState(null);
  const [live, setLive] = useState(false);
  const [sheet, setSheet] = useState(null);

  // Çizim paneli tercihi ortak workspace üzerinden yönetilir.
  const drawingOpen = settings.drawingOpen ?? true;

  const engine = useRef(null);
  const mobile = useIsMobile();
  const mobileSwipeStart = useRef(null);
