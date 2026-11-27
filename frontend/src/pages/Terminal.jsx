
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  List,
  Bell,
  Activity,
  X,
  Pencil,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from "@/components/ui/command";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { market, fetchSymbols } from "@/lib/market";
import { decFromTick } from "@/lib/format";
import { EPOCH_SCHEMA, RSI_SCHEMA } from "@/lib/indicators";
import { unlockAudio } from "@/lib/alerts";
import { useAuth } from "@/context/AuthContext";
import {
  useWorkspace,
  useAlarms,
  usePush,
  useIsMobile,
} from "@/hooks/useTerminal";
import ChartView from "@/components/ChartView";
import { TopBar } from "@/components/TopBar";
import {
  DrawingToolbar,
  DrawingProps,
  STYLED,
} from "@/components/Drawing";
import { AlarmNotices } from "@/components/AlarmNotices";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
const SPLIT_MODE_KEY = "ev_chart_split_mode";
const SECOND_SYMBOL_KEY = "ev_chart_second_symbol";
const SECOND_TF_KEY = "ev_chart_second_tf";

function getCachedSymbols() {
  try {
    const cached = JSON.parse(
      localStorage.getItem(SYMBOL_CACHE_KEY) || "null"
    );

    return Array.isArray(cached) && cached.length
      ? cached
      : null;
  } catch {
    return null;
  }
}

