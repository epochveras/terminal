
import { useState } from "react";
import { MousePointer2, Slash, MoveRight, Ruler, Magnet, Trash2, Square, Type, Plus, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

const PosIcon = ({ long }) => (
  <svg width="18" height="18" viewBox="0 0 18 18">
    <rect x="3" y={long ? 3 : 9} width="12" height="6" fill="#089981" opacity=".9" />
    <rect x="3" y={long ? 9 : 3} width="12" height="6" fill="#f23645" opacity=".9" />
    <line x1="2" x2="16" y1="9" y2="9" stroke="#d1d4dc" />
  </svg>
);

const FibIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.4">
    <line x1="2" x2="16" y1="3" y2="3" />
    <line x1="2" x2="16" y1="7" y2="7" />
    <line x1="2" x2="16" y1="10.5" y2="10.5" />
    <line x1="2" x2="16" y1="15" y2="15" />
    <line x1="3" x2="15" y1="15" y2="3" strokeDasharray="2 2" />
  </svg>
);

const VIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.6">
    <line x1="9" x2="9" y1="1" y2="17" />
    <circle cx="9" cy="9" r="2" fill="currentColor" />
  </svg>
);

export const STYLED = ["trendline", "hray", "vline", "rect", "fib"];

const TOOLS = [
  ["cursor", "İmleç", <MousePointer2 size={18} />],
  ["trendline", "Trend çizgisi", <Slash size={18} />],
  ["hray", "Yatay ışın", <MoveRight size={18} />],
  ["vline", "Dikey çizgi", <VIcon />],
  ["rect", "Dikdörtgen", <Square size={17} />],
  ["fib", "Fibonacci düzeltme", <FibIcon />],
  ["text", "Metin ekle", <Type size={18} />],
  ["long", "Uzun pozisyon", <PosIcon long />],
  ["short", "Kısa pozisyon", <PosIcon />],
  ["ruler", "Cetvel", <Ruler size={18} />],
];

const Btn = ({ id, label, active, onClick, children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        data-testid={`drawing-tool-${id}`}
        onClick={onClick}
        aria-label={label}
        className={`w-10 h-10 md:w-9 md:h-9 flex items-center justify-center rounded-md transition-colors ${
          active
            ? "bg-[#1e222d] text-white"
            : "text-[#b2b5be] hover:bg-[#171b26] hover:text-white"
        }`}
      >
        {children}
      </button>
    </TooltipTrigger>
    <TooltipContent side="right">{label}</TooltipContent>
  </Tooltip>
);

export function DrawingToolbar({ tool, setTool, magnet, setMagnet, onClear }) {
  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="w-11 shrink-0 bg-[#0c0d0f] border-r border-[#2a2e39] flex flex-col items-center gap-1 py-2 overflow-y-auto ev-noscroll"
        data-testid="drawing-toolbar"
      >
        {TOOLS.map(([id, label, icon]) => (
          <Btn
            key={id}
            id={id}
            label={label}
            active={tool === id}
            onClick={() => setTool(tool === id && id !== "cursor" ? "cursor" : id)}
          >
            {icon}
          </Btn>
        ))}

        <div className="w-6 h-px bg-[#2a2e39] my-1" />

        <Btn
          id="magnet"
          label={magnet ? "Yumuşak mıknatıs: Açık" : "Yumuşak mıknatıs: Kapalı"}
          active={magnet}
          onClick={() => setMagnet(!magnet)}
        >
          <Magnet size={18} />
        </Btn>

        <Btn id="clear" label="Tüm çizimleri sil" onClick={onClear}>
          <Trash2 size={18} />
        </Btn>
      </div>
    </TooltipProvider>
  );
}

const SWATCHES = [
  "#2962ff", "#00bcd4", "#089981", "#00e676", "#ffeb3b",
  "#ff9800", "#f23645", "#e040fb", "#ffffff", "#787b86",
];

const FIB_PREF_KEY = "epochveras_fib_preferences_v1";

const DEFAULT_FIB_LEVELS = [
  [0, "#787b86"],
  [0.236, "#f23645"],
  [0.382, "#ff9800"],
  [0.5, "#4caf50"],
  [0.618, "#089981"],
  [0.786, "#00bcd4"],
  [1, "#787b86"],
  [1.618, "#2962ff"],
].map(([value, color]) => ({
  value,
  color,
  visible: true,
}));

