
import { useState } from "react";
import {
  Search,
  LineChart,
  Settings2,
  Bell,
  LogOut,
  Maximize,
  Undo2,
  Redo2,
  PanelsTopLeft,
  Square,
  Columns2,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

import { Switch } from "@/components/ui/switch";
import { TIMEFRAMES } from "@/lib/format";

export function TopBar({
  symbol,
  tf,
  setTf,
  onSearch,
  settings,
  toggleInd,
  openInd,
  onAlarm,
  hist,
  onUndo,
  onRedo,
  live,
  user,
  logout,
  twoCharts,
  onChartLayoutChange,
  mobile,
}) {
  const inds = [
    ["epoch", "Epoch Script"],
    ["rsi", "CakmaUstad-RSI"],
  ];

  const [menu, setMenu] = useState(false);

  return (
    <div
      className="h-11 shrink-0 bg-[#0c0d0f] border-b border-[#2a2e39] flex items-center gap-1 px-2 overflow-x-auto ev-noscroll"
      data-testid="top-bar"
    >
      <div className="flex items-center gap-2 pr-2 shrink-0">
        <img
          src="/icon-5122.png"
          alt="Epochveras"
          className="w-7 h-7 rounded-md object-contain"
        />

        <span className="hidden lg:block font-semibold text-[15px] text-white">
          Epochveras
        </span>
      </div>

      <div className="w-px h-6 bg-[#2a2e39] shrink-0" />

      <button
        data-testid="topbar-symbol-search-button"
        onClick={onSearch}
        className="flex items-center gap-1.5 h-8 px-2 rounded hover:bg-[#1e222d] shrink-0"
      >
        <Search size={14} className="text-[#787b86]" />
        <span className="font-semibold text-[14px]">
          {symbol}
        </span>
      </button>

      <div className="w-px h-6 bg-[#2a2e39] shrink-0" />

      <div className="flex items-center shrink-0">
        {TIMEFRAMES.map((t) => (
          <button
            key={t.k}
            data-testid={`timeframe-button-${t.k}`}
            onClick={() => setTf(t.k)}
            className={`h-8 min-w-[34px] px-1.5 rounded text-[13px] ${
              tf === t.k
                ? "bg-[#1e222d] text-white font-semibold"
                : "text-[#b2b5be] hover:bg-[#171b26]"
            }`}
          >
            {t.l}
          </button>
        ))}
      </div>

      <div className="w-px h-6 bg-[#2a2e39] shrink-0" />

      <DropdownMenu open={menu} onOpenChange={setMenu}>
        <DropdownMenuTrigger asChild>
          <button
            data-testid="indicator-menu-button"
            className="flex items-center gap-1.5 h-8 px-2 rounded hover:bg-[#1e222d] text-[13px] shrink-0"
          >
            <LineChart size={15} />
            Göstergeler
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-64 bg-[#131722] border-[#2a2e39]">
          <DropdownMenuLabel className="text-[11px] text-[#787b86]">
            Göstergeler
          </DropdownMenuLabel>

          {inds.map(([k, l]) => (
            <div
              key={k}
              className="flex items-center justify-between px-2 py-1.5 text-[13px]"
            >
              <span>{l}</span>

              <div className="flex items-center gap-2">
                <button
                  data-testid={`indicator-settings-${k}`}
                  onClick={() => {
                    setMenu(false);
                    openInd(k);
                  }}
                  className="p-1 text-[#787b86] hover:text-white"
                >
                  <Settings2 size={15} />
                </button>

                <Switch
                  data-testid={`indicator-toggle-${k}`}
                  checked={!!settings[k]?.enabled}
                  onCheckedChange={(c) => toggleInd(k, c)}
                />
              </div>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        data-testid="topbar-alarm-button"
        onClick={onAlarm}
        className="flex items-center gap-1.5 h-8 px-2 rounded hover:bg-[#1e222d] text-[13px] shrink-0"
      >
        <Bell size={15} />
        Alarm
      </button>

      <div className="w-px h-6 bg-[#2a2e39] shrink-0" />

      <button
        data-testid="undo-button"
        title="Geri al (Ctrl+Z)"
        disabled={!hist?.undo}
        onClick={onUndo}
        className="p-1.5 h-8 rounded text-[#b2b5be] hover:bg-[#1e222d] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent shrink-0"
      >
        <Undo2 size={16} />
      </button>

      <button
        data-testid="redo-button"
        title="İleri al (Ctrl+Y)"
        disabled={!hist?.redo}
        onClick={onRedo}
        className="p-1.5 h-8 rounded text-[#b2b5be] hover:bg-[#1e222d] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent shrink-0"
      >
        <Redo2 size={16} />
      </button>

      {!mobile && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              data-testid="chart-layout-menu-button"
              title="Grafik düzeni"
              className={`h-8 w-9 flex items-center justify-center rounded shrink-0 transition-colors ${
                twoCharts
                  ? "bg-[#1e222d] text-white"
                  : "text-[#b2b5be] hover:bg-[#1e222d] hover:text-white"
              }`}
            >
              <PanelsTopLeft size={17} />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="start"
            className="w-40 bg-[#131722] border-[#2a2e39]"
          >
            <DropdownMenuLabel className="text-[11px] text-[#787b86]">
              Grafik düzeni
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              data-testid="chart-layout-one"
              onSelect={() => onChartLayoutChange(false)}
              className="flex items-center gap-2 cursor-pointer"
            >
              <Square size={15} />
              <span>1 Grafik</span>

              {!twoCharts && (
                <span className="ml-auto text-[#2962ff]">✓</span>
              )}
            </DropdownMenuItem>

            <DropdownMenuItem
              data-testid="chart-layout-two"
              onSelect={() => onChartLayoutChange(true)}
              className="flex items-center gap-2 cursor-pointer"
            >
              <Columns2 size={15} />
              <span>2 Grafik</span>

              {twoCharts && (
                <span className="ml-auto text-[#2962ff]">✓</span>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <div className="ml-auto flex items-center gap-2 pl-2 shrink-0">
        <span
          className="hidden md:flex items-center gap-1.5 text-[11px] text-[#787b86]"
          data-testid="live-status"
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              live ? "bg-[#089981]" : "bg-[#e0a020]"
            }`}
          />
          {live ? "Canlı" : "Yedek akış"}
        </span>

        <button
          onClick={() =>
            document.fullscreenElement
              ? document.exitFullscreen()
              : document.documentElement.requestFullscreen?.()
          }
          className="p-1.5 text-[#787b86] hover:text-white hidden sm:block"
          data-testid="fullscreen-button"
        >
          <Maximize size={15} />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              data-testid="user-menu-button"
              className="w-7 h-7 rounded-full bg-[#1e222d] text-[12px] font-semibold uppercase"
            >
              {(user?.name || "?")[0]}
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            className="bg-[#131722] border-[#2a2e39]"
          >
            <DropdownMenuLabel className="text-[12px]">
              {user?.email}
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              data-testid="logout-button"
              onClick={logout}
            >
              <LogOut size={14} />
              Çıkış yap
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