function readStorage(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function PanelBox({
  id,
  title,
  Icon,
  onClose,
  children,
}) {
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

      <div className="flex-1 min-h-0">
        {children}
      </div>
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

  const [symbols, setSymbols] = useState(
    () => getCachedSymbols()
  );

  const [tool, setTool] = useState("cursor");
  const [sel, setSel] = useState(null);
  const [search, setSearch] = useState(false);
  const [indDlg, setIndDlg] = useState(null);
  const [live, setLive] = useState(false);
  const [sheet, setSheet] = useState(null);

  const [twoCharts, setTwoCharts] = useState(
    () => readStorage(SPLIT_MODE_KEY, "0") === "1"
  );

  const [secondSymbol, setSecondSymbol] = useState(
    () => readStorage(SECOND_SYMBOL_KEY, "ETHUSDT")
  );

  const [secondTf] = useState(
    () => readStorage(SECOND_TF_KEY, "15m")
  );

  const [activeChart, setActiveChart] = useState("main");

  const drawingOpen = settings.drawingOpen ?? true;

  const engine = useRef(null);
  const secondEngine = useRef(null);
  const mobile = useIsMobile();
  const mobileSwipeStart = useRef(null);

  const symbol = settings.symbol;
  const tf = settings.tf;

  const mainActive = activeChart === "main";
  const secondActive = activeChart === "second";

  const activeEngine = useCallback(() => {
    if (
      twoCharts &&
      activeChart === "second" &&
      secondEngine.current
    ) {
      return secondEngine.current;
    }

    return engine.current;
  }, [twoCharts, activeChart]);

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
          } catch {}
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
            : [
                {
                  symbol: settings.symbol || "BTCUSDT",
                  tick: "0.01",
                  dec: 2,
                  type: "COIN",
                },
              ]
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

  useEffect(() => {
    try {
      localStorage.setItem(
        SPLIT_MODE_KEY,
        twoCharts ? "1" : "0"
      );
    } catch {}
  }, [twoCharts]);

  useEffect(() => {
    try {
      localStorage.setItem(
        SECOND_SYMBOL_KEY,
        secondSymbol
      );
    } catch {}
  }, [secondSymbol]);

  useEffect(() => {
    try {
      localStorage.setItem(
        SECOND_TF_KEY,
        secondTf
      );
    } catch {}
  }, [secondTf]);

  useEffect(() => {
    if (mobile && twoCharts) {
      setTwoCharts(false);
      setActiveChart("main");
      setSel(null);
    }
  }, [mobile, twoCharts]);

  useEffect(() => {
    if (!twoCharts) {
      setActiveChart("main");
      setSel(null);
    }
  }, [twoCharts]);

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

    if (!map[secondSymbol]) {
      map[secondSymbol] = {
        symbol: secondSymbol,
        tick: "0.01",
        dec: 2,
        type: "COIN",
      };
    }

    return map;
  }, [symbols, symbol, secondSymbol]);

  const symbolList = useMemo(() => {
    const list = symbols || [];

    return list.some((s) => s.symbol === symbol)
      ? list
      : [...list, metaMap[symbol]];
  }, [symbols, symbol, metaMap]);

  const meta = metaMap[symbol];
  const secondMeta = metaMap[secondSymbol];

  const activeSymbol =
    twoCharts && secondActive
      ? secondSymbol
      : symbol;

  const mobileFavoriteSymbols = useMemo(() => {
    const bySymbol = new Map(
      symbolList.map((item) => [item.symbol, item])
    );

    const list = [];
    const seen = new Set();

    const addSymbol = (value) => {
      const name =
        typeof value === "string"
          ? value
          : value?.symbol;

      if (!name || seen.has(name)) return;

      const item = bySymbol.get(name);

      if (!item || item.type === "COMMODITY") return;

      seen.add(name);
      list.push(item);
    };

    (Array.isArray(favorites) ? favorites : []).forEach(
      (group) => {
        (
          Array.isArray(group?.symbols)
            ? group.symbols
            : []
        ).forEach(addSymbol);
      }
    );

    symbolList.forEach((item) => {
      if (item.type !== "COMMODITY") {
        addSymbol(item.symbol);
      }
    });

    if (!seen.has(symbol)) {
      const current =
        bySymbol.get(symbol) || metaMap[symbol];

      if (current) {
        list.unshift(current);
      }
    }

    return list;
  }, [favorites, symbolList, symbol, metaMap]);

  // Alarm panelinden seçilen coin her zaman ana grafiğe gider.
  const selectSymbol = useCallback(
    (s, keepSheetOpen = false) => {
      update({ symbol: s });
      setSel(null);
      setActiveChart("main");

      if (!keepSheetOpen) {
        setSheet(null);
      }
    },
    [update]
  );

  // Watchlist ve arama, aktif grafiği değiştirir.
  const selectSymbolInActiveChart = useCallback(
    (s, keepSheetOpen = false) => {
      if (twoCharts && activeChart === "second") {
        setSecondSymbol(s);
        setSel(null);
      } else {
        update({ symbol: s });
        setSel(null);
        setActiveChart("main");
      }

      if (!keepSheetOpen) {
        setSheet(null);
      }
    },
    [twoCharts, activeChart, update]
  );

  const changeMobileFavorite = useCallback(
    (direction) => {
      const list = mobileFavoriteSymbols;

      if (list.length < 2) return;

      const currentIndex = list.findIndex(
        (item) => item.symbol === symbol
      );

      const index = currentIndex < 0 ? 0 : currentIndex;

      const nextIndex =
        (index + direction + list.length) %
        list.length;

      const nextSymbol = list[nextIndex]?.symbol;

      if (nextSymbol && nextSymbol !== symbol) {
        selectSymbol(nextSymbol);
      }
    },
    [mobileFavoriteSymbols, symbol, selectSymbol]
  );

  const handleMobileCoinTouchStart = (e) => {
    e.stopPropagation();

    mobileSwipeStart.current =
      e.touches?.[0]?.clientY ?? null;
  };

  const handleMobileCoinTouchEnd = (e) => {
    e.stopPropagation();

    const startY = mobileSwipeStart.current;
    mobileSwipeStart.current = null;

    if (
      startY == null ||
      !e.changedTouches?.length
    ) {
      return;
    }

    const deltaY =
      e.changedTouches[0].clientY - startY;

    if (Math.abs(deltaY) < 20) return;

    changeMobileFavorite(
      deltaY < 0 ? 1 : -1
    );
  };

  const [notices, setNotices] = useState([]);
  const [confirmClear, setConfirmClear] = useState(false);

  const closeNotice = useCallback(
    (id) =>
      setNotices((list) =>
        list.filter((item) => item.id !== id)
      ),
    []
  );

  const onTrigger = useCallback(
    (alarm) => {
      setNotices((list) => [
        ...list.slice(-3),
        alarm,
      ]);

      setTimeout(
        () => closeNotice(alarm.id),
        20000
      );
    },
    [closeNotice]
  );

  const {
    alarms,
    add,
    remove,
    clearHistory,
  } = useAlarms(
    settings.sound,
    metaMap,
    onTrigger
  );

  const push = usePush();

  const saveTimers = useRef({});

  const [hist, setHist] = useState({
    undo: false,
    redo: false,
  });

  const makeChartCallbacks = (chartId, chartSymbol) => ({
    onSelect: (drawing) => {
      setActiveChart(chartId);
      setSel(drawing);
    },

    onToolDone: () => {
      setTool("cursor");
    },

    onDrawingsChange: (list) => {
      clearTimeout(saveTimers.current[chartSymbol]);

      saveTimers.current[chartSymbol] = setTimeout(
        () => {
          api
            .put(`/drawings/${chartSymbol}`, {
              drawings: list,
            })
            .catch(() =>
              toast.error("Çizim kaydedilemedi")
            );
        },
        500
      );
    },

    onAddAlarm: (price) =>
      add(
        chartSymbol,
        price,
        market.tickers[chartSymbol]?.c
      ),

    onDeleteAlarm: (id) => remove(id),

    onRsiRatio: (ratio) =>
      update({ rsiRatio: ratio }),

    onHistory: (history) => {
      if (
        (chartId === "main" && activeChart === "main") ||
        (chartId === "second" && activeChart === "second")
      ) {
        setHist(history);
      }
    },

    onInteract: () => {
      setActiveChart(chartId);
    },
  });

  const mainCb = makeChartCallbacks("main", symbol);
  const secondCb = makeChartCallbacks(
    "second",
    secondSymbol
  );

  const changeDrawing = (patch) => {
    activeEngine()?.updateSelected(patch);

    if (sel && STYLED.includes(sel.type)) {
      update((current) => ({
        toolDefaults: {
          ...current.toolDefaults,
          [sel.type]: {
            ...(current.toolDefaults?.[sel.type] || {}),
            ...patch,
          },
        },
      }));
    }
  };

  const setPanel = (key, value) =>
    update((current) => ({
      panels: {
        ...current.panels,
        [key]: value,
      },
    }));

  const togglePanel = (key) => {
    if (mobile) {
      setSheet((current) =>
        current === key ? null : key
      );
    } else {
      setPanel(key, !settings.panels[key]);
    }
  };

  const content = {
    watchlist: (
      <Watchlist
        symbols={symbolList}
        current={activeSymbol}
        onSelect={(s) =>
          selectSymbolInActiveChart(s, true)
        }
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
        symbol={activeSymbol}
        meta={metaMap[activeSymbol]}
      />
    ),
  };

  const open = PANELS.filter(
    ([key]) => settings.panels[key]
  );

  const activeCount = alarms.filter(
    (alarm) => alarm.active
  ).length;

  const activateMainChart = () => {
    setActiveChart("main");
    setSel(null);
  };

  const activateSecondChart = () => {
    setActiveChart("second");
    setSel(null);
  };

  const changeChartLayout = (value) => {
    setTwoCharts(value);
    setActiveChart("main");
    setSel(null);
  };

  return (
    <div
      className="h-[100dvh] w-full flex flex-col bg-black overflow-hidden"
      data-testid="terminal-root"
    >
      <TopBar
        symbol={symbol}
        tf={tf}
        setTf={(key) => update({ tf: key })}
        onSearch={() => setSearch(true)}
        settings={settings}
        toggleInd={(key, enabled) =>
          update((current) => ({
            [key]: {
              ...current[key],
              enabled,
            },
          }))
        }
        openInd={setIndDlg}
        onAlarm={() => togglePanel("alarms")}
        hist={hist}
        onUndo={() => activeEngine()?.undo()}
        onRedo={() => activeEngine()?.redo()}
        live={live}
        user={user}
        logout={logout}
        twoCharts={twoCharts}
        onChartLayoutChange={changeChartLayout}
        mobile={mobile}
      />

      <div className="flex-1 min-h-0 flex">
        {drawingOpen && (
          <DrawingToolbar
            tool={tool}
            setTool={setTool}
            magnet={settings.magnet}
            setMagnet={(value) =>
              update({ magnet: value })
            }
            onClear={() =>
              setConfirmClear(true)
            }
          />
        )}

        <PanelGroup
          direction="horizontal"
          autoSaveId="ev-main"
          className="flex-1 min-w-0"
        >
          <Panel
            id="chart"
            order={1}
            minSize={35}
          >
            <div className="relative h-full min-h-0 flex flex-col bg-black">
              <div
                className={`flex-1 min-h-0 flex ${
                  twoCharts && !mobile
                    ? "flex-row"
                    : "flex-col"
                }`}
              >
                <div
                  data-testid="main-chart-pane"
                  onMouseDown={() => {
                    if (!mainActive) {
                      activateMainChart();
                    }
                  }}
                  onTouchStart={() => {
                    if (!mainActive) {
                      activateMainChart();
                    }
                  }}
                  className={`relative min-w-0 min-h-0 ${
                    twoCharts && !mobile
                      ? "w-1/2 h-full border-r border-[#2a2e39]"
                      : "w-full h-full"
                  } ${
                    mainActive && twoCharts
                      ? "ring-1 ring-inset ring-[#2962ff]/50"
                      : ""
                  }`}
                >
                  <ChartView
                    symbol={symbol}
                    meta={meta}
                    tf={tf}
                    settings={settings}
                    alarms={alarms}
                    cb={mainCb}
                    engineRef={engine}
                    tool={mainActive ? tool : "cursor"}
                    magnet={settings.magnet}
                    toolDefaults={settings.toolDefaults}
                  />

                  {mobile &&
                    mobileFavoriteSymbols.length > 0 && (
                      <div
                        data-testid="mobile-favorite-switcher"
                        className="absolute bottom-12 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 rounded-md border border-[#363b49] bg-[#131722]/95 px-1.5 py-1 shadow-xl select-none"
                        style={{ touchAction: "none" }}
                        onTouchStart={handleMobileCoinTouchStart}
                        onTouchEnd={handleMobileCoinTouchEnd}
                        onTouchCancel={() => {
                          mobileSwipeStart.current = null;
                        }}
                      >
                        <button
                          type="button"
                          data-testid="mobile-favorite-previous"
                          aria-label="Önceki coin"
                          disabled={
                            mobileFavoriteSymbols.length < 2
                          }
                          onClick={() =>
                            changeMobileFavorite(-1)
                          }
                          className="flex h-7 w-6 items-center justify-center rounded text-[#b2b5be] hover:bg-[#1e222d] hover:text-white disabled:opacity-30"
                        >
                          <ChevronUp size={17} />
                        </button>

                        <span
                          data-testid="mobile-favorite-current"
                          className="min-w-[76px] text-center text-[12px] font-semibold tracking-wide text-white"
                        >
                          {symbol}
                        </span>

                        <button
                          type="button"
                          data-testid="mobile-favorite-next"
                          aria-label="Sonraki coin"
                          disabled={
                            mobileFavoriteSymbols.length < 2
                          }
                          onClick={() =>
                            changeMobileFavorite(1)
                          }
                          className="flex h-7 w-6 items-center justify-center rounded text-[#b2b5be] hover:bg-[#1e222d] hover:text-white disabled:opacity-30"
                        >
                          <ChevronDown size={17} />
                        </button>
                      </div>
                    )}

                  {mainActive && (
                    <DrawingProps
                      sel={sel}
                      onChange={changeDrawing}
                      onDelete={() =>
                        activeEngine()?.deleteSelected()
                      }
                    />
                  )}
                </div>

                {twoCharts && !mobile && (
                  <div
                    data-testid="second-chart-pane"
                    onMouseDown={() => {
                      if (!secondActive) {
                        activateSecondChart();
                      }
                    }}
                    onTouchStart={() => {
                      if (!secondActive) {
                        activateSecondChart();
                      }
                    }}
                    className={`relative min-w-0 min-h-0 w-1/2 h-full ${
                      secondActive
                        ? "ring-1 ring-inset ring-[#2962ff]/50"
                        : ""
                    }`}
                  >
                    <ChartView
                      symbol={secondSymbol}
                      meta={secondMeta}
                      tf={secondTf}
                      settings={settings}
                      alarms={alarms}
                      cb={secondCb}
                      engineRef={secondEngine}
                      tool={secondActive ? tool : "cursor"}
                      magnet={settings.magnet}
                      toolDefaults={settings.toolDefaults}
                    />

                    {secondActive && (
                      <DrawingProps
                        sel={sel}
                        onChange={changeDrawing}
                        onDelete={() =>
                          activeEngine()?.deleteSelected()
                        }
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </Panel>

          {!mobile && open.length > 0 && (
            <>
              <PanelResizeHandle
                className="ev-handle w-[3px]"
                data-testid="sidebar-resize-handle"
              />

              <Panel
                id="side"
                order={2}
                defaultSize={26}
                minSize={16}
                maxSize={60}
              >
                <PanelGroup
                  direction="vertical"
                  autoSaveId={`ev-side-${open
                    .map((item) => item[0])
                    .join("-")}`}
                >
                  {open.map(
                    ([key, title, Icon], index) => (
                      <Fragment key={key}>
                        {index > 0 && (
                          <PanelResizeHandle
                            className="ev-handle h-[3px]"
                            data-testid={`panel-resize-${key}`}
                          />
                        )}

                        <Panel
                          id={key}
                          order={index + 1}
                          minSize={8}
                        >
                          <PanelBox
                            id={key}
                            title={title}
                            Icon={Icon}
                            onClose={() =>
                              setPanel(key, false)
                            }
                          >
                            {content[key]}
                          </PanelBox>
                        </Panel>
                      </Fragment>
                    )
                  )}
                </PanelGroup>
              </Panel>
            </>
          )}
        </PanelGroup>

        <div
          className="w-11 shrink-0 bg-[#0c0d0f] border-l border-[#2a2e39] flex flex-col items-center gap-1 py-2"
          data-testid="right-rail"
        >
          {PANELS.map(([key, title, Icon]) => {
            const on = mobile
              ? sheet === key
              : settings.panels[key];

            return (
              <button
                key={key}
                data-testid={`${
                  key === "futures"
                    ? "futures-data"
                    : key
                }-tab-button`}
                title={title}
                onClick={() => togglePanel(key)}
                className={`relative w-10 h-10 md:w-9 md:h-9 flex items-center justify-center rounded-md ${
                  on
                    ? "bg-[#1e222d] text-white"
                    : "text-[#b2b5be] hover:bg-[#171b26]"
                }`}
              >
                <Icon size={18} />

                {key === "alarms" &&
                  activeCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#e0a020] text-black text-[10px] font-bold flex items-center justify-center">
                      {activeCount}
                    </span>
                  )}
              </button>
            );
          })}

          <button
            data-testid="drawing-toolbar-toggle"
            title="Çizim araçları"
            onClick={() =>
              update({
                drawingOpen: !drawingOpen,
              })
            }
            className={`relative w-10 h-10 md:w-9 md:h-9 flex items-center justify-center rounded-md ${
              drawingOpen
                ? "bg-[#1e222d] text-white"
                : "text-[#b2b5be] hover:bg-[#171b26]"
            }`}
          >
            <Pencil size={18} />
          </button>
        </div>
      </div>

      {mobile && (
        <Sheet
          open={!!sheet}
          onOpenChange={(open) =>
            !open && setSheet(null)
          }
        >
          <SheetContent
            side="bottom"
            className="h-[45dvh] p-0 bg-[#0c0d0f] border-[#2a2e39]"
            data-testid="mobile-panel-sheet"
          >
            <SheetTitle className="sr-only">
              {sheet}
            </SheetTitle>

            {sheet &&
              (() => {
                const [key, title, Icon] =
                  PANELS.find(
                    (item) => item[0] === sheet
                  );

                return (
                  <PanelBox
                    id={`m-${key}`}
                    title={title}
                    Icon={Icon}
                  >
                    {content[key]}
                  </PanelBox>
                );
              })()}
          </SheetContent>
        </Sheet>
      )}

      <CommandDialog
        open={search}
        onOpenChange={setSearch}
      >
        <CommandInput
          placeholder="Sembol ara (BTC, XAU…)"
          data-testid="symbol-search-input"
        />

        <CommandList className="max-h-[60vh]">
          <CommandEmpty>
            Bulunamadı
          </CommandEmpty>

          {symbolList.map((item) => (
            <CommandItem
              key={item.symbol}
              value={item.symbol}
              onSelect={() => {
                selectSymbolInActiveChart(item.symbol);
                setSearch(false);
              }}
              data-testid={`symbol-option-${item.symbol}`}
            >
              <span className="font-semibold">
                {item.symbol}
              </span>

              <span className="ml-auto text-[11px] text-[#787b86]">
                {item.type === "COMMODITY"
                  ? "Emtia"
                  : item.type === "COIN"
                    ? "Kripto"
                    : item.type}{" "}
                · Perpetual
              </span>
            </CommandItem>
          ))}
        </CommandList>
      </CommandDialog>

      <AlarmNotices
        items={notices}
        metaMap={metaMap}
        onClose={closeNotice}
        onOpen={(alarm) => {
          selectSymbol(alarm.symbol);
          closeNotice(alarm.id);
        }}
      />

      <AlertDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
      >
        <AlertDialogContent
          className="bg-[#0c0d0f] border-[#2a2e39] max-w-sm"
          data-testid="clear-drawings-dialog"
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px] text-white">
              Tüm çizimler silinsin mi?
            </AlertDialogTitle>

            <AlertDialogDescription className="text-[13px] text-[#787b86]">
              {activeChart === "second"
                ? secondSymbol
                : symbol}{" "}
              grafiğindeki tüm çizimler kalıcı olarak
              silinecek. Bu işlem geri alınamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid="clear-drawings-cancel"
              className="bg-transparent border-[#2a2e39] text-[#d1d4dc] hover:bg-[#1e222d] hover:text-white"
            >
              Vazgeç
            </AlertDialogCancel>

            <AlertDialogAction
              onClick={() =>
                activeEngine()?.clearDrawings()
              }
              className="bg-[#f23645] hover:bg-[#d92c3a] text-white"
            >
              Hepsini sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {indDlg && (
        <IndicatorDialog
          open
          onOpenChange={(open) =>
            !open && setIndDlg(null)
          }
          title={
            indDlg === "epoch"
              ? "Epoch Script"
              : "CakmaUstad-RSI"
          }
          schema={
            indDlg === "epoch"
              ? EPOCH_SCHEMA
              : RSI_SCHEMA
          }
          values={settings[indDlg]?.values}
          onChange={(values) =>
            update((current) => ({
              [indDlg]: {
                ...current[indDlg],
                values,
              },
            }))
          }
        />
      )}
    </div>
  );
}
