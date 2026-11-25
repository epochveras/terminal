
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtPrice, fmtFunding, fmtCountdown, fmtVol } from "@/lib/format";
import { useTickers } from "./Watchlist";

const BINANCE = "https://fapi.binance.com";

async function binanceGet(path) {
  const response = await fetch(`${BINANCE}${path}`);

  if (!response.ok) {
    throw new Error(`Binance HTTP ${response.status}`);
  }

  return response.json();
}

function RatioBlock({ title, rows = [], testid }) {
  const last = rows[rows.length - 1];

  if (!last) {
    return (
      <div className="px-3 py-2 text-[11px] text-[#787b86]" data-testid={testid}>
        {title}: veri yok
      </div>
    );
  }

  const L = +last.longAccount * 100;
  const S = +last.shortAccount * 100;

  return (
    <div className="px-3 py-2.5 border-b border-[#131722]" data-testid={testid}>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[#787b86] mb-1.5">
        <span>{title}</span>
        <span className="num text-[13px] text-[#d1d4dc] normal-case">
          {(+last.longShortRatio).toFixed(4)}
        </span>
      </div>

      <div className="flex h-6 rounded-sm overflow-hidden text-[11px] num font-medium">
        <div
          className="bg-[#0ecb81] text-black flex items-center pl-1.5 transition-[width] duration-700"
          style={{ width: `${L}%` }}
        >
          {L.toFixed(2)}%
        </div>

        <div className="bg-[#f6465d] text-white flex items-center justify-end pr-1.5 flex-1">
          {S.toFixed(2)}%
        </div>
      </div>

      <div className="flex justify-between text-[10px] text-[#787b86] mt-1">
        <span>Alıcı (Long)</span>
        <span>Satıcı (Short)</span>
      </div>
    </div>
  );
}

export function FuturesPanel({ symbol, meta }) {
  const tickers = useTickers();
  const t = tickers[symbol] || {};

  const period = "5m";
  const [data, setData] = useState(null);
  const [, tick] = useState(0);

  useEffect(() => {
    let alive = true;

    setData(null);

    const load = async () => {
      const encodedSymbol = encodeURIComponent(symbol);

      const results = await Promise.allSettled([
        binanceGet(`/fapi/v1/openInterest?symbol=${encodedSymbol}`),

        binanceGet(
          `/futures/data/globalLongShortAccountRatio?symbol=${encodedSymbol}&period=${period}&limit=1`
        ),

        // Top Trader verileri mevcut backend üzerinden korunuyor.
        api.get("/market/futures", {
          params: { symbol, period },
        }),
      ]);

      if (!alive) return;

      setData((previous) => ({
        ...previous,

        openInterest:
          results[0].status === "fulfilled"
            ? results[0].value
            : previous?.openInterest,

        global:
          results[1].status === "fulfilled"
            ? results[1].value
            : previous?.global,

        topAccount:
          results[2].status === "fulfilled"
            ? results[2].value?.data?.topAccount
            : previous?.topAccount,

        topPosition:
          results[2].status === "fulfilled"
            ? results[2].value?.data?.topPosition
            : previous?.topPosition,
      }));
    };

    load();

    const iv = setInterval(load, 15000);
    const iv2 = setInterval(() => tick((x) => x + 1), 1000);

    return () => {
      alive = false;
      clearInterval(iv);
      clearInterval(iv2);
    };
  }, [symbol, period]);

  const fr = t.r ?? data?.premium?.lastFundingRate;
  const nft = t.T ?? data?.premium?.nextFundingTime;
  const mark = t.m || +data?.premium?.markPrice;

  const oi = Number(data?.openInterest?.openInterest);

  const R = ({ l, v, cls = "", id }) => (
    <div className="flex justify-between items-center px-3 h-7 text-[12px]">
      <span className="text-[#787b86]">{l}</span>
      <span data-testid={id} className={`num ${cls}`}>
        {v}
      </span>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto ev-scroll" data-testid="futures-data-panel">
      <div className="px-3 pt-2 pb-1 text-[13px] font-semibold" data-testid="futures-symbol">
        {symbol}
      </div>

      <R
        id="futures-funding-rate"
        l="Funding rate"
        v={`${fmtFunding(fr)} (${meta?.fundingHours ?? 8} saat)`}
        cls={
          +fr > 0
            ? "text-[#0ecb81]"
            : +fr < 0
              ? "text-[#f6465d]"
              : ""
        }
      />

      <R
        id="futures-next-funding"
        l="Sonraki funding"
        v={
          nft
            ? `${fmtCountdown(nft - Date.now())} · ${new Date(nft).toLocaleTimeString("tr-TR", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Europe/Istanbul",
              })}`
            : "—"
        }
      />

      <R
        l="Open interest"
        v={
          Number.isFinite(oi)
            ? `${fmtPrice(oi, 0)} ${meta?.base || ""}`
            : "—"
        }
      />

      <R
        l="OI değeri"
        v={
          Number.isFinite(oi) && mark
            ? `$${fmtVol(oi * mark)}`
            : "—"
        }
      />

      <div className="border-t border-[#1e222d] mt-1" />

      {!data ? (
        <p className="text-[11px] text-[#787b86] px-3 py-3">
          Yükleniyor…
        </p>
      ) : (
        <>
          <RatioBlock
            testid="ratio-global"
            title="Long/Short oranı (hesap)"
            rows={data.global || []}
          />

          <RatioBlock
            testid="ratio-top-account"
            title="Top trader L/S (hesap)"
            rows={data.topAccount || []}
          />

          <RatioBlock
            testid="ratio-top-position"
            title="Top trader L/S (pozisyon)"
            rows={data.topPosition || []}
          />
        </>
      )}
    </div>
  );
}
