
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List, Bell, Activity, X } from "lucide-react";
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

const PANELS = [["watchlist", "Watchlist", List], ["alarms", "Alarmlar", Bell], ["futures", "Futures Data", Activity]];

const SYMBOL_CACHE_KEY = "ev_symbols";

function getCachedSymbols() {
  try {
    const cached = JSON.parse(localStorage.getItem(SYMBOL_CACHE_KEY) || "null");
    return Array.isArray(cached) && cached.length ? cached : null;
  } catch {
    return null;
  }
}

function PanelBox({ id, title, Icon, onClose, children }) {
  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0c0d0f]" data-testid={`panel-${id}`}>
      <div className="flex items-center gap-2 px-3 h-8 border-b border-[#1e222d] shrink-0">
        <Icon size={13} className="text-[#787b86]" />
        <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-[#d1d4dc]">{title}</span>
        {onClose && <button data-testid={`panel-close-${id}`} onClick={onClose} className="ml-auto p-1 text-[#787b86] hover:text-white"><X size={13} /></button>}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

export default function Terminal() {
  const { user, logout } = useAuth();
  const { settings, update, favorites, updateFavs } = useWorkspace(user?.id);

  const [symbols, setSymbols] = useState(() => getCachedSymbols());
  const [tool, setTool] = useState("cursor");
  const [sel, setSel] = useState(null);
  const [search, setSearch] = useState(false);
  const [indDlg, setIndDlg] = useState(null);
  const [live, setLive] = useState(false);
  const [sheet, setSheet] = useState(null);
  const engine = useRef(null);
  const mobile = useIsMobile();
  const symbol = settings.symbol, tf = settings.tf;

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
            localStorage.setItem(SYMBOL_CACHE_KEY, JSON.stringify(list));
          } catch {
            // Cache storage is optional.
          }
        }
      } catch (error) {
        console.warn("Binance sembol listesi alınamadı:", error);

        if (!alive) return;

        setSymbols((current) => current?.length ? current : [{
          symbol: settings.symbol || "BTCUSDT",
          tick: "0.01",
          dec: 2,
          type: "COIN",
        }]);

        retryTimer = setTimeout(load, 10000);
      }
    };

    load();

    market.start();
    const off = market.onStatus(setLive);

    const sym = new URLSearchParams(window.location.search).get("symbol");
    if (sym) {
      update({ symbol: sym.toUpperCase() });
      window.history.replaceState({}, "", "/");
    }

    window.addEventListener("pointerdown", unlockAudio, { once: true });

    return () => {
      alive = false;
      clearTimeout(retryTimer);
      off();
    };
  }, [update, settings.symbol]);

  const metaMap = useMemo(() => {
    const map = Object.fromEntries((symbols || []).map((s) => [s.symbol, s]));

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

  const closeNotice = useCallback((id) => setNotices((l) => l.filter((x) => x.id !== id)), []);

  const onTrigger = useCallback((a) => {
    setNotices((l) => [...l.slice(-3), a]);
    setTimeout(() => closeNotice(a.id), 20000);
  }, [closeNotice]);

  const { alarms, add, remove, clearHistory } = useAlarms(settings.sound, metaMap, onTrigger);
  const push = usePush();

  useEffect(() => {
    engine.current?.setTool(tool);
  }, [tool]);

  useEffect(() => {
    engine.current?.setMagnet(settings.magnet);
    engine.current?.setDefaults(settings.toolDefaults);
  }, [settings.magnet, settings.toolDefaults, meta]);

  const saveTimer = useRef();
  const [hist, setHist] = useState({ undo: false, redo: false });

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
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
      saveTimer.current = setTimeout(() => api.put(`/drawings/${s}`, { drawings: list }).catch(() => toast.error("Çizim kaydedilemedi")), 500);
    },
    onAddAlarm: (price) => add(symbol, price, market.tickers[symbol]?.c),
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
          [sel.type]: { ...(s.toolDefaults[sel.type] || {}), ...patch },
        },
      }));
    }
  };

  const selectSymbol = useCallback((s, keepSheetOpen = false) => {
    update({ symbol: s });
    setSel(null);

    if (!keepSheetOpen) {
      setSheet(null);
    }
  }, [update]);

  const setPanel = (k, v) => update((s) => ({ panels: { ...s.panels, [k]: v } }));
  const togglePanel = (k) => {
    if (mobile) setSheet(sheet === k ? null : k);
    else setPanel(k, !settings.panels[k]);
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
    alarms: <AlarmPanel onSelect={selectSymbol} alarms={alarms} symbol={symbol} metaMap={metaMap} add={add} remove={remove} clearHistory={clearHistory} sound={settings.sound} setSound={(v) => update({ sound: v })} push={push} />,
    futures: <FuturesPanel symbol={symbol} meta={meta} />,
  };

  const open = PANELS.filter(([k]) => settings.panels[k]);
  const activeCount = alarms.filter((a) => a.active).length;

  return (
    <div className="h-[100dvh] w-full flex flex-col bg-black overflow-hidden" data-testid="terminal-root">
      <TopBar symbol={symbol} tf={tf} setTf={(k) => update({ tf: k })} onSearch={() => setSearch(true)} settings={settings}
        toggleInd={(k, c) => update((s) => ({ [k]: { ...s[k], enabled: c } }))} openInd={setIndDlg}
        onAlarm={() => togglePanel("alarms")} hist={hist} onUndo={() => engine.current?.undo()} onRedo={() => engine.current?.redo()} live={live} user={user} logout={logout} />

      <div className="flex-1 min-h-0 flex">
        <DrawingToolbar tool={tool} setTool={setTool} magnet={settings.magnet} setMagnet={(m) => update({ magnet: m })}
          onClear={() => setConfirmClear(true)} />

        <PanelGroup direction="horizontal" autoSaveId="ev-main" className="flex-1 min-w-0">
          <Panel id="chart" order={1} minSize={35}>
            <div className="relative h-full">
              <ChartView symbol={symbol} meta={meta} tf={tf} settings={settings} alarms={alarms} cb={cb} engineRef={engine} />
              <DrawingProps sel={sel} onChange={changeDrawing} onDelete={() => engine.current?.deleteSelected()} />
            </div>
          </Panel>

          {!mobile && open.length > 0 && (
            <>
              <PanelResizeHandle className="ev-handle w-[3px]" data-testid="sidebar-resize-handle" />
              <Panel id="side" order={2} defaultSize={26} minSize={16} maxSize={60}>
                <PanelGroup direction="vertical" autoSaveId={`ev-side-${open.map((x) => x[0]).join("-")}`}>
                  {open.map(([k, title, Icon], i) => (
                    <Fragment key={k}>
                      {i > 0 && <PanelResizeHandle className="ev-handle h-[3px]" data-testid={`panel-resize-${k}`} />}
                      <Panel id={k} order={i + 1} minSize={8}>
                        <PanelBox id={k} title={title} Icon={Icon} onClose={() => setPanel(k, false)}>{content[k]}</PanelBox>
                      </Panel>
                    </Fragment>
                  ))}
                </PanelGroup>
              </Panel>
            </>
          )}
        </PanelGroup>

        <div className="w-11 shrink-0 bg-[#0c0d0f] border-l border-[#2a2e39] flex flex-col items-center gap-1 py-2" data-testid="right-rail">
          {PANELS.map(([k, title, Icon]) => {
            const on = mobile ? sheet === k : settings.panels[k];
            return (
              <button key={k} data-testid={`${k === "futures" ? "futures-data" : k}-tab-button`} title={title} onClick={() => togglePanel(k)}
                className={`relative w-10 h-10 md:w-9 md:h-9 flex items-center justify-center rounded-md ${on ? "bg-[#1e222d] text-white" : "text-[#b2b5be] hover:bg-[#171b26]"}`}>
                <Icon size={18} />
                {k === "alarms" && activeCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#e0a020] text-black text-[10px] font-bold flex items-center justify-center">{activeCount}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {mobile && (
        <Sheet open={!!sheet} onOpenChange={(o) => !o && setSheet(null)}>
          <SheetContent side="bottom" className="h-[55dvh] p-0 bg-[#0c0d0f] border-[#2a2e39]" data-testid="mobile-panel-sheet">
            <SheetTitle className="sr-only">{sheet}</SheetTitle>
            {sheet && (() => {
              const [k, title, Icon] = PANELS.find((p) => p[0] === sheet);
              return <PanelBox id={`m-${k}`} title={title} Icon={Icon}>{content[k]}</PanelBox>;
            })()}
          </SheetContent>
        </Sheet>
      )}

      <CommandDialog open={search} onOpenChange={setSearch}>
        <CommandInput placeholder="Sembol ara (BTC, XAU…)" data-testid="symbol-search-input" />
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>Bulunamadı</CommandEmpty>
          {symbolList.map((s) => (
            <CommandItem key={s.symbol} value={s.symbol} onSelect={() => {
              selectSymbol(s.symbol);
              setSearch(false);
            }} data-testid={`symbol-option-${s.symbol}`}>
              <span className="font-semibold">{s.symbol}</span>
              <span className="ml-auto text-[11px] text-[#787b86]">{s.type === "COMMODITY" ? "Emtia" : s.type === "COIN" ? "Kripto" : s.type} · Perpetual</span>
            </CommandItem>
          ))}
        </CommandList>
      </CommandDialog>

      <AlarmNotices items={notices} metaMap={metaMap} onClose={closeNotice} onOpen={(a) => {
        selectSymbol(a.symbol);
        closeNotice(a.id);
      }} />

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent className="bg-[#0c0d0f] border-[#2a2e39] max-w-sm" data-testid="clear-drawings-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px] text-white">Tüm çizimler silinsin mi?</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] text-[#787b86]">{symbol} grafiğindeki tüm çizimler kalıcı olarak silinecek. Bu işlem geri alınamaz.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="clear-drawings-cancel" className="bg-transparent border-[#2a2e39] text-[#d1d4dc] hover:bg-[#1e222d] hover:text-white">Vazgeç</AlertDialogCancel>
            <AlertDialogAction onClick={() => engine.current?.clearDrawings()} className="bg-[#f23645] hover:bg-[#d92c3a] text-white">Hepsini sil</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {indDlg && (
        <IndicatorDialog open onOpenChange={(o) => !o && setIndDlg(null)} title={indDlg === "epoch" ? "Epoch Script" : "CakmaUstad-RSI"}
          schema={indDlg === "epoch" ? EPOCH_SCHEMA : RSI_SCHEMA} values={settings[indDlg]?.values}
          onChange={(vals) => update((s) => ({ [indDlg]: { ...s[indDlg], values: vals } }))} />
      )}
    </div>
  );
}