function readFibPreferences() {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(FIB_PREF_KEY) || "null"
    );

    if (!saved || typeof saved !== "object") {
      return {
        levels: DEFAULT_FIB_LEVELS,
        showFill: true,
        reverse: false,
      };
    }

    return {
      levels:
        Array.isArray(saved.levels) && saved.levels.length
          ? saved.levels
          : DEFAULT_FIB_LEVELS,
      showFill: saved.showFill !== false,
      reverse: saved.reverse === true,
    };
  } catch (_) {
    return {
      levels: DEFAULT_FIB_LEVELS,
      showFill: true,
      reverse: false,
    };
  }
}

export function DrawingProps({ sel, onChange, onDelete }) {
  const [fibLevelsOpen, setFibLevelsOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);
  const [fibPreferences, setFibPreferences] = useState(readFibPreferences);
  const [newFibValue, setNewFibValue] = useState("");

  const saveFibPreferences = (patch) => {
    const next = { ...fibPreferences, ...patch };
    setFibPreferences(next);

    try {
      window.localStorage.setItem(FIB_PREF_KEY, JSON.stringify(next));
    } catch (_) {}
  };

  if (!sel) return null;

  const styled = STYLED.includes(sel.type);
  const isText = sel.type === "text";

  const levels =
    Array.isArray(sel.levels) && sel.levels.length
      ? sel.levels
      : fibPreferences.levels;

  const updateLevels = (next) => {
    onChange({ levels: next });
    saveFibPreferences({ levels: next });
  };

  const updateLevel = (index, patch) => {
    const next = levels.map((item, i) =>
      i === index ? { ...item, ...patch } : item
    );

    updateLevels(next);
  };

  const addFibLevel = () => {
    const value = Number(newFibValue);

    if (newFibValue.trim() === "" || !Number.isFinite(value)) return;

    const next = [
      ...levels,
      {
        value,
        color: "#d1d4dc",
        visible: true,
      },
    ].sort((a, b) => Number(a.value) - Number(b.value));

    updateLevels(next);
    setNewFibValue("");
  };

  const removeFibLevel = (index) => {
    if (levels.length <= 1) return;

    const next = levels.filter((_, i) => i !== index);
    updateLevels(next);
  };

  const menuButton =
    "h-7 px-2 shrink-0 inline-flex items-center gap-1 rounded text-xs text-[#b2b5be] hover:bg-[#1e222d] hover:text-white";

  const menuPanel =
    "absolute top-full left-0 mt-1 z-[60] rounded-md border border-[#2a2e39] bg-[#131722] p-2 shadow-2xl";

  return (
    <div
      data-testid="drawing-props-bar"
      className="absolute top-2 left-1/2 -translate-x-1/2 z-20 max-w-[95%]"
    >
      <div className="flex flex-wrap items-center gap-1 bg-[#131722] border border-[#2a2e39] rounded-md px-2 py-1 shadow-xl max-w-full">
        <button
          data-testid="drawing-delete-button"
          onClick={onDelete}
          className="w-8 h-7 shrink-0 flex items-center justify-center rounded text-[#f23645] hover:bg-[#1e222d]"
        >
          <Trash2 size={15} />
        </button>

        {(styled || isText) && (
          <div className="w-px h-5 bg-[#2a2e39] mx-1 shrink-0" />
        )}

        {(styled || isText) && (
          <div className="relative shrink-0">
            <button
              type="button"
              data-testid="drawing-width-menu"
              aria-expanded={openMenu === "width"}
              onClick={() =>
                setOpenMenu((v) => (v === "width" ? null : "width"))
              }
              className={`${menuButton} ${
                openMenu === "width" ? "bg-[#2a2e39] text-white" : ""
              }`}
            >
              <span
                className="inline-block w-5 bg-[#d1d4dc]"
                style={{ height: Math.max(1, Number(sel.width) || 1) }}
              />
              <span>Kalınlık</span>
              <span className="text-[10px]">▾</span>
            </button>

            {openMenu === "width" && (
              <div
                data-testid="drawing-width-menu-panel"
                className={`${menuPanel} w-28`}
              >
                {[1, 2, 3, 4].map((w) => (
                  <button
                    key={w}
                    data-testid={`drawing-width-${w}`}
                    onClick={() => {
                      onChange({ width: w });
                      setOpenMenu(null);
                    }}
                    className={`w-full h-8 px-2 flex items-center justify-between rounded ${
                      Number(sel.width || 1) === w
                        ? "bg-[#2a2e39] text-white"
                        : "text-[#b2b5be] hover:bg-[#1e222d]"
                    }`}
                  >
                    <span className="text-xs">{w} px</span>
                    <span
                      className="block w-8 bg-[#d1d4dc]"
                      style={{ height: w }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {(styled || isText) && (
          <div className="relative shrink-0">
            <button
              type="button"
              data-testid="drawing-color-menu"
              aria-expanded={openMenu === "color"}
              onClick={() =>
                setOpenMenu((v) => (v === "color" ? null : "color"))
              }
              className={`${menuButton} ${
                openMenu === "color" ? "bg-[#2a2e39] text-white" : ""
              }`}
            >
              <span
                className="w-4 h-4 rounded-sm border border-white/30"
                style={{ background: sel.color || "#d1d4dc" }}
              />
              <span>Renk</span>
              <span className="text-[10px]">▾</span>
            </button>

            {openMenu === "color" && (
              <div
                data-testid="drawing-color-menu-panel"
                className={`${menuPanel} w-40`}
              >
                <div className="grid grid-cols-5 gap-2">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      data-testid={`drawing-color-${c.slice(1)}`}
                      aria-label={`Renk ${c}`}
                      onClick={() => {
                        onChange({ color: c });
                        setOpenMenu(null);
                      }}
                      className={`w-6 h-6 rounded-sm border ${
                        sel.color === c
                          ? "border-white ring-1 ring-white/50"
                          : "border-[#414653]"
                      }`}
                      style={{ background: c }}
                    />
                  ))}
                </div>

                <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-[#2a2e39]">
                  <span className="text-xs text-[#b2b5be]">Özel renk</span>
                  <input
                    type="color"
                    data-testid="drawing-color-custom"
                    value={sel.color || "#d1d4dc"}
                    onChange={(e) => onChange({ color: e.target.value })}
                    className="w-8 h-7 bg-transparent cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {isText && (
          <>
            <div className="w-px h-5 bg-[#2a2e39] mx-1 shrink-0" />
            {[12, 14, 16, 20, 24, 30].map((size) => (
              <button
                key={size}
                data-testid={`drawing-font-size-${size}`}
                onClick={() => onChange({ fontSize: size })}
                className={`h-7 px-2 shrink-0 rounded text-xs ${
                  Number(sel.fontSize || 14) === size
                    ? "bg-[#2a2e39] text-white"
                    : "text-[#b2b5be] hover:bg-[#1e222d]"
                }`}
              >
                {size}
              </button>
            ))}
          </>
        )}

        {sel.type === "fib" && (
          <>
            <div className="w-px h-5 bg-[#2a2e39] mx-1 shrink-0" />

            <button
              data-testid="fib-reverse"
              onClick={() => {
                const reverse = !sel.reverse;
                onChange({ reverse });
                saveFibPreferences({ reverse });
              }}
              className={`h-7 px-2 shrink-0 rounded text-xs ${
                sel.reverse
                  ? "bg-[#2a2e39] text-white"
                  : "text-[#b2b5be] hover:bg-[#1e222d]"
              }`}
            >
              Ters çevir
            </button>

            <label className="flex items-center gap-1 text-xs text-[#b2b5be] shrink-0 px-1">
              <input
                data-testid="fib-fill-toggle"
                type="checkbox"
                checked={sel.showFill !== false}
                onChange={(e) => {
                  const showFill = e.target.checked;
                  onChange({ showFill });
                  saveFibPreferences({ showFill });
                }}
              />
              Arka plan
            </label>

            <button
              type="button"
              data-testid="fib-levels-settings"
              aria-expanded={fibLevelsOpen}
              onClick={() => setFibLevelsOpen((open) => !open)}
              className={`h-7 px-2 shrink-0 rounded text-xs ${
                fibLevelsOpen
                  ? "bg-[#2a2e39] text-white"
                  : "text-[#b2b5be] hover:bg-[#1e222d]"
              }`}
            >
              Oranlar {fibLevelsOpen ? "▴" : "▾"}
            </button>
          </>
        )}

        {!styled && !isText && sel.type !== "fib" && (
          <span className="text-xs text-[#b2b5be] px-2">
            {sel.type === "long" ? "Uzun pozisyon" : "Kısa pozisyon"}
          </span>
        )}
      </div>

      {sel.type === "fib" && fibLevelsOpen && (
        <div
          data-testid="fib-levels-panel"
          className="absolute top-full right-0 mt-1 z-[70] w-64 max-h-96 overflow-y-auto rounded-md border border-[#2a2e39] bg-[#131722] p-3 shadow-2xl"
        >
          <div className="text-xs font-medium text-white mb-3">
            Fibonacci oranları
          </div>

          {levels.map((level, index) => (
            <div
              key={`${level.value}-${index}`}
              className="flex items-center gap-1.5 py-1"
            >
              <input
                aria-label={`${level.value} oranını göster`}
                data-testid={`fib-level-visible-${index}`}
                type="checkbox"
                checked={level.visible !== false}
                onChange={(e) =>
                  updateLevel(index, { visible: e.target.checked })
                }
                className="shrink-0"
              />

              <input
                aria-label={`${level.value} oran değeri`}
                data-testid={`fib-level-value-${index}`}
                type="number"
                step="any"
                defaultValue={level.value}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  const value = Number(raw);

                  if (raw !== "" && Number.isFinite(value)) {
                    updateLevel(index, { value });
                  } else {
                    e.target.value = String(level.value);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className="min-w-0 flex-1 w-20 h-7 rounded border border-[#2a2e39] bg-[#0c0d0f] px-2 text-xs text-white outline-none focus:border-[#2962ff]"
              />

              <input
                aria-label={`${level.value} oranı rengi`}
                data-testid={`fib-level-color-${index}`}
                type="color"
                value={level.color || "#d1d4dc"}
                onChange={(e) =>
                  updateLevel(index, { color: e.target.value })
                }
                className="w-7 h-7 shrink-0 bg-transparent cursor-pointer"
              />

              <button
                type="button"
                data-testid={`fib-level-delete-${index}`}
                aria-label={`${level.value} oranını sil`}
                disabled={levels.length <= 1}
                onClick={() => removeFibLevel(index)}
                className="w-7 h-7 shrink-0 flex items-center justify-center rounded text-[#f23645] hover:bg-[#2a2e39] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <X size={14} />
              </button>
            </div>
          ))}

          <div className="mt-3 pt-3 border-t border-[#2a2e39]">
            <div className="text-xs text-[#b2b5be] mb-2">
              Yeni oran ekle
            </div>

            <div className="flex items-center gap-2">
              <input
                data-testid="fib-new-level-input"
                type="number"
                step="any"
                value={newFibValue}
                onChange={(e) => setNewFibValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addFibLevel();
                }}
                placeholder="Örn. 0.65"
                className="min-w-0 flex-1 h-8 rounded border border-[#2a2e39] bg-[#0c0d0f] px-2 text-xs text-white outline-none focus:border-[#2962ff]"
              />

              <button
                type="button"
                data-testid="fib-add-level"
                onClick={addFibLevel}
                disabled={
                  newFibValue.trim() === "" ||
                  !Number.isFinite(Number(newFibValue))
                }
                className="h-8 px-3 flex items-center justify-center gap-1 rounded bg-[#2962ff] text-white text-xs hover:bg-[#1e53df] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={14} />
                Ekle
              </button>
            </div>
          </div>

          <div className="text-[10px] text-[#787b86] mt-3">
            Oran değerini değiştirince kutudan çıkman yeterli. Değişiklikler
            çizime uygulanır ve kaydedilir. Oranları ondalık biçimde girebilirsin:
            0.618, 1.618, 2.618 gibi.
          </div>
        </div>
      )}
    </div>
  );
}
